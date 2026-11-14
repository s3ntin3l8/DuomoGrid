import { DEFAULT_ASSUMPTIONS, STATES, type Assumptions, type StateId } from "./types.js";

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

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeAssumptions(input: unknown): Assumptions {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const state = typeof body.defaultState === "string" ? body.defaultState.toUpperCase() : "";
  const defaultState = STATES.some((item) => item.id === state) ? (state as StateId) : null;
  return {
    equityMode: body.equityMode === "eur" ? "eur" : "percent",
    equityPercent: numberOr(body.equityPercent, DEFAULT_ASSUMPTIONS.equityPercent),
    equityEur: numberOr(body.equityEur, DEFAULT_ASSUMPTIONS.equityEur),
    interestPercent: numberOr(body.interestPercent, DEFAULT_ASSUMPTIONS.interestPercent),
    termYears: numberOr(body.termYears, DEFAULT_ASSUMPTIONS.termYears),
    notaryPercent: numberOr(body.notaryPercent, DEFAULT_ASSUMPTIONS.notaryPercent),
    registerPercent: numberOr(body.registerPercent, DEFAULT_ASSUMPTIONS.registerPercent),
    fallbackCommissionPercent: numberOr(body.fallbackCommissionPercent, DEFAULT_ASSUMPTIONS.fallbackCommissionPercent),
    maintenanceEurPerM2Year: nonNegative(body.maintenanceEurPerM2Year, DEFAULT_ASSUMPTIONS.maintenanceEurPerM2Year),
    propertyTaxEurYear: nonNegative(body.propertyTaxEurYear, DEFAULT_ASSUMPTIONS.propertyTaxEurYear),
    insuranceEurPerM2Year: nonNegative(body.insuranceEurPerM2Year, DEFAULT_ASSUMPTIONS.insuranceEurPerM2Year),
    horizonYears: positive(body.horizonYears, DEFAULT_ASSUMPTIONS.horizonYears),
    equityReturnPercent: numberOr(body.equityReturnPercent, DEFAULT_ASSUMPTIONS.equityReturnPercent),
    appreciationPercent: numberOr(body.appreciationPercent, DEFAULT_ASSUMPTIONS.appreciationPercent),
    rentGrowthPercent: numberOr(body.rentGrowthPercent, DEFAULT_ASSUMPTIONS.rentGrowthPercent),
    monthlyBudgetEur: numberOrNull(body.monthlyBudgetEur),
    targetEurPerM2: numberOrNull(body.targetEurPerM2),
    defaultState,
  };
}
