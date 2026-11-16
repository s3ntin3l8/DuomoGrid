import {
  BUILTIN_PROVENANCE,
  DEFAULT_ASSUMPTIONS,
  STATES,
  type Assumptions,
  type Provenance,
  type StateId,
} from "./types.js";

function numberOr(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** A cost cannot be negative, so a negative figure falls back to the default rather than lowering the monthly total. */
function nonNegative(value: unknown, fallback: number): number {
  const parsed = numberOr(value, fallback);
  return parsed >= 0 ? parsed : fallback;
}

/** A period of zero or less is meaningless, so it falls back to the default. */
function positive(value: unknown, fallback: number): number {
  const parsed = numberOr(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

/** A yearly change may be negative, but never -100 percent or less, where compounding stops making sense. */
function yearlyRate(value: unknown, fallback: number): number {
  const parsed = numberOr(value, fallback);
  return parsed > -100 && parsed <= 1000 ? parsed : fallback;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read the origin of a value. An unknown origin is `builtin`, never `user`: a row that claims the
 * user set a number but does not say so must not be protected from a refresh.
 */
function provenanceOr(value: unknown): Provenance {
  if (!value || typeof value !== "object") return BUILTIN_PROVENANCE;
  const body = value as Record<string, unknown>;
  const source = body.source === "user" || body.source === "market" || body.source === "builtin" ? body.source : "builtin";
  const asOf = typeof body.asOf === "string" && body.asOf.trim() ? body.asOf.trim() : null;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
  return { source, asOf, note };
}

export function normalizeAssumptions(input: unknown): Assumptions {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const state = typeof body.defaultState === "string" ? body.defaultState.toUpperCase() : "";
  const defaultState = STATES.some((item) => item.id === state) ? (state as StateId) : null;
  const termYears = positive(body.termYears, DEFAULT_ASSUMPTIONS.termYears);
  return {
    equityMode: body.equityMode === "eur" ? "eur" : "percent",
    equityPercent: numberOr(body.equityPercent, DEFAULT_ASSUMPTIONS.equityPercent),
    equityEur: numberOr(body.equityEur, DEFAULT_ASSUMPTIONS.equityEur),
    interestPercent: nonNegative(body.interestPercent, DEFAULT_ASSUMPTIONS.interestPercent),
    interestProvenance: provenanceOr(body.interestProvenance),
    termYears,
    // A fixed-rate period longer than the loan is the whole loan.
    fixedYears: Math.min(positive(body.fixedYears, DEFAULT_ASSUMPTIONS.fixedYears), termYears),
    notaryPercent: numberOr(body.notaryPercent, DEFAULT_ASSUMPTIONS.notaryPercent),
    notaryProvenance: provenanceOr(body.notaryProvenance),
    registerPercent: numberOr(body.registerPercent, DEFAULT_ASSUMPTIONS.registerPercent),
    registerProvenance: provenanceOr(body.registerProvenance),
    fallbackCommissionPercent: numberOr(body.fallbackCommissionPercent, DEFAULT_ASSUMPTIONS.fallbackCommissionPercent),
    commissionProvenance: provenanceOr(body.commissionProvenance),
    maintenanceEurPerM2Year: nonNegative(body.maintenanceEurPerM2Year, DEFAULT_ASSUMPTIONS.maintenanceEurPerM2Year),
    propertyTaxEurYear: nonNegative(body.propertyTaxEurYear, DEFAULT_ASSUMPTIONS.propertyTaxEurYear),
    insuranceEurPerM2Year: nonNegative(body.insuranceEurPerM2Year, DEFAULT_ASSUMPTIONS.insuranceEurPerM2Year),
    // At most 50 years: a longer comparison is not a plan, and the simulation is month by month.
    horizonYears: Math.min(positive(body.horizonYears, DEFAULT_ASSUMPTIONS.horizonYears), 50),
    equityReturnPercent: yearlyRate(body.equityReturnPercent, DEFAULT_ASSUMPTIONS.equityReturnPercent),
    appreciationPercent: yearlyRate(body.appreciationPercent, DEFAULT_ASSUMPTIONS.appreciationPercent),
    rentGrowthPercent: yearlyRate(body.rentGrowthPercent, DEFAULT_ASSUMPTIONS.rentGrowthPercent),
    monthlyBudgetEur: numberOrNull(body.monthlyBudgetEur),
    targetEurPerM2: numberOrNull(body.targetEurPerM2),
    defaultState,
  };
}
