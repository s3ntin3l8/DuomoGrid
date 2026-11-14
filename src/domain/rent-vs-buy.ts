import { annuityMonthly, roundEuro } from "./reference.js";

export type RentVsBuyInput = {
  /** What the home and any parking are worth on day one, the price the taxes and fees are charged on. */
  purchasePriceEur: number;
  /** Transfer tax, notary, land register and commission. Gone for good. */
  closingCostsEur: number;
  /** What the buyer pays in cash on day one: the cash to close less the loan. */
  equityPaidEur: number;
  loanEur: number;
  interestPercent: number;
  termYears: number;
  /** The owner's monthly costs that are neither the loan nor heating: Hausgeld, ground rent, upkeep, tax, insurance. */
  runningMonthlyEur: number;
  /** What a similar home costs to rent, cold. */
  coldRentEur: number;
  horizonYears: number;
  equityReturnPercent: number;
  appreciationPercent: number;
  rentGrowthPercent: number;
};

export type RentVsBuy = {
  horizonYears: number;
  /** Interest, running costs, the closing costs and the return the equity would have earned, per month, averaged over the horizon. */
  unrecoverableBuyMonthlyEur: number;
  /** Cold rent per month averaged over the horizon, with the assumed rent growth. */
  averageRentMonthlyEur: number;
  /** The home's value after the horizon, with the assumed appreciation. */
  homeValueEur: number;
  /** Still owed on the loan after the horizon. */
  remainingDebtEur: number;
  /** Home value less the debt. Selling costs are not counted. */
  netWealthBuyEur: number;
  /** The equity invested at the assumed return, plus every month's difference between what buying costs and what rent costs. */
  netWealthRentEur: number;
  /** Positive when buying leaves more wealth after the horizon than renting. */
  buyAdvantageEur: number;
};

/**
 * Both paths spend the same each month: the buyer pays the loan and the running costs, the renter pays the rent and
 * invests whatever that leaves, starting from the same cash the buyer put in. When rent is the larger of the two the
 * renter draws the difference from the portfolio. After the horizon the buyer holds the home less the debt, and the
 * renter holds the portfolio. Heating is left out on both sides because both pay it. Running costs do not grow.
 */
export function rentVsBuy(input: RentVsBuyInput): RentVsBuy | null {
  const months = Math.round(input.horizonYears * 12);
  const termMonths = Math.round(input.termYears * 12);
  const numbers = Object.values(input);
  if (months <= 0 || !numbers.every((value) => Number.isFinite(value))) return null;
  if (input.purchasePriceEur <= 0 || input.coldRentEur <= 0 || input.loanEur < 0 || input.equityPaidEur < 0) return null;

  const loanRate = input.interestPercent / 100 / 12;
  const payment = input.loanEur > 0 ? annuityMonthly(input.loanEur, input.interestPercent, input.termYears) : 0;
  const portfolioRate = (1 + input.equityReturnPercent / 100) ** (1 / 12) - 1;
  let debt = input.loanEur;
  let portfolio = input.equityPaidEur;
  let interestPaid = 0;
  let rentPaid = 0;
  for (let month = 0; month < months; month += 1) {
    const paying = month < termMonths && debt > 0;
    const interest = paying ? debt * loanRate : 0;
    const repaid = paying ? payment : 0;
    if (paying) debt = Math.max(0, debt - (payment - interest));
    interestPaid += interest;
    const rent = input.coldRentEur * (1 + input.rentGrowthPercent / 100) ** Math.floor(month / 12);
    rentPaid += rent;
    portfolio = portfolio * (1 + portfolioRate) + (repaid + input.runningMonthlyEur - rent);
  }
  const homeValue = input.purchasePriceEur * (1 + input.appreciationPercent / 100) ** input.horizonYears;
  const forgone = input.equityPaidEur * ((1 + input.equityReturnPercent / 100) ** input.horizonYears - 1);
  const unrecoverable = (interestPaid + input.runningMonthlyEur * months + input.closingCostsEur + forgone) / months;
  const netBuy = homeValue - debt;
  return {
    horizonYears: input.horizonYears,
    unrecoverableBuyMonthlyEur: roundEuro(unrecoverable),
    averageRentMonthlyEur: roundEuro(rentPaid / months),
    homeValueEur: roundEuro(homeValue),
    remainingDebtEur: roundEuro(debt),
    netWealthBuyEur: roundEuro(netBuy),
    netWealthRentEur: roundEuro(portfolio),
    buyAdvantageEur: roundEuro(netBuy - portfolio),
  };
}
