import { describe, expect, it } from "vitest";
import { priceHistoryOf } from "../../src/domain/history.js";

const now = new Date("2026-11-13T12:00:00.000Z");
const base = { portalPreviousPriceEur: null, listedAt: null, createdAt: "2026-11-01T12:00:00.000Z", now };

describe("priceHistoryOf", () => {
  it("has no price and no change without an observation", () => {
    const history = priceHistoryOf({ ...base, observations: [] });
    expect(history).toMatchObject({
      points: [],
      firstKnownPriceEur: null,
      currentPriceEur: null,
      totalChangeEur: null,
      totalChangePct: null,
      reductions: 0,
      increases: 0,
      lastChangeAt: null,
    });
  });

  it("counts steps down and up from observations in any order, and skips a null price", () => {
    const history = priceHistoryOf({
      ...base,
      observations: [
        { seenAt: "2026-11-10T10:00:00.000Z", priceEur: 300000 },
        { seenAt: "2026-11-02T10:00:00.000Z", priceEur: 320000 },
        { seenAt: "2026-11-05T10:00:00.000Z", priceEur: null },
        { seenAt: "2026-11-12T10:00:00.000Z", priceEur: 310000 },
        { seenAt: "2026-11-07T10:00:00.000Z", priceEur: 310000 },
      ],
    });
    expect(history.points.map((point) => point.priceEur)).toEqual([320000, 310000, 300000, 310000]);
    expect(history).toMatchObject({
      firstKnownPriceEur: 320000,
      currentPriceEur: 310000,
      totalChangeEur: -10000,
      reductions: 2,
      increases: 1,
      lastChangeAt: "2026-11-12T10:00:00.000Z",
    });
    expect(history.totalChangePct).toBeCloseTo(-3.125);
  });

  it("treats the portal's earlier price as the first, undated point, and never as an observation", () => {
    const history = priceHistoryOf({
      ...base,
      portalPreviousPriceEur: 329000,
      observations: [{ seenAt: "2026-11-02T10:00:00.000Z", priceEur: 319000 }],
    });
    expect(history.points).toEqual([
      { priceEur: 329000, at: null, source: "portal" },
      { priceEur: 319000, at: "2026-11-02T10:00:00.000Z", source: "saved" },
    ]);
    expect(history.reductions).toBe(1);
    expect(history.totalChangeEur).toBe(-10000);
    expect(history.totalChangePct).toBeCloseTo((-10000 / 329000) * 100);
    // The cut happened before this desk saw the listing, so there is no date to report for it.
    expect(history.lastChangeAt).toBeNull();
  });

  it("leaves the portal price out when it only repeats the first saved price", () => {
    const history = priceHistoryOf({
      ...base,
      portalPreviousPriceEur: 319000,
      observations: [{ seenAt: "2026-11-02T10:00:00.000Z", priceEur: 319000 }],
    });
    expect(history.points).toHaveLength(1);
    expect(history.reductions).toBe(0);
    expect(history.lastChangeAt).toBeNull();
  });

  it("uses the portal's earlier price alone when nothing is saved yet", () => {
    const history = priceHistoryOf({ ...base, portalPreviousPriceEur: 329000, observations: [] });
    expect(history.points).toEqual([{ priceEur: 329000, at: null, source: "portal" }]);
    expect(history.reductions).toBe(0);
    expect(history.totalChangeEur).toBe(0);
  });

  it("measures time on market from the portal date, else from the first save, and never goes negative", () => {
    const portal = priceHistoryOf({ ...base, listedAt: "2026-10-30T12:00:00.000Z", observations: [] });
    expect(portal).toMatchObject({ startedBasis: "portal", daysOnMarket: 14, startedAt: "2026-10-30T12:00:00.000Z" });
    const saved = priceHistoryOf({ ...base, observations: [] });
    expect(saved).toMatchObject({ startedBasis: "saved", daysOnMarket: 12 });
    const future = priceHistoryOf({ ...base, listedAt: "2027-01-01T00:00:00.000Z", observations: [] });
    expect(future.daysOnMarket).toBe(0);
    const bad = priceHistoryOf({ ...base, listedAt: "not a date", observations: [] });
    expect(bad.startedBasis).toBe("saved");
  });

  it("ignores a step smaller than half a euro", () => {
    const history = priceHistoryOf({
      ...base,
      observations: [
        { seenAt: "2026-11-02T10:00:00.000Z", priceEur: 1000 },
        { seenAt: "2026-11-03T10:00:00.000Z", priceEur: 999.8 },
      ],
    });
    expect(history.reductions).toBe(0);
    expect(history.increases).toBe(0);
  });

  it("leaves the portal price out when it equals any saved price, not only the first", () => {
    const history = priceHistoryOf({
      ...base,
      portalPreviousPriceEur: 450000,
      observations: [
        { seenAt: "2026-11-02T10:00:00.000Z", priceEur: 500000 },
        { seenAt: "2026-11-05T10:00:00.000Z", priceEur: 450000 },
        { seenAt: "2026-11-09T10:00:00.000Z", priceEur: 400000 },
      ],
    });
    expect(history.points.map((point) => point.priceEur)).toEqual([500000, 450000, 400000]);
    expect(history.reductions).toBe(2);
    expect(history.increases).toBe(0);
  });

  it("dates the last change from dated steps only", () => {
    const history = priceHistoryOf({
      ...base,
      portalPreviousPriceEur: 329000,
      observations: [
        { seenAt: "2026-11-02T10:00:00.000Z", priceEur: 319000 },
        { seenAt: "2026-11-09T10:00:00.000Z", priceEur: 309000 },
      ],
    });
    expect(history.reductions).toBe(2);
    expect(history.lastChangeAt).toBe("2026-11-09T10:00:00.000Z");
  });

  it("shows a price that comes back after a null as one step, not two", () => {
    const history = priceHistoryOf({
      ...base,
      observations: [
        { seenAt: "2026-11-02T10:00:00.000Z", priceEur: 450000 },
        { seenAt: "2026-11-03T10:00:00.000Z", priceEur: null },
        { seenAt: "2026-11-04T10:00:00.000Z", priceEur: 450000 },
      ],
    });
    expect(history.points).toHaveLength(1);
    expect(history.reductions + history.increases).toBe(0);
  });

  it("orders two observations from the same instant as the input says, newest first", () => {
    const same = "2026-11-02T10:00:00.000Z";
    const history = priceHistoryOf({
      ...base,
      observations: [
        { seenAt: same, priceEur: 400000 },
        { seenAt: same, priceEur: 450000 },
      ],
    });
    expect(history.points.map((point) => point.priceEur)).toEqual([450000, 400000]);
    expect(history.reductions).toBe(1);
  });
});
