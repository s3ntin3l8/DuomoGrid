import type { DeskListing } from "./api";
import { scoreBand, type ScoreBand } from "./format";

/**
 * The pin colour follows the server's own verdict bands, so the map agrees with the
 * score ring on the detail view. A rental is never scored, so it gets its own grey.
 */
export const BAND_CLASS: Record<ScoreBand, string> = {
  workable: "band-workable",
  "worth a look": "band-look",
  mixed: "band-mixed",
  careful: "band-careful",
};

export const RENT_CLASS = "band-rent";

/** What a pin shows: the band it is in and the number on it. */
export type PinLook = { className: string; label: string };

export function pinLook(row: DeskListing): PinLook {
  const band = scoreBand(row.analysis.verdict);
  if (band) return { className: BAND_CLASS[band], label: String(row.analysis.score) };
  if (row.listing.offer === "rent") return { className: RENT_CLASS, label: "R" };
  return { className: RENT_CLASS, label: "–" };
}

/** A point on the screen, with the listing it belongs to. */
export type PinPoint = { id: string; x: number; y: number };

/** How far apart two pins have to sit before they count as separate. A pin is 30 px. */
export const CLUSTER_RADIUS = 34;

/** A spread pin stays within this of its building. Further than this is a neighbouring street. */
export const FAN_CAP = 52;

/**
 * The pins that sit on top of each other. Each group gets its own pin drawn apart from
 * the others, so every score stays readable. A chain counts: if A covers B and B covers
 * C, all three are one group, whatever order they arrive in.
 */
export function clustersOf<T extends PinPoint>(points: T[], radius = CLUSTER_RADIUS): T[][] {
  const parent = points.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root] ?? root;
    return root;
  };
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      const a = points[left];
      const b = points[right];
      if (!a || !b) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) > radius) continue;
      parent[find(left)] = find(right);
    }
  }
  const groups = new Map<number, T[]>();
  points.forEach((point, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), point]);
  });
  return [...groups.values()];
}

/** A pin is 30 px. Adjacent pins in a fan need at least this much space between centres. */
export const PIN_CLEARANCE = 36;

function ring(count: number, radius: number, turn = 0): { dx: number; dy: number }[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = turn + (2 * Math.PI * index) / count;
    return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius };
  });
}

/** How many pins fit on a ring of this radius without covering each other. */
function pinsOnRing(radius: number): number {
  if (radius * 2 < PIN_CLEARANCE) return 1;
  const sine = Math.min(1, PIN_CLEARANCE / (2 * radius));
  return Math.max(1, Math.floor(Math.PI / Math.asin(sine)));
}

function radiusFor(count: number): number {
  if (count <= 1) return 0;
  return PIN_CLEARANCE / 2 / Math.sin(Math.PI / count);
}

/**
 * Where a pin in a group is drawn, relative to that pin. One ring while it fits inside
 * the cap. A second ring only takes as many pins as fit at the radius that count needs,
 * so the ring is never shrunk until the scores cover each other. Pins that still do not
 * fit stay on the building.
 */
export function spreadOffsets(count: number): { dx: number; dy: number }[] {
  if (count < 2) return [];
  const single = radiusFor(count);
  if (single <= FAN_CAP) return ring(count, single);
  const outerCount = Math.min(count, pinsOnRing(FAN_CAP));
  const outer = ring(outerCount, FAN_CAP);
  const innerRoom = FAN_CAP - PIN_CLEARANCE;
  const innerCount = Math.min(count - outerCount, pinsOnRing(innerRoom));
  const inner = innerCount <= 0 ? [] : innerCount === 1 ? [{ dx: 0, dy: 0 }] : ring(innerCount, radiusFor(innerCount), Math.PI / innerCount);
  const placed = [...outer, ...inner];
  while (placed.length < count) placed.push({ dx: 0, dy: 0 });
  return placed;
}
