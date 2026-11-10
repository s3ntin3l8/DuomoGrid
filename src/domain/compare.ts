import { fold } from "./reference.js";
import type { Offer } from "./types.js";

export type CohortRow = {
  offer: Offer;
  city: string;
  propertyType: string;
  livingAreaM2: number | null;
  priceEur: number | null;
  coldRentEur: number | null;
};

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function perM2(row: CohortRow): number | null {
  if (row.livingAreaM2 == null || row.livingAreaM2 <= 0) return null;
  const money = row.offer === "rent" ? (row.coldRentEur ?? row.priceEur) : row.priceEur;
  if (money == null || money <= 0) return null;
  return money / row.livingAreaM2;
}

function similar(subject: CohortRow, other: CohortRow): boolean {
  if (other.offer !== subject.offer) return false;
  if (fold(other.city) !== fold(subject.city) || !fold(subject.city)) return false;
  if (other.propertyType !== subject.propertyType) return false;
  if (subject.livingAreaM2 != null && other.livingAreaM2 != null && subject.livingAreaM2 > 0) {
    const ratio = other.livingAreaM2 / subject.livingAreaM2;
    if (ratio < 0.7 || ratio > 1.3) return false;
  }
  return true;
}

export function cohortSummary(subject: CohortRow, rows: CohortRow[]) {
  const values = rows.filter((row) => similar(subject, row)).map(perM2).filter((value): value is number => value != null);
  const medianEurPerM2 = median(values);
  const own = perM2(subject);
  const deltaPct = own != null && medianEurPerM2 != null && medianEurPerM2 > 0 ? ((own - medianEurPerM2) / medianEurPerM2) * 100 : null;
  return { count: values.length, medianEurPerM2, deltaPct };
}

export function rentAgainstBuy(subject: CohortRow & { monthlyCarryingEur: number | null }, rows: CohortRow[]) {
  if (subject.offer !== "buy") return null;
  const rents = rows.filter((row) => row.offer === "rent" && fold(row.city) === fold(subject.city) && row.propertyType === subject.propertyType);
  const cold = rents.map((row) => row.coldRentEur).filter((value): value is number => value != null && value > 0);
  const medianColdRentEur = median(cold);
  return {
    rentCount: cold.length,
    medianColdRentEur,
    monthlyCarryingEur: subject.monthlyCarryingEur,
    carryingMinusMedianCold: subject.monthlyCarryingEur != null && medianColdRentEur != null ? subject.monthlyCarryingEur - medianColdRentEur : null,
  };
}
