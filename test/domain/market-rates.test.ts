import { describe, expect, it } from "vitest";
import { parseBundesbankSeries, suggestInterestRate, type MarketRates } from "../../src/domain/market-rates.js";

/** A body shaped like the Bundesbank's BBK-CSV: metadata first, then one observation per line. */
const BODY = `"";BBIM1.M.DE.B.A2CC.P.R.A.2250.EUR.N;BBIM1.M.DE.B.A2CC.P.R.A.2250.EUR.N_FLAGS
"";Effektivzinssätze Banken DE / Neugeschäft / besicherte Wohnungsbaukredite an private Haushalte / SUD161;
Dezimalstellen;2;
Einheit;% p.a.;
Stand vom;02.11.2026 12:17:13 Uhr;
2026-07;3,72;
2026-08;3,83;
2026-09;3,91;Vorläufiger Wert
`;

describe("parseBundesbankSeries", () => {
  it("reads the observations and ignores the metadata above them", () => {
    const parsed = parseBundesbankSeries(BODY);
    expect(parsed.points).toHaveLength(3);
    expect(parsed.points[0]).toEqual({ period: "2026-07", percent: 3.72, preliminary: false });
  });

  it("reads a German decimal comma", () => {
    const parsed = parseBundesbankSeries(BODY);
    expect(parsed.points[2]?.percent).toBe(3.91);
  });

  it("marks the newest observation as provisional when the publisher says so", () => {
    const parsed = parseBundesbankSeries(BODY);
    expect(parsed.points[2]?.preliminary).toBe(true);
    expect(parsed.points[0]?.preliminary).toBe(false);
  });

  it("returns nothing for a body without observations", () => {
    expect(parseBundesbankSeries('"";name;\nDezimalstellen;2;\n').points).toEqual([]);
  });

  it("skips a line whose value is not a number", () => {
    const parsed = parseBundesbankSeries("2026-01;abc;\n2026-02;3,10;\n");
    expect(parsed.points).toEqual([{ period: "2026-02", percent: 3.1, preliminary: false }]);
  });

  it("keeps a zero, which is a figure and not a missing value", () => {
    const parsed = parseBundesbankSeries("2026-01;0,00;\n");
    expect(parsed.points[0]?.percent).toBe(0);
  });
});

function rates(over: Partial<MarketRates> = {}): MarketRates {
  return {
    asOf: "2026-09",
    secured10yPercent: 3.91,
    unsecured10yPercent: 4.13,
    allNewPercent: 4.09,
    floatingPercent: 4.44,
    secured10yLowPercent: 3.55,
    secured10yHighPercent: 3.91,
    secured10yRangeMonths: 12,
    history: [{ period: "2026-09", percent: 3.91 }],
    spreadPercent: 0.22,
    source: "Deutsche Bundesbank, Zinsstatistik",
    preliminary: true,
    fetchedAt: "2026-11-15T10:00:00.000Z",
    ...over,
  };
}

describe("suggestInterestRate", () => {
  it("proposes the secured ten-year rate with its range", () => {
    const suggestion = suggestInterestRate(rates());
    expect(suggestion?.value).toBe(3.91);
    expect(suggestion?.lowPercent).toBe(3.55);
    expect(suggestion?.highPercent).toBe(3.91);
    expect(suggestion?.asOf).toBe("2026-09");
    expect(suggestion?.preliminary).toBe(true);
  });

  it("has no proposal without a rate, rather than a guess", () => {
    expect(suggestInterestRate(rates({ secured10yPercent: null }))).toBeNull();
    expect(suggestInterestRate(null)).toBeNull();
  });
});
