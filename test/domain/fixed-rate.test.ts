import { describe, expect, it } from "vitest";
import { normalizeAssumptions } from "../../src/domain/assumptions.js";
import { annuityMonthly, remainingBalance } from "../../src/domain/reference.js";
import { DEFAULT_ASSUMPTIONS } from "../../src/domain/types.js";

/** The schedule written out month by month, independent of the closed formula. */
export function walk(loan: number, annualPercent: number, years: number, afterYears: number): number {
  const rate = annualPercent / 100 / 12;
  const payment = annuityMonthly(loan, annualPercent, years);
  let balance = loan;
  for (let month = 0; month < Math.round(afterYears * 12); month += 1) balance = balance * (1 + rate) - payment;
  return Math.max(0, balance);
}

function walkWith(loan: number, annualPercent: number, payment: number, afterYears: number): number {
  const rate = annualPercent / 100 / 12;
  let balance = loan;
  for (let month = 0; month < Math.round(afterYears * 12); month += 1) balance = balance * (1 + rate) - payment;
  return Math.max(0, balance);
}

describe("remainingBalance", () => {
  it("matches a hand-computed schedule: 100000 at 3.6 percent over 30 years, 10 years in", () => {
    expect(remainingBalance(100000, 3.6, 30, 10)).toBeCloseTo(77702.35, 2);
    expect(remainingBalance(100000, 3.6, 30, 10)).toBeCloseTo(walk(100000, 3.6, 30, 10), 6);
  });

  it("matches the month-by-month schedule across rates, terms and periods", () => {
    for (const [loan, rate, years, after] of [[250000, 4.2, 25, 15], [80000, 1.1, 20, 5], [400000, 6, 30, 29], [90000, 2.5, 10, 10]] as const) {
      expect(remainingBalance(loan, rate, years, after)).toBeCloseTo(walk(loan, rate, years, after), 4);
    }
  });

  it("follows a given payment instead of the exact annuity", () => {
    const exact = annuityMonthly(100000, 3.6, 30);
    expect(remainingBalance(100000, 3.6, 30, 10, Math.round(exact))).toBeCloseTo(walkWith(100000, 3.6, Math.round(exact), 10), 6);
    expect(remainingBalance(100000, 3.6, 30, 10, exact)).toBeCloseTo(remainingBalance(100000, 3.6, 30, 10), 9);
  });

  it("handles a zero rate, a zero period and a period that covers the term", () => {
    expect(remainingBalance(100000, 0, 30, 10)).toBeCloseTo(66666.67, 2);
    expect(remainingBalance(100000, 3.6, 30, 0)).toBeCloseTo(100000, 6);
    expect(remainingBalance(100000, 3.6, 30, 30)).toBe(0);
    expect(remainingBalance(100000, 3.6, 30, 40)).toBe(0);
    expect(remainingBalance(0, 3.6, 30, 10)).toBe(0);
  });
});

describe("normalizeAssumptions fixedYears", () => {
  it("fills the default for a row saved before the field existed", () => {
    expect(normalizeAssumptions({ interestPercent: 4 }).fixedYears).toBe(DEFAULT_ASSUMPTIONS.fixedYears);
  });

  it("accepts a number or a numeric string", () => {
    expect(normalizeAssumptions({ fixedYears: 15 }).fixedYears).toBe(15);
    expect(normalizeAssumptions({ fixedYears: "20" }).fixedYears).toBe(20);
  });

  it("is never longer than the term", () => {
    expect(normalizeAssumptions({ termYears: 25, fixedYears: 40 }).fixedYears).toBe(25);
    expect(normalizeAssumptions({ termYears: 25, fixedYears: 15 }).fixedYears).toBe(15);
    expect(normalizeAssumptions({ termYears: 5 }).fixedYears).toBe(5);
  });

  it("falls back to the default for zero, negative and invalid values", () => {
    for (const value of [0, -5, "abc", null]) expect(normalizeAssumptions({ fixedYears: value }).fixedYears).toBe(10);
  });
});
