import { describe, expect, it } from "vitest";
import { normalizeAssumptions } from "../../src/domain/assumptions.js";
import { applySuggestion, pinField, refreshAssumptions, suggestionsFor, type MarketSnapshot } from "../../src/domain/suggestions.js";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "../../src/domain/types.js";

const SNAPSHOT: MarketSnapshot = {
  rates: {
    asOf: "2026-09",
    secured10yPercent: 3.91,
    unsecured10yPercent: 4.13,
    allNewPercent: 4.09,
    floatingPercent: 4.44,
    secured10yLowPercent: 3.55,
    secured10yHighPercent: 3.91,
    secured10yRangeMonths: 12,
    history: [],
    spreadPercent: 0.22,
    source: "Deutsche Bundesbank, Zinsstatistik",
    preliminary: true,
    fetchedAt: "2026-11-15T10:00:00.000Z",
  },
  energy: null,
  fetchedAt: "2026-11-15T10:00:00.000Z",
  note: null,
};

describe("assumption provenance", () => {
  it("gives an old row the builtin origin, so a refresh cannot move it", () => {
    const old = normalizeAssumptions({ interestPercent: 4 });
    expect(old.interestPercent).toBe(4);
    expect(old.interestProvenance.source).toBe("builtin");
  });

  it("keeps the origin a row was saved with", () => {
    const next = normalizeAssumptions({
      interestPercent: 3.91,
      interestProvenance: { source: "market", asOf: "2026-09", note: "Deutsche Bundesbank, Zinsstatistik" },
    });
    expect(next.interestProvenance).toEqual({ source: "market", asOf: "2026-09", note: "Deutsche Bundesbank, Zinsstatistik" });
  });

  it("never claims a row was set by the owner when it does not say so", () => {
    const next = normalizeAssumptions({ interestProvenance: { source: "nonsense" } });
    expect(next.interestProvenance.source).toBe("builtin");
  });

  it("treats a missing origin as builtin, never as the owner's", () => {
    const next = normalizeAssumptions({ interestProvenance: { asOf: "2026-09" } });
    expect(next.interestProvenance.source).toBe("builtin");
    expect(next.interestProvenance.asOf).toBe("2026-09");
  });
});

describe("suggestionsFor", () => {
  it("offers the market rate and the fees the law sets", () => {
    const suggestions = suggestionsFor(SNAPSHOT);
    expect(suggestions.interest?.value).toBe(3.91);
    expect(suggestions.notary?.value).toBe(1.5);
    expect(suggestions.register?.value).toBe(0.5);
    expect(suggestions.commission?.value).toBe(3.57);
  });

  it("still offers the fees when the market rates cannot be read", () => {
    const suggestions = suggestionsFor({ ...SNAPSHOT, rates: null });
    expect(suggestions.interest).toBeNull();
    expect(suggestions.notary?.value).toBe(1.5);
  });
});

describe("applySuggestion", () => {
  it("marks an accepted figure as a market value, so a later refresh may move it", () => {
    const suggestions = suggestionsFor(SNAPSHOT);
    const next = applySuggestion(DEFAULT_ASSUMPTIONS, "interest", suggestions.interest);
    expect(next.interestPercent).toBe(3.91);
    expect(next.interestProvenance.source).toBe("market");
    expect(next.interestProvenance.asOf).toBe("2026-09");
  });

  it("leaves the value alone without a suggestion", () => {
    const next = applySuggestion(DEFAULT_ASSUMPTIONS, "interest", null);
    expect(next.interestPercent).toBe(DEFAULT_ASSUMPTIONS.interestPercent);
  });
});

describe("pinField", () => {
  it("marks a value as the owner's own", () => {
    const next = pinField(DEFAULT_ASSUMPTIONS, "interest");
    expect(next.interestProvenance.source).toBe("user");
  });
});

describe("refreshAssumptions", () => {
  const suggestions = suggestionsFor(SNAPSHOT);

  it("moves a value that already follows the market", () => {
    const accepted = applySuggestion(DEFAULT_ASSUMPTIONS, "interest", suggestions.interest);
    const moved = refreshAssumptions({ ...accepted, interestPercent: 3.5 }, suggestions);
    expect(moved.interestPercent).toBe(3.91);
  });

  it("never moves a value the owner typed", () => {
    const mine = pinField({ ...DEFAULT_ASSUMPTIONS, interestPercent: 2.5 }, "interest");
    const moved = refreshAssumptions(mine, suggestions);
    expect(moved.interestPercent).toBe(2.5);
  });

  it("never moves a value that is still the shipped default", () => {
    const moved = refreshAssumptions(DEFAULT_ASSUMPTIONS, suggestions);
    expect(moved.interestPercent).toBe(DEFAULT_ASSUMPTIONS.interestPercent);
  });

  it("moves each field on its own origin", () => {
    const base: Assumptions = {
      ...DEFAULT_ASSUMPTIONS,
      interestPercent: 3.5,
      interestProvenance: { source: "market", asOf: "2026-08", note: "Deutsche Bundesbank, Zinsstatistik" },
      notaryPercent: 2,
      notaryProvenance: { source: "user", asOf: null, note: null },
    };
    const moved = refreshAssumptions(base, suggestions);
    expect(moved.interestPercent).toBe(3.91);
    expect(moved.notaryPercent).toBe(2);
  });
});
