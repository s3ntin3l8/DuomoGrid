/** One step on the price timeline. `at` is null for the portal's own earlier price: it is undated. */
export type PricePoint = { priceEur: number; at: string | null; source: "portal" | "saved" };

export type PriceHistory = {
  /** Oldest to newest. The portal's earlier price comes first when it adds something. */
  points: PricePoint[];
  firstKnownPriceEur: number | null;
  currentPriceEur: number | null;
  totalChangeEur: number | null;
  totalChangePct: number | null;
  /** Steps down, and steps up, between consecutive known prices. */
  reductions: number;
  increases: number;
  /** When the newest dated change happened. Null when only the undated portal step exists, or nothing changed. */
  lastChangeAt: string | null;
  /** The date the portal gives, else the first time this desk saw the listing. */
  startedAt: string;
  startedBasis: "portal" | "saved";
  /** Whole days from `startedAt` to now. Never negative. */
  daysOnMarket: number;
};

type Observation = { seenAt: string; priceEur: number | null };

const MS_PER_DAY = 86_400_000;
/** A step smaller than this is rounding, not a price change. */
const EPSILON_EUR = 0.5;

/**
 * Builds the price timeline from what was saved. The portal's earlier price is undated, so it is never turned into an
 * observation: it becomes the first point, and only when it differs from the first saved price.
 * Observations may arrive in any order. A null price is not a price and is skipped.
 */
export function priceHistoryOf(input: {
  observations: Observation[];
  portalPreviousPriceEur: number | null;
  listedAt: string | null;
  createdAt: string;
  now: Date;
}): PriceHistory {
  const saved = input.observations
    .filter((row): row is { seenAt: string; priceEur: number } => row.priceEur != null && row.priceEur > 0)
    // The input is newest first, so on the same instant the later index is the older row.
    .map((row, index) => ({ row, index }))
    .sort((left, right) =>
      left.row.seenAt < right.row.seenAt ? -1 : left.row.seenAt > right.row.seenAt ? 1 : right.index - left.index,
    )
    .map((entry) => entry.row);
  const points: PricePoint[] = [];
  const earlier = input.portalPreviousPriceEur;
  // The earlier price adds something only when no saved price already says it.
  if (earlier != null && earlier > 0 && !saved.some((row) => Math.abs(row.priceEur - earlier) <= EPSILON_EUR)) {
    points.push({ priceEur: earlier, at: null, source: "portal" });
  }
  for (const row of saved) {
    // A null price in between can leave the same price twice in a row. That is one step, not two.
    const last = points[points.length - 1];
    if (last && Math.abs(last.priceEur - row.priceEur) <= EPSILON_EUR) continue;
    points.push({ priceEur: row.priceEur, at: row.seenAt, source: "saved" });
  }

  let reductions = 0;
  let increases = 0;
  let lastChangeAt: string | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const step = points[index].priceEur - points[index - 1].priceEur;
    if (Math.abs(step) <= EPSILON_EUR) continue;
    if (step < 0) reductions += 1;
    else increases += 1;
    // A step from the undated portal price happened before this desk saw the listing, so it has no date to report.
    if (points[index - 1].at != null) lastChangeAt = points[index].at;
  }

  const first = points[0]?.priceEur ?? null;
  const current = points.length ? points[points.length - 1].priceEur : null;
  const change = first != null && current != null ? current - first : null;
  const portalStart = input.listedAt && !Number.isNaN(new Date(input.listedAt).getTime()) ? input.listedAt : null;
  const startedAt = portalStart ?? input.createdAt;
  const started = new Date(startedAt).getTime();
  const days = Number.isNaN(started) ? 0 : Math.max(0, Math.floor((input.now.getTime() - started) / MS_PER_DAY));
  return {
    points,
    firstKnownPriceEur: first,
    currentPriceEur: current,
    totalChangeEur: change,
    totalChangePct: change != null && first != null && first > 0 ? (change / first) * 100 : null,
    reductions,
    increases,
    lastChangeAt,
    startedAt,
    startedBasis: portalStart ? "portal" : "saved",
    daysOnMarket: days,
  };
}
