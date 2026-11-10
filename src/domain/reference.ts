import { STATES, type Assumptions, type StateId } from "./types.js";

export function fold(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]/g, "");
}

const STATE_BY_FOLD = new Map<string, StateId>(
  STATES.flatMap((state) => [
    [fold(state.name), state.id],
    [state.id.toLowerCase(), state.id],
  ]),
);
STATE_BY_FOLD.set("nrw", "NW");
STATE_BY_FOLD.set("thuringen", "TH");
STATE_BY_FOLD.set("thueringen", "TH");
STATE_BY_FOLD.set("badenwurttemberg", "BW");
STATE_BY_FOLD.set("badenwuerttemberg", "BW");
STATE_BY_FOLD.set("bayern", "BY");
STATE_BY_FOLD.set("hessen", "HE");
STATE_BY_FOLD.set("niedersachsen", "NI");
STATE_BY_FOLD.set("nordrheinwestfalen", "NW");
STATE_BY_FOLD.set("rheinlandpfalz", "RP");
STATE_BY_FOLD.set("sachsen", "SN");
STATE_BY_FOLD.set("sachsenanhalt", "ST");
STATE_BY_FOLD.set("schleswigholstein", "SH");

/** First two postal-code digits. Ambiguous border ranges are omitted on purpose. */
const PLZ2: Record<string, StateId> = {
  "01": "SN", "02": "SN", "03": "BB", "04": "SN", "06": "ST", "07": "TH", "08": "SN", "09": "SN",
  "10": "BE", "11": "BE", "12": "BE", "13": "BE", "15": "BB", "16": "BB", "17": "MV", "18": "MV",
  "20": "HH", "22": "HH", "23": "SH", "24": "SH", "25": "SH", "26": "NI", "27": "NI", "28": "HB",
  "29": "NI", "30": "NI", "31": "NI", "32": "NW", "33": "NW", "34": "HE", "35": "HE", "37": "NI",
  "39": "ST", "40": "NW", "41": "NW", "42": "NW", "43": "NW", "44": "NW", "45": "NW", "46": "NW",
  "47": "NW", "48": "NW", "49": "NI", "50": "NW", "51": "NW", "52": "NW", "53": "NW", "54": "RP",
  "55": "RP", "56": "RP", "57": "NW", "58": "NW", "59": "NW", "60": "HE", "61": "HE", "62": "HE",
  "63": "HE", "64": "HE", "65": "HE", "66": "SL", "67": "RP", "68": "BW", "69": "BW", "70": "BW",
  "71": "BW", "72": "BW", "73": "BW", "74": "BW", "75": "BW", "76": "BW", "77": "BW", "78": "BW",
  "79": "BW", "80": "BY", "81": "BY", "82": "BY", "83": "BY", "84": "BY", "85": "BY", "86": "BY",
  "87": "BY", "90": "BY", "91": "BY", "92": "BY", "93": "BY", "94": "BY", "95": "BY", "96": "BY",
  "97": "BY", "98": "TH", "99": "TH",
};

/** Rough asking-price guide for existing apartments, about 2025. Not a valuation. */
const BENCHMARKS: Record<string, number> = {
  muenchen: 9200, frankfurt: 5800, frankfurtammain: 5800, stuttgart: 5000, hamburg: 6200,
  berlin: 5400, duesseldorf: 5100, koeln: 4500, darmstadt: 4200, augsburg: 4500, leipzig: 3100,
  dresden: 3400, nuernberg: 4300, hannover: 3700, bremen: 3200, essen: 2800, dortmund: 2900,
  mainz: 4800, wiesbaden: 5200, freiburg: 5400, karlsruhe: 4500, mannheim: 3900, heidelberg: 5300,
  muenster: 4600, bonn: 4300, potsdam: 5200, rostock: 3500, kiel: 3800, erfurt: 3000, offenbach: 4100,
};

export function stateById(id: StateId | null) {
  return STATES.find((state) => state.id === id) ?? null;
}

export function parseState(value: unknown): StateId | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = STATES.find((state) => state.id === trimmed.toUpperCase());
  if (direct) return direct.id;
  return STATE_BY_FOLD.get(fold(trimmed)) ?? null;
}

export function stateFromPostalCode(postalCode: string | null): StateId | null {
  const digits = (postalCode ?? "").replace(/\D/g, "");
  if (digits.length < 2) return null;
  return PLZ2[digits.slice(0, 2)] ?? null;
}

export function lookupBenchmark(city: string): { label: string; eurPerM2: number } | null {
  const parts = [city, ...city.split(/[-,/]/)];
  for (const part of parts) {
    const hit = BENCHMARKS[fold(part)];
    if (hit) return { label: part.trim(), eurPerM2: hit };
  }
  return null;
}

export function resolveState(
  listing: { state: StateId | null; postalCode: string | null },
  assumptions: Assumptions,
): { id: StateId | null; source: "listing" | "postal" | "default" | null } {
  if (listing.state) return { id: listing.state, source: "listing" };
  const fromPostal = stateFromPostalCode(listing.postalCode);
  if (fromPostal) return { id: fromPostal, source: "postal" };
  if (assumptions.defaultState) return { id: assumptions.defaultState, source: "default" };
  return { id: null, source: null };
}

export function roundEuro(value: number): number {
  return Math.round(value);
}

export function annuityMonthly(loan: number, annualPercent: number, years: number): number {
  if (loan <= 0) return 0;
  const months = Math.round(years * 12);
  if (months <= 0) return 0;
  const monthlyRate = annualPercent / 100 / 12;
  if (monthlyRate === 0) return loan / months;
  const pow = (1 + monthlyRate) ** months;
  return (loan * (monthlyRate * pow)) / (pow - 1);
}
