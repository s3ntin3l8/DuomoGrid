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
    heatingSystem: null,
    energySource: null,
    parkingSpaces: null,
    parkingType: null,
    parkingPriceEur: null,
    bathrooms: null,
    bedrooms: null,
    availableFrom: null,
    listedAt: null,
    portalPreviousPriceEur: null,
    portalMarketEurPerM2: null,
    portalMarketLowEurPerM2: null,
    portalMarketHighEurPerM2: null,
    description: null,
    details: [],
    images: [],
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

  it("never calls an asking price good against a land value taken from an approximate point", () => {
    const approximate = listing({ ...buy, locationPrecision: "approximate" });
    const result = analyze(approximate, assumptions, { bodenrichtwert: published });
    expect(result.flags.some((flag) => flag.severity === "good" && /land value/i.test(flag.title))).toBe(false);
    const named = result.flags.find((flag) => flag.title === "Asking price against the Bodenrichtwert");
    expect(named?.severity).toBe("info");
    expect(named?.detail).toContain("approximate");
    expect(result.score).toBe(analyze(approximate, assumptions).score);
    const exact = analyze(listing({ ...buy, locationPrecision: "exact" }), assumptions, { bodenrichtwert: published });
    expect(exact.flags.find((flag) => flag.title === "Asking price is under the plot's land value")?.severity).toBe("good");
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

describe("analyze with the added exposé data", () => {
  const home = listing({
    title: "Home",
    offer: "buy",
    priceEur: 465000,
    livingAreaM2: 100,
    city: "Darmstadt",
    state: "HE",
    propertyType: "apartment",
    energyClass: "C",
    energyKwh: 100,
    yearBuilt: 1990,
  });
  const energyScore = (result: ReturnType<typeof analyze>) => result.subscores.find((part) => part.key === "energy")?.score;
  const titles = (result: ReturnType<typeof analyze>) => result.flags.map((flag) => flag.title);

  it("changes nothing for a listing without the new data", () => {
    const plain = analyze(home, assumptions);
    expect(plain.parkingEur).toBeNull();
    expect(plain.transferTaxEur).toBe(27900);
    expect(plain.notaryEur).toBe(6975);
    const empty = analyze(home, assumptions, { findings: [], heatingReplacedYear: null, history: null });
    expect(empty.score).toBe(plain.score);
    expect(empty.subscores).toEqual(plain.subscores);
    expect(empty.flags).toEqual(plain.flags);
  });

  it("charges taxes and fees on the parking sold with the home, and keeps it out of the price and the price per m2", () => {
    const withParking = analyze(listing({ ...home, parkingPriceEur: 10000, parkingSpaces: 2 }), assumptions);
    expect(withParking).toMatchObject({ parkingEur: 20000, parkingUnitEur: 10000, parkingSpaces: 2, parkingSpacesAssumed: false });
    expect(withParking.transferTaxEur).toBe(29100);
    expect(withParking.notaryEur).toBe(7275);
    const plain = analyze(home, assumptions);
    expect(withParking.cashToCloseEur).toBe((plain.cashToCloseEur ?? 0) + 20000 + (withParking.extraEur ?? 0) - (plain.extraEur ?? 0));
    expect(withParking.pricePerLivingM2).toBe(plain.pricePerLivingM2);
    expect(withParking.subscores.find((part) => part.key === "price")).toEqual(plain.subscores.find((part) => part.key === "price"));
    expect(titles(withParking)).toContain("Parking is priced separately");
  });

  it("says the single price is read as per space when there is more than one, and by how much it would differ", () => {
    const flag = analyze(listing({ ...home, parkingPriceEur: 10000, parkingSpaces: 2 }), assumptions).flags.find((item) => item.title === "Parking is priced separately");
    expect(flag?.detail).toContain("read here as the price per space");
    expect(flag?.detail).toContain("10.000 EUR lower");
    const one = analyze(listing({ ...home, parkingPriceEur: 10000, parkingSpaces: 1 }), assumptions).flags.find((item) => item.title === "Parking is priced separately");
    expect(one?.detail).not.toContain("per space");
  });

  it("takes the equity share and the cost load on the price plus parking", () => {
    const withParking = analyze(listing({ ...home, parkingPriceEur: 10000, parkingSpaces: 2 }), assumptions);
    expect(withParking.equityEur).toBe(Math.round((485000 * assumptions.equityPercent) / 100));
    const cost = withParking.subscores.find((part) => part.key === "costs");
    const load = (withParking.extraEur ?? 0) / 485000;
    expect(cost?.note).toContain(`Purchase costs are ${Math.round(load * 1000) / 10} percent of the price plus parking`);
    expect(analyze(home, assumptions).subscores.find((part) => part.key === "costs")?.note).toContain("percent of the price");
    expect(analyze(home, assumptions).subscores.find((part) => part.key === "costs")?.note).not.toContain("parking");
  });

  it("assumes one space when the price is stated without a number, and adds nothing without a price", () => {
    const oneAssumed = analyze(listing({ ...home, parkingPriceEur: 12000 }), assumptions);
    expect(oneAssumed).toMatchObject({ parkingEur: 12000, parkingSpaces: 1, parkingSpacesAssumed: true });
    expect(oneAssumed.flags.find((flag) => flag.title === "Parking is priced separately")?.detail).toContain("One space is assumed");
    const noPrice = analyze(listing({ ...home, parkingSpaces: 2 }), assumptions);
    expect(noPrice.parkingEur).toBeNull();
    expect(noPrice.cashToCloseEur).toBe(analyze(home, assumptions).cashToCloseEur);
    expect(titles(noPrice)).not.toContain("Parking is priced separately");
  });

  it("does not apply parking to a rental", () => {
    const rent = analyze(listing({ ...home, offer: "rent", priceEur: 1450, coldRentEur: 1450, parkingPriceEur: 10000, parkingSpaces: 1 }), assumptions);
    expect(rent.parkingEur).toBeNull();
    expect(rent.score).toBeNull();
  });

  it("takes the heating rate from the energy source, the label only when no source is named, else the middle rate", () => {
    const annual = (partial: Partial<typeof home>) => analyze(listing({ ...home, ...partial }), assumptions).annualHeating;
    expect(annual({ energySource: "Pellets", heating: "Zentralheizung" })).toBe(800);
    expect(annual({ energySource: "Pellets", heating: "Gas-Zentralheizung" })).toBe(800);
    // A fuel that is named but not recognised is unknown. The label does not override it.
    expect(annual({ energySource: "Brennstoffzelle", heating: "Gas" })).toBe(1200);
    expect(annual({ heating: "Gas" })).toBe(1100);
    expect(annual({ energySource: "Biogas" })).toBe(1100);
    expect(annual({ energySource: "Wärmepumpe" })).toBe(2800);
    expect(annual({ energySource: "Erdwärme" })).toBe(2800);
    expect(annual({ heating: "Zentralheizung" })).toBe(1200);
  });

  it("applies one heating adjustment to the energy subscore, never a stack", () => {
    const base = energyScore(analyze(home, assumptions)) ?? 0;
    const score = (partial: Partial<typeof home>, ctx = {}) => energyScore(analyze(listing({ ...home, ...partial }), assumptions, { nowYear: 2026, ...ctx })) ?? 0;
    expect(score({ energySource: "Öl" })).toBe(base - 12);
    expect(score({ energySource: "Gas" })).toBe(base - 8);
    expect(score({ energySource: "Gas" }, { heatingReplacedYear: 1980 })).toBe(base - 8);
    expect(score({}, { heatingReplacedYear: 1990 })).toBe(base - 8);
    expect(score({}, { heatingReplacedYear: 2001 })).toBe(base);
    expect(score({ energySource: "Wärmepumpe" })).toBe(base + 5);
    expect(score({ energySource: "Fernwärme" })).toBe(base + 5);
    // A stated heat pump or district heat is not made old by a boiler's age.
    expect(score({ energySource: "Wärmepumpe" }, { heatingReplacedYear: 1980 })).toBe(base + 5);
    expect(score({ energySource: "Fernwärme" }, { heatingReplacedYear: 1980 })).toBe(base + 5);
    expect(score({ energySource: "Pellets" })).toBe(base);
  });

  it("decides the fuel once, so the rate, the score and the flags agree", () => {
    const base = energyScore(analyze(home, assumptions)) ?? 0;
    const read = (partial: Partial<typeof home>) => {
      const result = analyze(listing({ ...home, ...partial }), assumptions, { nowYear: 2026 });
      return { rate: result.heatingEuroPerKwh, score: energyScore(result), flags: titles(result) };
    };
    // The source wins over a contradicting label.
    const pellets = read({ energySource: "Pellets", heating: "Gas-Zentralheizung" });
    expect(pellets).toMatchObject({ rate: 0.08, score: base });
    expect(pellets.flags).not.toContain("Fossil heating may need replacing");
    // District heat fed by gas is district heat.
    expect(read({ energySource: "Fernwärme aus Gas" })).toMatchObject({ rate: 0.16, score: base + 5 });
    expect(read({ energySource: "Fernwärme aus Gas" }).flags).not.toContain("Fossil heating may need replacing");
    // Biogas is not fossil, and "boiler" is not oil.
    expect(read({ energySource: "Biogas" })).toMatchObject({ rate: 0.11, score: base });
    expect(read({ energySource: "Biogas" }).flags).not.toContain("Fossil heating may need replacing");
    expect(read({ heating: "Gas-Brennwertkessel (boiler)" }).flags).not.toContain("Oil or night-storage heating");
    // A label alone still counts, exactly as the oil label always did.
    expect(read({ heating: "Gas-Zentralheizung" })).toMatchObject({ rate: 0.11, score: base - 8 });
    expect(read({ heating: "Wärmepumpe" })).toMatchObject({ rate: 0.28, score: base + 5 });
    expect(read({ heating: "Fernheizung" })).toMatchObject({ rate: 0.16, score: base + 5 });
    expect(read({ heating: "Erdwärme" })).toMatchObject({ rate: 0.28, score: base + 5 });
    expect(read({ heating: "Ölheizung" }).score).toBe(base - 12);
    expect(read({ heating: "Nachtspeicher" }).score).toBe(base - 12);
  });

  it("flags gas as fossil heating once, and leaves oil to its own flag", () => {
    expect(titles(analyze(listing({ ...home, energySource: "Gas" }), assumptions))).toContain("Fossil heating may need replacing");
    const oil = titles(analyze(listing({ ...home, energySource: "Öl" }), assumptions));
    expect(oil).toContain("Oil or night-storage heating");
    expect(oil).not.toContain("Fossil heating may need replacing");
  });

  it("raises flags from the history, the portal estimate and the text without moving any score", () => {
    const plain = analyze(home, assumptions);
    const history = { firstKnownPriceEur: 500000, totalChangeEur: -35000, totalChangePct: -7, reductions: 2, daysOnMarket: 150, startedBasis: "portal" as const };
    const findings = [
      { key: "special_levy" as const, label: "Special levy mentioned", snippet: "Eine Sonderumlage wurde beschlossen." },
      { key: "leasehold" as const, label: "Leasehold mentioned", snippet: "Erbbaurecht bis 2090." },
    ];
    const flagged = analyze(listing({ ...home, portalMarketEurPerM2: 5500 }), assumptions, { history, findings });
    expect(flagged.score).toBe(plain.score);
    expect(flagged.subscores).toEqual(plain.subscores);
    expect(titles(flagged)).toEqual(expect.arrayContaining(["Price has been reduced", "Long on the market", "Below the portal's own estimate", "Special levy mentioned", "Leasehold mentioned in the text"]));
    expect(flagged.flags.find((flag) => flag.title === "Price has been reduced")?.severity).toBe("good");
    expect(flagged.flags.find((flag) => flag.title === "Price has been reduced")?.detail).toContain("35.000 EUR");
  });

  it("is quiet when there is little to say: a small cut, days only from the saved date, a close estimate, a negated text", () => {
    const small = analyze(home, assumptions, { history: { firstKnownPriceEur: 470000, totalChangeEur: -5000, totalChangePct: -1.06, reductions: 1, daysOnMarket: 200, startedBasis: "saved" } });
    expect(small.flags.find((flag) => flag.title === "Price has been reduced")?.severity).toBe("info");
    expect(titles(small)).not.toContain("Long on the market");
    const near = analyze(listing({ ...home, portalMarketEurPerM2: 4500 }), assumptions);
    expect(titles(near).some((title) => title.includes("portal's own estimate"))).toBe(false);
    const leased = analyze(listing({ ...home, leasehold: true }), assumptions, { findings: [{ key: "leasehold", label: "Leasehold mentioned", snippet: "Erbbaurecht." }] });
    expect(titles(leased)).not.toContain("Leasehold mentioned in the text");
  });

  it("raises none of the buy flags for a rental", () => {
    const rent = analyze(listing({ ...home, offer: "rent", priceEur: 1450, coldRentEur: 1450, portalMarketEurPerM2: 1 }), assumptions, {
      history: { firstKnownPriceEur: 2000, totalChangeEur: -550, totalChangePct: -27, reductions: 3, daysOnMarket: 300, startedBasis: "portal" },
      findings: [{ key: "special_levy", label: "x", snippet: "Sonderumlage." }],
    });
    expect(rent.score).toBeNull();
    expect(titles(rent).filter((title) => ["Price has been reduced", "Long on the market", "Special levy mentioned"].includes(title))).toEqual([]);
  });
});
