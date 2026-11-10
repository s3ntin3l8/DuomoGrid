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
