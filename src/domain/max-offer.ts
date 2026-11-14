import { analyze, WORTH_A_LOOK, type AnalysisContext } from "./analyze.js";
import type { Assumptions, ListingInput } from "./types.js";

/**
 * No search goes below this. Fees are rounded to whole euros, so at a price of a few euros the cost load looks lower than
 * it is, and the score is spuriously high. From here the rounding is far too small to move a score.
 */
const FLOOR_EUR = 10_000;
/** No search goes above this. A result at the ceiling means nothing stopped the price from rising, so it is not a price. */
const CEILING_EUR = 50_000_000;

export { WORTH_A_LOOK };

export type MaxOffer = {
  /** The highest asking price at which the monthly total still fits the monthly budget. */
  budgetPriceEur: number | null;
  /** The highest asking price at which the buy score is still at the target. */
  scorePriceEur: number | null;
  scoreTarget: number;
};

/**
 * The largest whole-euro price for which `fits` holds. It assumes a price that fits stays fitting when it falls, so
 * that a bisection finds the edge. It is null when even the floor does not fit, and when the ceiling still does.
 */
function highestFitting(fits: (price: number) => boolean): number | null {
  if (!fits(FLOOR_EUR) || fits(CEILING_EUR)) return null;
  let low = FLOOR_EUR;
  let high = CEILING_EUR;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}

/**
 * Runs `analyze()` again with the price changed, so transfer tax, notary, commission, parking and equity stay exactly as
 * they are for the real listing. Unknown stays null: without a budget, or when the monthly total cannot be known at any
 * price (no state, no living area for a house), there is no budget price, and it is never 0.
 */
export function maxOffer(listing: ListingInput, assumptions: Assumptions, market: AnalysisContext = {}): MaxOffer | null {
  if (listing.offer !== "buy") return null;
  const at = (price: number) => analyze({ ...listing, priceEur: price }, assumptions, market);
  const budget = assumptions.monthlyBudgetEur;
  const budgetPriceEur =
    budget != null && budget > 0
      ? highestFitting((price) => {
          const total = at(price).monthlyTotal;
          return total != null && total <= budget;
        })
      : null;
  const scorePriceEur = highestFitting((price) => {
    const score = at(price).score;
    return score != null && score >= WORTH_A_LOOK;
  });
  return { budgetPriceEur, scorePriceEur, scoreTarget: WORTH_A_LOOK };
}
