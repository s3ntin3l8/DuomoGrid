/**
 * Market rates from the Deutsche Bundesbank's SDMX web service, and household energy prices from
 * Destatis GENESIS. Both are published statistics, not quotes: a rate here is where a market rate
 * sits today, never a price a bank would offer.
 *
 * Nothing here is a score input on its own. The desk proposes values; the user accepts them, and
 * only an accepted value reaches the analysis.
 */

/** The Bundesbank publishes an effective rate per month for new residential mortgage business. */
export type MarketRates = {
  /** The month the observations belong to, as "YYYY-MM". */
  asOf: string;
  /** Effective annual rate for new residential mortgages, 10 years or more fixed, secured by a lien. */
  secured10yPercent: number | null;
  /** Effective annual rate for new residential mortgages, 10 years or more fixed, all borrowers. */
  unsecured10yPercent: number | null;
  /** Effective annual rate for new residential mortgages, any initial fixing. */
  allNewPercent: number | null;
  /** Effective annual rate on mortgage stock with an original maturity of up to one year. */
  floatingPercent: number | null;
  /**
   * The lowest and highest value the secured 10-year rate took over the last twelve months. The
   * Bundesbank's own spread bounds live in a series that is no longer served, so this is the range
   * the rate actually moved in, which is what a buyer wants to know anyway.
   */
  secured10yLowPercent: number | null;
  secured10yHighPercent: number | null;
  /** How many months the range covers, so the desk can say "over the last N months" honestly. */
  secured10yRangeMonths: number;
  /** The three most recent observations of the secured 10-year rate, newest first. */
  history: { period: string; percent: number }[];
  /** The difference between the unsecured and the secured 10-year rate. A widening spread means more risk priced in. */
  spreadPercent: number | null;
  /** Where the numbers came from, for the desk to show. */
  source: string;
  /** True when the newest observation is provisional and will be revised. */
  preliminary: boolean;
  /** When the snapshot was fetched, as an ISO timestamp. */
  fetchedAt: string;
};

const BUNDESBANK_BASE = "https://api.statistiken.bundesbank.de/rest/data";
const TIMEOUT_MS = 8000;

/**
 * Series keys in the BBIM1 flow. The Bundesbank publishes only the average here, so the range is
 * derived from the recent history of the same series.
 */
const SECURED_10Y = "M.DE.B.A2CC.P.R.A.2250.EUR.N";
const UNSECURED_10Y = "M.DE.B.A2C.P.R.A.2250.EUR.N";
const ALL_NEW = "M.DE.B.A2C.A.R.A.2250.EUR.N";
const FLOATING = "M.DE.B.A22.F.R.A.2250.EUR.O";

/** How many months of history the range is computed over. */
const RANGE_MONTHS = 12;

/** A German decimal comma. A figure that is not a number is not a value. */
function germanNumber(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const normalized = text.includes(",") ? text.replaceAll(".", "").replace(",", ".") : text;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export type ParsedSeries = {
  /** Observations oldest to newest. */
  points: { period: string; percent: number; preliminary: boolean }[];
};

/**
 * Parse the Bundesbank's BBK-CSV. The body is a metadata header followed by one observation per
 * line, each `YYYY-MM;value;` with an optional trailing flag. The newest observation is last.
 */
export function parseBundesbankSeries(body: string): ParsedSeries {
  const points: { period: string; percent: number; preliminary: boolean }[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cells = trimmed.split(";");
    if (cells.length < 2) continue;
    const period = (cells[0] ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(period)) continue;
    const percent = germanNumber(cells[1] ?? "");
    if (percent == null) continue;
    // The Bundesbank marks the newest observation as provisional in the third cell.
    const preliminary = (cells[2] ?? "").toLowerCase().includes("vorläufig");
    points.push({ period, percent, preliminary });
  }
  return { points };
}

function seriesUrl(key: string): string {
  const url = new URL(`${BUNDESBANK_BASE}/BBIM1/${key}`);
  url.searchParams.set("format", "csv");
  url.searchParams.set("lang", "de");
  return url.toString();
}

async function fetchSeries(key: string, fetcher: typeof fetch): Promise<ParsedSeries> {
  const response = await fetcher(seriesUrl(key), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "text/plain" },
  });
  if (!response.ok) throw new Error(`Bundesbank lookup failed (${response.status}).`);
  return parseBundesbankSeries(await response.text());
}

/**
 * The most recent observation, or null when the series is empty.
 *
 * The observations are sorted by period first, so the newest is the one the publisher wrote last
 * and not the one that happens to be last in the body.
 */
export function latestRate(points: { period: string; percent: number; preliminary: boolean }[]): number | null {
  if (!points.length) return null;
  let newest = points[0];
  for (const point of points) {
    if (point.period >= newest.period) newest = point;
  }
  return newest.percent;
}

/**
 * Fetch the market rates. A failing series is not fatal: the rest of the snapshot is still worth
 * showing, so every field that could not be read stays null rather than zero.
 */
export async function fetchMarketRates(
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<MarketRates> {
  const [secured, unsecured, allNew, floating] = await Promise.all([
    fetchSeries(SECURED_10Y, fetcher).catch(() => ({ points: [] })),
    fetchSeries(UNSECURED_10Y, fetcher).catch(() => ({ points: [] })),
    fetchSeries(ALL_NEW, fetcher).catch(() => ({ points: [] })),
    fetchSeries(FLOATING, fetcher).catch(() => ({ points: [] })),
  ]);

  // The observations are sorted by period, so the newest is the latest one and not the last in the
  // body. The range covers the last months of that order.
  const securedPoints = [...secured.points].sort((left, right) => left.period.localeCompare(right.period));
  const newest = securedPoints[securedPoints.length - 1] ?? null;
  const secured10y = newest ? newest.percent : null;
  const unsecured10y = latestRate(unsecured.points);
  const recent = securedPoints.slice(-RANGE_MONTHS);
  const recentValues = recent.map((point) => point.percent);

  return {
    asOf: newest?.period ?? "",
    secured10yPercent: secured10y,
    unsecured10yPercent: unsecured10y,
    allNewPercent: latestRate(allNew.points),
    floatingPercent: latestRate(floating.points),
    secured10yLowPercent: recentValues.length ? Math.min(...recentValues) : null,
    secured10yHighPercent: recentValues.length ? Math.max(...recentValues) : null,
    secured10yRangeMonths: recentValues.length,
    history: securedPoints.slice(-3).reverse().map((point) => ({ period: point.period, percent: point.percent })),
    spreadPercent: secured10y != null && unsecured10y != null ? Number((unsecured10y - secured10y).toFixed(2)) : null,
    source: "Deutsche Bundesbank, Zinsstatistik",
    preliminary: newest?.preliminary ?? false,
    fetchedAt: now.toISOString(),
  };
}

/** The rate the desk proposes, with the band and the period it belongs to. */
export type RateSuggestion = {
  value: number;
  lowPercent: number | null;
  highPercent: number | null;
  asOf: string;
  source: string;
  preliminary: boolean;
};

/**
 * The proposal for the interest rate. The secured 10-year rate is the one a buyer of a home with
 * a lien actually gets, so it leads. Without it there is no proposal, never a guess.
 */
export function suggestInterestRate(rates: MarketRates | null): RateSuggestion | null {
  if (!rates || rates.secured10yPercent == null) return null;
  return {
    value: rates.secured10yPercent,
    lowPercent: rates.secured10yLowPercent,
    highPercent: rates.secured10yHighPercent,
    asOf: rates.asOf,
    source: rates.source,
    preliminary: rates.preliminary,
  };
}
