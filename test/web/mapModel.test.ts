import { describe, expect, it } from "vitest";
import { scoreBand } from "../../web/src/format.js";
import { clustersOf, FAN_CAP, pinLook, SPREAD_CLUSTER_RADIUS, spreadOffsets, type PinPoint } from "../../web/src/mapModel.js";
import type { DeskListing } from "../../web/src/api.js";

function listing(overrides: {
  offer?: "buy" | "rent";
  score?: number | null;
  verdict?: string;
}): DeskListing {
  return {
    listing: { offer: overrides.offer ?? "buy" },
    analysis: { score: overrides.score ?? null, verdict: overrides.verdict ?? "rent" },
  } as unknown as DeskListing;
}

describe("score bands", () => {
  it("takes the band from the server's verdict, so the desk never re-derives it", () => {
    expect(scoreBand("workable")).toBe("workable");
    expect(scoreBand("worth a look")).toBe("worth a look");
    expect(scoreBand("mixed")).toBe("mixed");
    expect(scoreBand("careful")).toBe("careful");
  });

  it("has no band for a rental or for a verdict it does not know", () => {
    expect(scoreBand("rent")).toBeNull();
    expect(scoreBand("")).toBeNull();
    expect(scoreBand("unknown")).toBeNull();
  });
});

describe("the pin", () => {
  it("shows the score in the band the server gave it", () => {
    expect(pinLook(listing({ score: 84, verdict: "workable" }))).toEqual({ className: "band-workable", label: "84" });
    expect(pinLook(listing({ score: 70, verdict: "worth a look" }))).toEqual({ className: "band-look", label: "70" });
    expect(pinLook(listing({ score: 55, verdict: "mixed" }))).toEqual({ className: "band-mixed", label: "55" });
    expect(pinLook(listing({ score: 20, verdict: "careful" }))).toEqual({ className: "band-careful", label: "20" });
  });

  it("shows a rental as a rental, because a rental is never scored", () => {
    expect(pinLook(listing({ offer: "rent", score: null, verdict: "rent" }))).toEqual({ className: "band-rent", label: "R" });
  });

  it("shows a dash for a buy with no score at all", () => {
    expect(pinLook(listing({ offer: "buy", score: null, verdict: "rent" }))).toEqual({ className: "band-rent", label: "–" });
  });
});

describe("the spread", () => {
  const point = (id: string, x: number, y: number): PinPoint => ({ id, x, y });

  it("groups the pins that sit on top of each other", () => {
    const groups = clustersOf([point("a", 0, 0), point("b", 10, 0), point("c", 500, 500)]);
    expect(groups.map((group) => group.map((entry) => entry.id))).toEqual([["a", "b"], ["c"]]);
  });

  it("leaves a pin on its own when nothing covers it", () => {
    const groups = clustersOf([point("a", 0, 0), point("b", 200, 0)]);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.length === 1)).toBe(true);
  });

  it("keeps a chain together, even when the middle pin is seen last", () => {
    const groups = clustersOf([point("c", 60, 0), point("a", 0, 0), point("b", 30, 0)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.map((entry) => entry.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("fans a group out so that no two pins end up on the same spot", () => {
    const offsets = spreadOffsets(4);
    expect(offsets).toHaveLength(4);
    const spots = offsets.map((offset) => `${offset.dx.toFixed(2)},${offset.dy.toFixed(2)}`);
    expect(new Set(spots).size).toBe(4);
    // The pins sit far enough apart to keep their scores readable.
    for (const offset of offsets) {
      expect(Math.hypot(offset.dx, offset.dy)).toBeGreaterThan(15);
    }
  });

  it("keeps every pin of a group the same distance from the centre", () => {
    const offsets = spreadOffsets(5);
    const distances = offsets.map((offset) => Math.hypot(offset.dx, offset.dy).toFixed(3));
    expect(new Set(distances).size).toBe(1);
  });

  it("keeps a group of six a pin apart, not piled on a fixed circle", () => {
    const offsets = spreadOffsets(6);
    for (let index = 0; index < offsets.length; index += 1) {
      const next = offsets[(index + 1) % offsets.length];
      const current = offsets[index];
      if (!next || !current) continue;
      expect(Math.hypot(next.dx - current.dx, next.dy - current.dy)).toBeGreaterThanOrEqual(35.9);
    }
  });

  it("keeps a large group inside the cap, on two rings, so it cannot reach the next cluster", () => {
    const offsets = spreadOffsets(12);
    expect(offsets).toHaveLength(12);
    const radii = new Set(offsets.map((offset) => Math.hypot(offset.dx, offset.dy).toFixed(1)));
    expect(radii.size).toBeGreaterThan(1);
    for (const offset of offsets) {
      expect(Math.hypot(offset.dx, offset.dy)).toBeLessThanOrEqual(FAN_CAP + 0.01);
    }
    expect(SPREAD_CLUSTER_RADIUS).toBeGreaterThan(FAN_CAP * 2);
  });
});
