import { DEFAULT_ASSUMPTIONS, STATES, type Assumptions, type StateId } from "./types.js";

function numberOr(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
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
    monthlyBudgetEur: numberOrNull(body.monthlyBudgetEur),
    targetEurPerM2: numberOrNull(body.targetEurPerM2),
    defaultState,
  };
}
