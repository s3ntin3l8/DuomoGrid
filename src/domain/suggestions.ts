import { fetchEnergyPrices, energyRatesFrom, type EnergyPrices, type GenesisCredentials } from "./energy-prices.js";
import { fetchMarketRates, suggestInterestRate, type MarketRates, type RateSuggestion } from "./market-rates.js";
import type { Assumptions, Provenance } from "./types.js";

/**
 * What the desk can offer for a value, and why. A suggestion is never applied on its own: the
 * owner accepts it, and then it becomes a `market` value that a later refresh may move.
 */
export type Suggestion = {
  value: number;
  /** The period the figure belongs to, as published. */
  asOf: string;
  /** Who published it. */
  source: string;
  /** The lower and upper bound of the range the figure sits in, when there is one. */
  lowPercent: number | null;
  highPercent: number | null;
  /** True when the publisher marked the figure provisional. It will be revised. */
  preliminary: boolean;
  /** A sentence the desk shows under the field. */
  detail: string;
};

export type MarketSnapshot = {
  /** The rates, or null when they could not be read. */
  rates: MarketRates | null;
  /** The energy prices, or null when there is no account or the feed failed. */
  energy: EnergyPrices | null;
  /** When the snapshot was taken, as an ISO timestamp. */
  fetchedAt: string;
  /** Why a part of the snapshot is missing, when it is. */
  note: string | null;
};

export type Suggestions = {
  interest: Suggestion | null;
  notary: Suggestion | null;
  register: Suggestion | null;
  commission: Suggestion | null;
};

/**
 * The notary and land register fees are set by the Gerichts- und Notarkostengesetz, the same in
 * every federal state, and the buyer's share of the commission is capped by law. They are not
 * market figures and there is nothing to refresh, so they carry a rule as their source.
 */
const NOTARY_SUGGESTION = {
  value: 1.5,
  asOf: "2026",
  source: "Gerichts- und Notarkostengesetz (GNotKG)",
  detail: "Notary and land register together are about 1.5 percent of the price. The fees are the same in every state.",
};

const REGISTER_SUGGESTION = {
  value: 0.5,
  asOf: "2026",
  source: "Gerichts- und Notarkostengesetz (GNotKG)",
  detail: "The land register costs about 0.5 percent of the price.",
};

const COMMISSION_SUGGESTION = {
  value: 3.57,
  asOf: "2026",
  source: "§ 656c BGB",
  detail: "Since 2020 the buyer pays at most half the commission, which is 3.57 percent including VAT.",
};

function ruleSuggestion(rule: typeof NOTARY_SUGGESTION): Suggestion {
  return { ...rule, lowPercent: null, highPercent: null, preliminary: false };
}

/** The suggestions the desk offers, given a market snapshot. */
export function suggestionsFor(snapshot: MarketSnapshot | null): Suggestions {
  const rate = snapshot?.rates ? suggestInterestRate(snapshot.rates) : null;
  const interest: Suggestion | null = rate
    ? {
        value: rate.value,
        asOf: rate.asOf,
        source: rate.source,
        lowPercent: rate.lowPercent,
        highPercent: rate.highPercent,
        preliminary: rate.preliminary,
        detail: interestDetail(rate, snapshot?.rates?.secured10yRangeMonths ?? 0),
      }
    : null;
  return {
    interest,
    notary: ruleSuggestion(NOTARY_SUGGESTION),
    register: ruleSuggestion(REGISTER_SUGGESTION),
    commission: ruleSuggestion(COMMISSION_SUGGESTION),
  };
}

/** A sentence the desk shows under the interest field. */
function interestDetail(rate: RateSuggestion, months: number): string {
  const period = rate.asOf ? rate.asOf : "the latest month";
  const band =
    rate.lowPercent != null && rate.highPercent != null && rate.highPercent > rate.lowPercent && months > 1
      ? ` It has moved between ${rate.lowPercent.toFixed(2)} and ${rate.highPercent.toFixed(2)} percent over the last ${months} months.`
      : "";
  const provisional = rate.preliminary ? " This figure is provisional and will be revised." : "";
  return `The average effective rate for new residential mortgages of 10 years or more, secured by a lien, was ${rate.value.toFixed(2)} percent in ${period}.${band}${provisional}`;
}

