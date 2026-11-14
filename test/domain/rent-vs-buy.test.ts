import { describe, expect, it } from "vitest";
import { normalizeAssumptions } from "../../src/domain/assumptions.js";
import { rentAgainstBuy, type CohortRow, type PurchaseSnapshot } from "../../src/domain/compare.js";
import { rentVsBuy, type RentVsBuyInput } from "../../src/domain/rent-vs-buy.js";
import { DEFAULT_ASSUMPTIONS } from "../../src/domain/types.js";

const flat: RentVsBuyInput = {
  purchasePriceEur: 200000,
  closingCostsEur: 0,
  equityPaidEur: 200000,
  loanEur: 0,
  interestPercent: 0,
  termYears: 30,
  runningMonthlyEur: 100,
  coldRentEur: 1000,
  horizonYears: 10,
  equityReturnPercent: 0,
  appreciationPercent: 0,
  rentGrowthPercent: 0,
};

/** The balance of an annuity loan after some months, from the closed form. */
function balanceAfter(loan: number, annualPercent: number, years: number, months: number): number {
  const rate = annualPercent / 100 / 12;
  const total = years * 12;
  const payment = (loan * rate * (1 + rate) ** total) / ((1 + rate) ** total - 1);
  return loan * (1 + rate) ** months - (payment * ((1 + rate) ** months - 1)) / rate;
}

