import { describe, expect, it } from "vitest";
import { analyze } from "../../src/domain/analyze.js";
import { DEFAULT_ASSUMPTIONS, type ListingInput } from "../../src/domain/types.js";

const assumptions = { ...DEFAULT_ASSUMPTIONS };

function listing(partial: Partial<ListingInput> & Pick<ListingInput, "title" | "offer" | "priceEur">): ListingInput {
  return {
    source: "manual",
    sourceUrl: "",
    externalId: null,
    livingAreaM2: null,
    plotAreaM2: null,
    rooms: null,
    city: "",
    district: null,
    postalCode: null,
    state: null,
    street: null,
    latitude: null,
    longitude: null,
    locationPrecision: null,
    propertyType: "apartment",
    yearBuilt: null,
    yearRefurbished: null,
    energyClass: null,
    energyKwh: null,
    energyCert: null,
    heating: null,
    condoFeeEur: null,
    coldRentEur: null,
    warmRentEur: null,
    depositEur: null,
    rentContract: null,
    commissionPercent: null,
    commissionText: null,
    condition: null,
    floor: null,
    features: [],
    snippet: "",
    leasehold: false,
    groundRentEur: null,
    monument: false,
    tenantOccupied: false,
    ...partial,
  };
}

const darmstadt = listing({
  title: "Old apartment",
  offer: "buy",
  priceEur: 465000,
  livingAreaM2: 92,
  rooms: 4,
  city: "Darmstadt",
  postalCode: "64283",
  state: "HE",
  yearBuilt: 1912,
  yearRefurbished: 2016,
  energyClass: "D",
  energyKwh: 118,
  energyCert: "consumption",
  heating: "Gas",
  condoFeeEur: 285,
  commissionPercent: 3.57,
});

describe("analyze", () => {
  it("stacks Hessian purchase costs and a 20 percent down payment", () => {
    const result = analyze(darmstadt, assumptions);
    expect(result.transferTaxPercent).toBe(6);
    expect(result.transferTaxEur).toBe(27900);
    expect(result.notaryEur).toBe(6975);
    expect(result.registerEur).toBe(2325);
    expect(result.commissionEur).toBe(16601);
    expect(result.extraEur).toBe(53801);
    expect(result.cashToCloseEur).toBe(518801);
    expect(result.equityEur).toBe(93000);
    expect(result.equityCoversCosts).toBe(true);
    expect(result.loanEur).toBe(425801);
    expect(result.monthlyDebt).toBeGreaterThan(1500);
    expect(result.monthlyDebt).toBeLessThan(2500);
    expect(Math.round(result.pricePerLivingM2 ?? 0)).toBe(5054);
  });

  it("treats a zero commission as free and Bavaria as the lower tax", () => {
    const fresh = analyze(listing({ ...darmstadt, title: "New", priceEur: 529000, commissionPercent: 0, yearBuilt: 2024, energyClass: "A" }), assumptions);
    const munich = analyze(listing({ ...darmstadt, title: "Munich", city: "Munich", state: "BY", priceEur: 789000, postalCode: "81241" }), assumptions);
    expect(fresh.commissionEur).toBe(0);
    expect(munich.transferTaxPercent).toBe(3.5);
    expect(fresh.score).not.toBe(munich.score);
  });

  it("does not treat leasehold like freehold and shows gross yield", () => {
    const house = analyze(listing({
      title: "House on a leasehold plot",
      offer: "buy",
      priceEur: 449000,
      livingAreaM2: 138,
      plotAreaM2: 520,
      city: "Pfungstadt",
      state: "HE",
      propertyType: "house",
      yearBuilt: 1974,
      energyClass: "E",
      heating: "Gas",
      commissionPercent: 3.57,
      leasehold: true,
      groundRentEur: 220,
    }), assumptions);
    const pricePart = house.subscores.find((part) => part.key === "price");
    expect(pricePart?.score).toBeLessThanOrEqual(42);
    expect(house.flags.some((flag) => flag.title === "Leasehold")).toBe(true);
    expect(house.monthlyGroundRent).toBe(220);
    const yieldResult = analyze(listing({
      ...darmstadt,
      title: "Let apartment",
      city: "Leipzig",
      state: "SN",
      priceEur: 289000,
      livingAreaM2: 110,
      coldRentEur: 980,
      heating: "Oil",
      tenantOccupied: true,
    }), assumptions);
    expect(yieldResult.grossYield).toBeGreaterThan(3);
    expect(yieldResult.grossYield).toBeLessThan(6);
    expect(yieldResult.flags.some((flag) => flag.title === "Oil or night-storage heating")).toBe(true);
  });

  it("drops financing when the listing is a rental", () => {
    const result = analyze(listing({ ...darmstadt, title: "Rent", offer: "rent", priceEur: 1450, coldRentEur: 1450 }), assumptions);
    expect(result.offer).toBe("rent");
    expect(result.score).toBeNull();
    expect(result.loanEur).toBeNull();
    expect(result.rentPerM2).toBeGreaterThan(10);
  });

  it("warns when equity cannot cover purchase costs", () => {
    const result = analyze(darmstadt, { ...assumptions, equityMode: "eur", equityEur: 10000 });
    expect(result.equityCoversCosts).toBe(false);
    expect(result.flags.some((flag) => flag.title === "Equity does not cover purchase costs")).toBe(true);
  });
});