function provenanceFor(suggestion: Suggestion): Provenance {
  return { source: "market", asOf: suggestion.asOf || null, note: suggestion.source };
}

/**
 * Accept a suggestion. The value becomes a `market` value, so a later refresh may move it again.
 */
export function applySuggestion(assumptions: Assumptions, field: "interest" | "notary" | "register" | "commission", suggestion: Suggestion | null): Assumptions {
  if (!suggestion) return assumptions;
  const next: Assumptions = { ...assumptions };
  if (field === "interest") {
    next.interestPercent = suggestion.value;
    next.interestProvenance = provenanceFor(suggestion);
  } else if (field === "notary") {
    next.notaryPercent = suggestion.value;
    next.notaryProvenance = provenanceFor(suggestion);
  } else if (field === "register") {
    next.registerPercent = suggestion.value;
    next.registerProvenance = provenanceFor(suggestion);
  } else {
    next.fallbackCommissionPercent = suggestion.value;
    next.commissionProvenance = provenanceFor(suggestion);
  }
  return next;
}

/**
 * Mark a value as the owner's own, so a refresh leaves it alone.
 */
export function pinField(assumptions: Assumptions, field: "interest" | "notary" | "register" | "commission"): Assumptions {
  const next: Assumptions = { ...assumptions };
  const provenance: Provenance = { source: "user", asOf: null, note: null };
  if (field === "interest") next.interestProvenance = provenance;
  else if (field === "notary") next.notaryProvenance = provenance;
  else if (field === "register") next.registerProvenance = provenance;
  else next.commissionProvenance = provenance;
  return next;
}

/**
 * Move the values a refresh is allowed to move.
 *
 * A `user` value is never touched: the owner typed it. A `builtin` value is not touched either,
 * because a score that changes because a statistic was revised is a score nobody can explain. Only
 * a value the owner accepted from the market follows the market.
 */
export function refreshAssumptions(assumptions: Assumptions, suggestions: Suggestions): Assumptions {
  const next: Assumptions = { ...assumptions };
  if (assumptions.interestProvenance.source === "market" && suggestions.interest) {
    next.interestPercent = suggestions.interest.value;
    next.interestProvenance = provenanceFor(suggestions.interest);
  }
  if (assumptions.notaryProvenance.source === "market" && suggestions.notary) {
    next.notaryPercent = suggestions.notary.value;
    next.notaryProvenance = provenanceFor(suggestions.notary);
  }
  if (assumptions.registerProvenance.source === "market" && suggestions.register) {
    next.registerPercent = suggestions.register.value;
    next.registerProvenance = provenanceFor(suggestions.register);
  }
  if (assumptions.commissionProvenance.source === "market" && suggestions.commission) {
    next.fallbackCommissionPercent = suggestions.commission.value;
    next.commissionProvenance = provenanceFor(suggestions.commission);
  }
  return next;
}

/**
 * Read the market data. The rates need no account. The energy prices need a GENESIS account, and
 * without one only the energy part is missing.
 */
export async function readMarketSnapshot(
  credentials: GenesisCredentials | null,
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<MarketSnapshot> {
  const [rates, energy] = await Promise.all([
    fetchMarketRates(fetcher, now).catch(() => null),
    fetchEnergyPrices(credentials, fetcher, now).catch(() => null),
  ]);
  const note = !rates && !energy
    ? "The market data could not be read. The last known values are still in use."
    : rates && !energy
      ? credentials
        ? "The energy prices could not be read. The rates are current."
        : "No GENESIS account is configured, so there are no energy prices. Set DESTATIS_API_TOKEN to add them."
      : null;
  return { rates, energy, fetchedAt: now.toISOString(), note };
}

export { energyRatesFrom };
export type { EnergyPrices, MarketRates, RateSuggestion };