describe("rentVsBuy", () => {
  it("is exact when nothing grows, nothing is borrowed and nothing is earned", () => {
    const result = rentVsBuy(flat);
    // Buying costs 100 a month in running costs, renting 1000. Over 120 months the renter draws 108000 from 200000.
    expect(result).toEqual({
      horizonYears: 10,
      unrecoverableBuyMonthlyEur: 100,
      averageRentMonthlyEur: 1000,
      homeValueEur: 200000,
      remainingDebtEur: 0,
      netWealthBuyEur: 200000,
      netWealthRentEur: 92000,
      buyAdvantageEur: 108000,
    });
  });

  it("matches the closed form for a portfolio that earns a return on a constant monthly difference", () => {
    const result = rentVsBuy({ ...flat, equityReturnPercent: 4, runningMonthlyEur: 1200, coldRentEur: 1000 });
    const monthly = 1.04 ** (1 / 12) - 1;
    const growth = (1 + monthly) ** 120;
    // The buyer pays 200 more than the renter each month, which the renter does not have to spend, so it is invested.
    // That difference is negative for the renter's portfolio: it is 1200 out for the buyer and 1000 for the renter.
    const expected = 200000 * growth + (1200 - 1000) * ((growth - 1) / monthly);
    expect(result?.netWealthRentEur).toBe(Math.round(expected));
    // The equity earned 4 percent a year for 10 years, so 200000 x (1.04^10 - 1) is the return that was given up.
    expect(result?.unrecoverableBuyMonthlyEur).toBe(Math.round((1200 * 120 + 200000 * (1.04 ** 10 - 1)) / 120));
  });

  it("follows the loan: the debt left is the closed-form balance and the interest is what the payments exceed it by", () => {
    const input: RentVsBuyInput = { ...flat, purchasePriceEur: 300000, closingCostsEur: 35000, equityPaidEur: 70000, loanEur: 265000, interestPercent: 3.6, termYears: 30, runningMonthlyEur: 250 };
    const result = rentVsBuy(input);
    expect(result?.remainingDebtEur).toBe(Math.round(balanceAfter(265000, 3.6, 30, 120)));
    const payment = (265000 * (0.036 / 12) * (1 + 0.036 / 12) ** 360) / ((1 + 0.036 / 12) ** 360 - 1);
    const interest = payment * 120 - (265000 - balanceAfter(265000, 3.6, 30, 120));
    expect(result?.unrecoverableBuyMonthlyEur).toBe(Math.round((interest + 250 * 120 + 35000) / 120));
  });

  it("applies appreciation to the home and growth to the rent, once a year", () => {
    const result = rentVsBuy({ ...flat, appreciationPercent: 2, rentGrowthPercent: 3, horizonYears: 2 });
    expect(result?.homeValueEur).toBe(Math.round(200000 * 1.02 ** 2));
    // 12 months at 1000 and 12 at 1030.
    expect(result?.averageRentMonthlyEur).toBe(1015);
  });

  it("stops paying the loan after its term, even when the horizon is longer", () => {
    const result = rentVsBuy({ ...flat, loanEur: 100000, equityPaidEur: 100000, interestPercent: 3, termYears: 10, horizonYears: 15 });
    expect(result?.remainingDebtEur).toBe(0);
  });

  it("keeps the monthly amount fixed past the end of the loan: the buyer invests the payment that is freed", () => {
    // A 120000 loan at 0 percent over 10 years is 1000 a month. Running costs 100, rent 1200, nothing earns or grows.
    const result = rentVsBuy({ ...flat, purchasePriceEur: 200000, equityPaidEur: 80000, loanEur: 120000, termYears: 10, horizonYears: 15, runningMonthlyEur: 100, coldRentEur: 1200 });
    // Both spend 1100 a month. The buyer holds the home, no debt, and 60 months of the freed 1000: 260000.
    expect(result?.netWealthBuyEur).toBe(260000);
    // The renter starts with 80000 and spends 100 more than the 1100 every month for 180 months: 80000 - 18000.
    expect(result?.netWealthRentEur).toBe(62000);
    expect(result?.buyAdvantageEur).toBe(198000);
    expect(result?.remainingDebtEur).toBe(0);
  });

  it("never gives the renter a negative portfolio just because the horizon is longer than the loan", () => {
    const longer = rentVsBuy({ ...flat, purchasePriceEur: 400000, closingCostsEur: 45000, equityPaidEur: 124000, loanEur: 321000, interestPercent: 3.6, termYears: 25, horizonYears: 40, runningMonthlyEur: 350, coldRentEur: 1500, equityReturnPercent: 3 });
    expect(longer?.netWealthRentEur ?? -1).toBeGreaterThan(0);
  });

  it("reports the horizon it simulated", () => {
    expect(rentVsBuy({ ...flat, horizonYears: 2.51 })?.horizonYears).toBe(2.5);
    expect(rentVsBuy({ ...flat, horizonYears: 10 })?.horizonYears).toBe(10);
  });

  it("counts months, not the stated years, for the home's value", () => {
    // 2.51 years is 30 months.
    expect(rentVsBuy({ ...flat, appreciationPercent: 2, horizonYears: 2.51 })?.homeValueEur).toBe(Math.round(200000 * 1.02 ** 2.5));
  });

  it("is null instead of a wrong number when a rate makes the compounding meaningless", () => {
    expect(rentVsBuy({ ...flat, equityReturnPercent: -150 })).toBeNull();
    expect(rentVsBuy({ ...flat, appreciationPercent: -150 })).toBeNull();
    expect(rentVsBuy({ ...flat, rentGrowthPercent: -100 })).toBeNull();
    expect(rentVsBuy({ ...flat, equityReturnPercent: 1e9 })).toBeNull();
    expect(rentVsBuy({ ...flat, appreciationPercent: -99 })).not.toBeNull();
    expect(rentVsBuy({ ...flat, loanEur: 100000, equityPaidEur: 100000, interestPercent: -50 })).toBeNull();
  });

  it("does not simulate more than 50 years", () => {
    expect(rentVsBuy({ ...flat, horizonYears: 50 })).not.toBeNull();
    expect(rentVsBuy({ ...flat, horizonYears: 50.5 })).toBeNull();
    expect(rentVsBuy({ ...flat, horizonYears: 1e9 })).toBeNull();
  });

  it("is null for a horizon that is not positive, a missing rent or a non-finite figure", () => {
    expect(rentVsBuy({ ...flat, horizonYears: 0 })).toBeNull();
    expect(rentVsBuy({ ...flat, coldRentEur: 0 })).toBeNull();
    expect(rentVsBuy({ ...flat, purchasePriceEur: Number.NaN })).toBeNull();
  });
});

const rental = (coldRentEur: number | null, city = "Darmstadt", propertyType = "apartment", livingAreaM2: number | null = 70): CohortRow => ({ offer: "rent", city, propertyType, livingAreaM2, priceEur: coldRentEur, coldRentEur });
const subject = (purchase: PurchaseSnapshot | null) => ({ offer: "buy" as const, city: "Darmstadt", propertyType: "apartment", livingAreaM2: 80, priceEur: 300000, coldRentEur: null, purchase });
const purchase: PurchaseSnapshot = { purchasePriceEur: 300000, closingCostsEur: 35000, equityPaidEur: 70000, loanEur: 265000, runningMonthlyEur: 300 };

