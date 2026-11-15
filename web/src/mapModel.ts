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

/** How far apart two pins have to sit before they count as separate. */
export const CLUSTER_RADIUS = 34;

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

/**
 * Where a pin in a group is drawn, relative to the group's centre. The group is fanned
 * out on a circle, so the pins do not cover each other.
 */
export function spreadOffsets(count: number, radius = CLUSTER_RADIUS): { dx: number; dy: number }[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (2 * Math.PI * index) / count;
    const distance = radius * 0.62;
    return { dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance };
  });
}