describe("asking-price flags", () => {
  const buy = listing({
    title: "Landshut apartment",
    offer: "buy",
    priceEur: 280000,
    livingAreaM2: 80,
    plotAreaM2: 200,
    city: "Landshut",
    state: "BY",
    propertyType: "apartment",
  });
  const published = { status: "published" as const, zone: "Untere Altstadt", eurPerM2: 2000, stichtag: "01.01.2026" };
  const band = { name: "Landshut", stateName: "Bayern", year: 2024, band: "3250 und mehr", kind: "apartment" as const };

  it("adds no flag and does not change the score when the land value or the band is missing", () => {
    const plain = analyze(buy, assumptions);
    const cases = [
      analyze(buy, assumptions, { bodenrichtwert: { status: "none" }, districtSaleBand: null }),
      analyze(buy, assumptions, { bodenrichtwert: { status: "unpublished", zone: "Marienplatz", stichtag: "01.01.2026" } }),
      analyze(buy, assumptions, { bodenrichtwert: { status: "published", zone: "Acker", eurPerM2: 0, stichtag: null } }),
      analyze(buy, assumptions, { bodenrichtwert: null }),
      analyze(buy, assumptions, { districtSaleBand: null }),
    ];
    for (const result of cases) {
      expect(result.score).toBe(plain.score);
      expect(result.subscores).toEqual(plain.subscores);
      expect(result.flags.some((flag) => /bodenrichtwert|district sale band/i.test(flag.title))).toBe(false);
    }
  });

  it("names a published Bodenrichtwert without treating it as the living-area price", () => {
    const plain = analyze(buy, assumptions);
    const withPlot = analyze(buy, assumptions, { bodenrichtwert: published });
    expect(withPlot.score).toBe(plain.score);
    expect(withPlot.subscores).toEqual(plain.subscores);
    const under = withPlot.flags.find((flag) => flag.title === "Asking price is under the plot's land value");
    expect(under?.severity).toBe("good");
    expect(under?.detail).toContain("2.000 EUR/m2 of land");
    expect(under?.detail).toContain("400.000 EUR");
    expect(under?.detail).not.toMatch(/percent/i);
    expect(under?.detail.toLowerCase()).not.toContain("market value");

    const aboveLand = analyze(listing({ ...buy, priceEur: 500000 }), assumptions, { bodenrichtwert: published });
    expect(aboveLand.flags.some((flag) => flag.title === "Asking price against the Bodenrichtwert")).toBe(true);
    expect(aboveLand.score).toBe(analyze(listing({ ...buy, priceEur: 500000 }), assumptions).score);

    const noPlot = listing({ ...buy, plotAreaM2: null });
    const named = analyze(noPlot, assumptions, { bodenrichtwert: { status: "published", zone: "Acker", eurPerM2: 0.4, stichtag: "01.01.2026" } });
    const info = named.flags.find((flag) => flag.title === "Bodenrichtwert is a land value");
    expect(info?.detail).toContain("0,4 EUR/m2 of land");
    expect(info?.detail).toContain("EUR/m2 of living area");
    expect(info?.detail).toContain("not the same unit");
    expect(named.score).toBe(analyze(noPlot, assumptions).score);
  });

  it("compares the asking price with the district sale band of the same kind", () => {
    const plain = analyze(buy, assumptions);
    const inside = analyze(buy, assumptions, { districtSaleBand: band });
    const insideFlag = inside.flags.find((flag) => flag.title === "Inside the district sale band");
    expect(insideFlag?.detail).toContain('district sale band for used apartments in Landshut (2024) is "3250 und mehr"');
    expect(insideFlag?.detail.toLowerCase()).not.toContain("market value");
    expect(inside.score).toBe(plain.score);
    expect(inside.subscores).toEqual(plain.subscores);

    const below = analyze(buy, assumptions, { districtSaleBand: { ...band, band: "4000 bis unter 4500" } });
    expect(below.flags.some((flag) => flag.title === "Below the district sale band" && flag.severity === "good")).toBe(true);
    expect(below.score).toBe(plain.score);

    const above = analyze(buy, assumptions, { districtSaleBand: { ...band, band: "bis unter 3000" } });
    expect(above.flags.some((flag) => flag.title === "Above the district sale band" && flag.severity === "warn")).toBe(true);
    expect(above.score).toBe(plain.score);

    const otherKind = analyze(buy, assumptions, { districtSaleBand: { ...band, kind: "house", band: "3500 und mehr" } });
    expect(otherKind.flags.some((flag) => flag.title.toLowerCase().includes("district sale band"))).toBe(false);
    expect(otherKind.score).toBe(plain.score);

    const house = listing({ ...buy, title: "House", propertyType: "house", livingAreaM2: 140, priceEur: 350000, plotAreaM2: null });
    const houseFlag = analyze(house, assumptions, { districtSaleBand: { ...band, kind: "house", band: "3500 und mehr" } });
    expect(houseFlag.flags.find((flag) => flag.title === "Below the district sale band")?.detail).toContain("detached and semi-detached houses");
    expect(houseFlag.score).toBe(analyze(house, assumptions).score);
  });

  it("does not flag a rental", () => {
    const rent = listing({ ...buy, title: "Rent", offer: "rent", priceEur: 1450, coldRentEur: 1450 });
    const result = analyze(rent, assumptions, { bodenrichtwert: published, districtSaleBand: band });
    expect(result.score).toBeNull();
    expect(result.verdict).toBe("rent");
    expect(result.flags.some((flag) => /bodenrichtwert|district sale band/i.test(`${flag.title} ${flag.detail}`))).toBe(false);
  });
});
