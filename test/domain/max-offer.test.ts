import { describe, expect, it } from "vitest";
import { analyze } from "../../src/domain/analyze.js";
import { parseIngest } from "../../src/domain/ingest.js";
import { maxOffer, WORTH_A_LOOK } from "../../src/domain/max-offer.js";
import { DEFAULT_ASSUMPTIONS, type Assumptions, type ListingInput } from "../../src/domain/types.js";

function built(extra: Record<string, unknown> = {}): ListingInput {
  const parsed = parseIngest({
    title: "Flat",
    offer: "buy",
    priceEur: 300000,
    livingAreaM2: 80,
    rooms: 3,
    city: "Darmstadt",
    postalCode: "64283",
    state: "HE",
    propertyType: "apartment",
    yearBuilt: 2000,
    hausgeldEur: 300,
    energyClass: "C",
    heating: "Gas",
    ...extra,
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.listing;
}

const withBudget: Assumptions = { ...DEFAULT_ASSUMPTIONS, monthlyBudgetEur: 1800 };
const withTarget: Assumptions = { ...DEFAULT_ASSUMPTIONS, targetEurPerM2: 3750 };
const at = (listing: ListingInput, assumptions: Assumptions, price: number) => analyze({ ...listing, priceEur: price }, assumptions, { nowYear: 2026 });

describe("maxOffer budget price", () => {
  it("is the highest price whose monthly total still fits the budget", () => {
    const listing = built();
    const found = maxOffer(listing, withBudget, { nowYear: 2026 })?.budgetPriceEur;
    expect(found).not.toBeNull();
    const price = found ?? 0;
    const total = at(listing, withBudget, price).monthlyTotal ?? Number.NaN;
    expect(total).toBeLessThanOrEqual(1800);
    expect(1800 - total).toBeLessThan(1);
    expect(at(listing, withBudget, price + 1).monthlyTotal ?? 0).toBeGreaterThan(1800);
  });

  it("keeps transfer tax, commission and parking as they are for the real listing", () => {
    const listing = built({ parkingPriceEur: 20000, parkingSpaces: 1 });
    const price = maxOffer(listing, withBudget, { nowYear: 2026 })?.budgetPriceEur ?? 0;
    const solved = at(listing, withBudget, price);
    expect(solved.parkingEur).toBe(20000);
    expect(solved.monthlyTotal ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1800);
    expect(at(listing, withBudget, price + 1).monthlyTotal ?? 0).toBeGreaterThan(1800);
  });

  it("is a higher price for a bigger budget", () => {
    const listing = built();
    const small = maxOffer(listing, { ...withBudget, monthlyBudgetEur: 1500 })?.budgetPriceEur ?? 0;
    const large = maxOffer(listing, { ...withBudget, monthlyBudgetEur: 2200 })?.budgetPriceEur ?? 0;
    expect(large).toBeGreaterThan(small);
  });

  it("is null without a budget, when the budget cannot cover the costs of any price, and when the total is unknown", () => {
    expect(maxOffer(built(), DEFAULT_ASSUMPTIONS)?.budgetPriceEur).toBeNull();
    expect(maxOffer(built(), { ...DEFAULT_ASSUMPTIONS, monthlyBudgetEur: 10 })?.budgetPriceEur).toBeNull();
    // No state anywhere, so transfer tax and with it the loan and the total are unknown at every price.
    const noState = built({ state: null, postalCode: null });
    expect(maxOffer(noState, withBudget)?.budgetPriceEur).toBeNull();
    // A house without a living area has no maintenance, so its total is unknown at every price.
    const noArea = built({ propertyType: "house", livingAreaM2: null });
    expect(maxOffer(noArea, withBudget)?.budgetPriceEur).toBeNull();
  });
});

describe("maxOffer score price", () => {
  it("is the highest price at which the score still reaches worth a look", () => {
    const listing = built();
    const result = maxOffer(listing, withTarget, { nowYear: 2026 });
    expect(result?.scoreTarget).toBe(WORTH_A_LOOK);
    const price = result?.scorePriceEur ?? 0;
    expect(price).toBeGreaterThan(0);
    expect(at(listing, withTarget, price).score ?? 0).toBeGreaterThanOrEqual(WORTH_A_LOOK);
    expect(at(listing, withTarget, price + 1).score ?? 100).toBeLessThan(WORTH_A_LOOK);
  });

  it("is null when no price reference exists, because the score then never depends on the price", () => {
    // Darmstadt has a city guide price, so the default assumptions already give it a reference. A town without one does not.
    expect(maxOffer(built({ city: "Nirgendwo" }), DEFAULT_ASSUMPTIONS)?.scorePriceEur).toBeNull();
  });

  it("falls back to the city guide price when no target is set", () => {
    expect(maxOffer(built(), DEFAULT_ASSUMPTIONS)?.scorePriceEur).toBeGreaterThan(0);
  });
});

describe("maxOffer applicability", () => {
  it("is null for a rental, which is never scored", () => {
    expect(maxOffer(built({ offer: "rent", priceEur: 1200 }), withBudget)).toBeNull();
  });
});