describe("rentAgainstBuy", () => {
  it("uses the median cold rent of the saved rentals in the same city and type", () => {
    const result = rentAgainstBuy(subject(purchase), [rental(1000), rental(1400), rental(2000), rental(5000, "Mainz"), rental(9000, "Darmstadt", "house")], DEFAULT_ASSUMPTIONS);
    expect(result?.rentCount).toBe(3);
    expect(result?.medianColdRentEur).toBe(1400);
    expect(result?.horizon?.horizonYears).toBe(10);
    expect(result?.horizon?.averageRentMonthlyEur).toBeGreaterThan(1400);
  });

  it("compares only with rentals of a similar size, and keeps one with an unknown area", () => {
    // The subject has 80 m2: 56 to 104 m2 is similar.
    const rows = [rental(700, "Darmstadt", "apartment", 35), rental(1200, "Darmstadt", "apartment", 70), rental(1600, "Darmstadt", "apartment", 90), rental(3000, "Darmstadt", "apartment", 110), rental(1400, "Darmstadt", "apartment", null)];
    const result = rentAgainstBuy(subject(purchase), rows, DEFAULT_ASSUMPTIONS);
    expect(result?.rentCount).toBe(3);
    expect(result?.medianColdRentEur).toBe(1400);
    // Nothing of a similar size: no sample, so no horizon, rather than a rent from a different home.
    expect(rentAgainstBuy(subject(purchase), [rental(700, "Darmstadt", "apartment", 35)], DEFAULT_ASSUMPTIONS)).toEqual({ rentCount: 0, medianColdRentEur: null, horizon: null });
  });

  it("reads the assumptions", () => {
    const rows = [rental(1400)];
    const base = rentAgainstBuy(subject(purchase), rows, DEFAULT_ASSUMPTIONS)?.horizon;
    const longer = rentAgainstBuy(subject(purchase), rows, { ...DEFAULT_ASSUMPTIONS, horizonYears: 20 })?.horizon;
    const hot = rentAgainstBuy(subject(purchase), rows, { ...DEFAULT_ASSUMPTIONS, appreciationPercent: 5 })?.horizon;
    expect(longer?.horizonYears).toBe(20);
    expect(hot?.homeValueEur ?? 0).toBeGreaterThan(base?.homeValueEur ?? 0);
  });

  it("has no horizon without a rent sample or when the cost of owning is incomplete, and is null for a rental", () => {
    expect(rentAgainstBuy(subject(purchase), [], DEFAULT_ASSUMPTIONS)).toEqual({ rentCount: 0, medianColdRentEur: null, horizon: null });
    expect(rentAgainstBuy(subject(null), [rental(1400)], DEFAULT_ASSUMPTIONS)?.horizon).toBeNull();
    expect(rentAgainstBuy({ ...subject(purchase), offer: "rent" }, [rental(1400)], DEFAULT_ASSUMPTIONS)).toBeNull();
  });
});

describe("normalizeAssumptions rent or buy", () => {
  it("fills the defaults and keeps negative returns and appreciation", () => {
    const old = normalizeAssumptions({});
    expect([old.horizonYears, old.equityReturnPercent, old.appreciationPercent, old.rentGrowthPercent]).toEqual([10, 3, 1.5, 2]);
    const falling = normalizeAssumptions({ horizonYears: "15", equityReturnPercent: 0, appreciationPercent: -1, rentGrowthPercent: "0" });
    expect([falling.horizonYears, falling.equityReturnPercent, falling.appreciationPercent, falling.rentGrowthPercent]).toEqual([15, 0, -1, 0]);
  });

  it("keeps a loan rate from going negative", () => {
    expect(normalizeAssumptions({ interestPercent: -2 }).interestPercent).toBe(DEFAULT_ASSUMPTIONS.interestPercent);
    expect(normalizeAssumptions({ interestPercent: 0 }).interestPercent).toBe(0);
    expect(normalizeAssumptions({ interestPercent: "4.25" }).interestPercent).toBe(4.25);
  });

  it("caps the horizon at 50 years and refuses rates of -100 percent or less", () => {
    expect(normalizeAssumptions({ horizonYears: 1000000 }).horizonYears).toBe(50);
    expect(normalizeAssumptions({ horizonYears: 50 }).horizonYears).toBe(50);
    const bad = normalizeAssumptions({ equityReturnPercent: -100, appreciationPercent: -250, rentGrowthPercent: 1e9 });
    expect([bad.equityReturnPercent, bad.appreciationPercent, bad.rentGrowthPercent]).toEqual([3, 1.5, 2]);
    expect(normalizeAssumptions({ appreciationPercent: -99 }).appreciationPercent).toBe(-99);
  });

  it("falls back to the default for a loan term that is not positive", () => {
    for (const value of [0, -30, "x"]) expect(normalizeAssumptions({ termYears: value }).termYears).toBe(30);
    expect(normalizeAssumptions({ termYears: 25 }).termYears).toBe(25);
  });

  it("falls back to the default for a horizon that is not positive", () => {
    for (const value of [0, -3, "x"]) expect(normalizeAssumptions({ horizonYears: value }).horizonYears).toBe(10);
  });
});
