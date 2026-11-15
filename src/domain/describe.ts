import crypto from "node:crypto";
import { completeJson, type AiSettings } from "./ai.js";
import { energySourceOf } from "./ingest.js";
import type { DetailPair, ListingDescription, ListingInput } from "./types.js";

/** A fact found in the description text. The snippet is the sentence it came from, as published. */
export type DescriptionFindingKey =
  | "heat_pump"
  | "underfloor_heating"
  | "full_refurbishment"
  | "kfw_standard"
  | "renovated"
  | "heating_replaced"
  | "special_levy"
  | "maintenance_reserve"
  | "leasehold"
  | "rented"
  | "monument";

export type DescriptionFinding = {
  key: DescriptionFindingKey;
  label: string;
  snippet: string;
  year?: number;
  amountEur?: number;
};

export type ExtractedFacts = {
  energySource?: string | null;
  heatingSystem?: string | null;
  yearRefurbished?: number | null;
  heatingReplacedYear?: number | null;
  leasehold?: boolean | null;
  groundRentEur?: number | null;
  monument?: boolean | null;
  tenantOccupied?: boolean | null;
  condoFeeEur?: number | null;
  coldRentEur?: number | null;
  parkingSpaces?: number | null;
  parkingPriceEur?: number | null;
};

export type DescriptionFindings = {
  items: DescriptionFinding[];
  renovatedYear: number | null;
  heatingReplacedYear: number | null;
  extractedFacts?: ExtractedFacts;
  filledFields?: string[];
  source?: "regex" | "llm";
  model?: string | null;
};

export type StoredLlmExtraction = {
  descriptionHash: string;
  model: string;
  extractedAt: string;
  items: DescriptionFinding[];
  renovatedYear: number | null;
  heatingReplacedYear: number | null;
  extractedFacts: ExtractedFacts;
};

const ALLOWED_FINDING_KEYS = new Set<DescriptionFindingKey>([
  "heat_pump",
  "underfloor_heating",
  "full_refurbishment",
  "kfw_standard",
  "renovated",
  "heating_replaced",
  "special_levy",
  "maintenance_reserve",
  "leasehold",
  "rented",
  "monument",
]);

/** "kein", "nicht", "ohne": a sentence that says no never produces a finding. */
const NEGATION = /\b(kein|keine|keinen|keiner|keinem|nicht|ohne|frei von|entf(ä|ae)llt)\b/i;
/** A possibility or a plan is not a fact about the building. Only the positive findings skip these. */
const HYPOTHETICAL = /\b(geeignet|vorbereitet|vorbereitung|nachr(ü|ue)stbar|nachr(ü|ue)stung|m(ö|oe)glich|m(ö|oe)glichkeit|optional|auf wunsch|denkbar|k(ö|oe)nnte|k(ö|oe)nnen|kann|geplant|plant)\b/i;
/** A calendar year that is not part of a longer number such as 2.500 or 20.000. */
const YEAR = /(?<![\d.,])((?:19|20)\d{2})(?![\d]|[.,]\d{3})/g;
const RENOVATION_VERB = /\b(renoviert|saniert|modernisiert|erneuert|umgebaut)\b/i;
const HEATING_WORD = /heizung|heizkessel|heizanlage|gastherme|brennwert/i;
const HEATING_VERB = /erneuer|ausgetauscht|installiert|eingebaut/i;
const PER_UNIT = /monatlich|mtl\.|pro monat|\/\s*monat|pro m²|\/\s*m²|je m²|pro qm|\/\s*qm/i;
const RESERVE_MIN_EUR = 500;

function sentences(text: string): string[] {
  return text
    // A sentence ends before a capital. "ca. 2015" and "ca. im Jahr" do not end one.
    .split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ])|\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0);
}

/** Clauses split on commas, semicolons and "und", so a year only pairs with the verb in its own clause. */
function clauses(sentence: string): string[] {
  return sentence.split(/[;,]|\bund\b|\bsowie\b/i).map((part) => part.trim()).filter((part) => part.length > 0);
}

function snippetOf(sentence: string): string {
  return sentence.length > 220 ? `${sentence.slice(0, 217)}...` : sentence;
}

/** The year closest to a verb in one clause, not later than `now`. A year of build or of tenancy sits in another clause. */
function yearNear(clause: string, verb: RegExp, now: number): number | null {
  const at = clause.search(verb);
  if (at < 0) return null;
  let best: { year: number; distance: number } | null = null;
  for (const match of clause.matchAll(YEAR)) {
    const year = Number(match[1]);
    if (year > now) continue;
    const distance = Math.abs((match.index ?? 0) - at);
    if (best == null || distance < best.distance) best = { year, distance };
  }
  return best?.year ?? null;
}

function germanAmount(raw: string): number | null {
  const text = raw.replace(/\s/g, "");
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, "") : text;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Reads the long description for facts that are worth a second look. A sentence that says no, or only that something
 * is possible or planned, never produces a finding. Findings are shown. Two values reach the analysis: the renovation
 * year, which only fills a missing yearRefurbished, and the heating renewal year, which feeds the energy subscore.
 */
export function describeFindings(description: ListingDescription | null, now = new Date().getUTCFullYear()): DescriptionFindings {
  const empty: DescriptionFindings = { items: [], renovatedYear: null, heatingReplacedYear: null };
  if (!description) return empty;
  const text = [description.object, description.furnishing, description.location, description.other].filter(Boolean).join("\n");
  if (!text) return empty;
  const found = new Map<DescriptionFinding["key"], DescriptionFinding>();
  const add = (finding: DescriptionFinding) => {
    if (!found.has(finding.key)) found.set(finding.key, finding);
  };
  let renovated: { year: number; snippet: string } | null = null;
  let heating: { year: number; snippet: string } | null = null;

  for (const sentence of sentences(text)) {
    const snippet = snippetOf(sentence);
    const negated = NEGATION.test(sentence);
    const positive = !negated && !HYPOTHETICAL.test(sentence);

    if (positive && /w(ä|ae)rmepumpe/i.test(sentence)) add({ key: "heat_pump", label: "Heat pump", snippet });
    if (positive && /fu(ß|ss)bodenheizung/i.test(sentence)) add({ key: "underfloor_heating", label: "Underfloor heating", snippet });
    if (positive && /kernsanier|komplettsanier|vollsanier|entkernt/i.test(sentence)) {
      add({ key: "full_refurbishment", label: "Full refurbishment", snippet });
    }
    const kfw = sentence.match(/kfw[\s-]*(?:effizienzhaus\s*)?(40|55|70|85|100)(?![.,]?\d)/i);
    if (positive && kfw) add({ key: "kfw_standard", label: `KfW ${kfw[1]} standard`, snippet });

    if (positive) {
      const isHeating = HEATING_WORD.test(sentence) && HEATING_VERB.test(sentence);
      for (const clause of clauses(sentence)) {
        if (isHeating && HEATING_WORD.test(clause) && HEATING_VERB.test(clause)) {
          const year = yearNear(clause, HEATING_VERB, now);
          if (year != null && (heating == null || year > heating.year)) heating = { year, snippet };
        } else if (!HEATING_WORD.test(clause)) {
          const year = yearNear(clause, RENOVATION_VERB, now);
          if (year != null && (renovated == null || year > renovated.year)) renovated = { year, snippet };
        }
      }
    }

    if (!negated && /sonderumlage/i.test(sentence)) add({ key: "special_levy", label: "Special levy mentioned", snippet });
    const reserve = sentence.match(/instandhaltungsr(ü|ue)cklage[^\n]{0,80}?(\d[\d.]*(?:,\d+)?)\s*(?:€|eur)/i);
    if (!negated && reserve && !PER_UNIT.test(sentence)) {
      const amount = germanAmount(reserve[2]);
      if (amount != null && amount >= RESERVE_MIN_EUR) {
        add({ key: "maintenance_reserve", label: `Maintenance reserve about ${new Intl.NumberFormat("de-DE").format(amount)} EUR`, snippet, amountEur: amount });
      }
    }
    if (!negated && /erbbaurecht|erbpacht/i.test(sentence)) add({ key: "leasehold", label: "Leasehold mentioned", snippet });
    if (!negated && /\bvermietet\b/i.test(sentence)) add({ key: "rented", label: "Rented out", snippet });
    if (!negated && /denkmalschutz|denkmalgesch(ü|ue)tzt/i.test(sentence)) add({ key: "monument", label: "Listed building mentioned", snippet });
  }

  if (heating) found.set("heating_replaced", { key: "heating_replaced", label: `Heating renewed ${heating.year}`, snippet: heating.snippet, year: heating.year });
  if (renovated) found.set("renovated", { key: "renovated", label: `Renovated ${renovated.year}`, snippet: renovated.snippet, year: renovated.year });
  return {
    items: [...found.values()],
    renovatedYear: (renovated as { year: number } | null)?.year ?? null,
    heatingReplacedYear: (heating as { year: number } | null)?.year ?? null,
  };
}

export function descriptionDigest(descriptionJson: string | null): string | null {
  if (!descriptionJson) return null;
  return crypto.createHash("sha256").update(descriptionJson).digest("hex");
}

function validYear(value: unknown, now: number): number | null {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isInteger(num) && num >= 1600 && num <= now ? num : null;
}

function validPositive(value: unknown, max = 100_000): number | null {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) && num > 0 && num <= max ? num : null;
}

function validCount(value: unknown, max: number): number | null {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isInteger(num) && num > 0 && num <= max ? num : null;
}

function validBoolOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

export function sanitizeExtractedFacts(raw: unknown, now = new Date().getUTCFullYear()): ExtractedFacts {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const energySource = obj.energySource != null ? energySourceOf(obj.energySource) : null;
  const heatingSystem =
    typeof obj.heatingSystem === "string" && obj.heatingSystem.trim()
      ? obj.heatingSystem.trim().slice(0, 80)
      : null;
  return {
    energySource,
    heatingSystem,
    yearRefurbished: validYear(obj.yearRefurbished, now),
    heatingReplacedYear: validYear(obj.heatingReplacedYear, now),
    leasehold: validBoolOrNull(obj.leasehold),
    groundRentEur: validPositive(obj.groundRentEur, 50_000),
    monument: validBoolOrNull(obj.monument),
    tenantOccupied: validBoolOrNull(obj.tenantOccupied),
    condoFeeEur: validPositive(obj.condoFeeEur, 25_000),
    coldRentEur: validPositive(obj.coldRentEur, 100_000),
    parkingSpaces: validCount(obj.parkingSpaces, 99),
    parkingPriceEur: validPositive(obj.parkingPriceEur, 500_000),
  };
}

export async function extractDescriptionWithLlm(
  settings: AiSettings,
  description: ListingDescription | null,
  details: DetailPair[] = [],
  descriptionJson: string | null = null,
  now = new Date().getUTCFullYear(),
): Promise<StoredLlmExtraction> {
  const hash =
    descriptionDigest(descriptionJson ?? (description ? JSON.stringify(description) : null)) ?? "empty";
  const regexResult = describeFindings(description, now);
  if (!description) {
    return {
      descriptionHash: hash,
      model: settings.model,
      extractedAt: new Date().toISOString(),
      items: [],
      renovatedYear: null,
      heatingReplacedYear: null,
      extractedFacts: {},
    };
  }

  const sections = [
    description.object ? `[Objektbeschreibung]\n${description.object}` : null,
    description.furnishing ? `[Ausstattung]\n${description.furnishing}` : null,
    description.location ? `[Lage]\n${description.location}` : null,
    description.other ? `[Sonstiges]\n${description.other}` : null,
    details.length
      ? `[Eckdaten]\n${details.map((pair) => `${pair.label}: ${pair.value}`).join("\n")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = `You extract structured real-estate facts from German property listing descriptions for DuomoGrid.
Rules:
1. Ignore negated statements (e.g., "kein Erbbaurecht", "nicht vermietet", "ohne Denkmalschutz", "keine Sonderumlage") and hypothetical/future plans (e.g., "Wärmepumpe möglich", "Ausbau denkbar", "Sanierung geplant").
2. Never guess or invent numbers. Use null for any field not explicitly stated as an actual fact.
3. Return ONLY a JSON object with this exact shape:
{
  "items": [
    {
      "key": "heat_pump" | "underfloor_heating" | "full_refurbishment" | "kfw_standard" | "renovated" | "heating_replaced" | "special_levy" | "maintenance_reserve" | "leasehold" | "rented" | "monument",
      "label": "Short English label (e.g., 'Heat pump', 'Heating renewed 2019', 'Renovated 2016', 'Maintenance reserve about 45.000 EUR', 'Special levy mentioned')",
      "snippet": "Verbatim German sentence from the text proving this finding (max 220 chars)",
      "year": 2019,
      "amountEur": 45000
    }
  ],
  "facts": {
    "energySource": "Wärmepumpe" | "Erdwärme" | "Fernwärme" | "Pellets" | "Holz" | "Gas" | "Öl" | "Strom" | "Solar" | null,
    "heatingSystem": "Zentralheizung" | "Fußbodenheizung" | "Etagenheizung" | "Fernwärme" | "Ofenheizung" | null,
    "yearRefurbished": number | null,
    "heatingReplacedYear": number | null,
    "leasehold": boolean | null,
    "groundRentEur": number | null,
    "monument": boolean | null,
    "tenantOccupied": boolean | null,
    "condoFeeEur": number | null,
    "coldRentEur": number | null,
    "parkingSpaces": number | null,
    "parkingPriceEur": number | null
  }
}`;

  const raw = await completeJson<{
    items?: unknown[];
    facts?: unknown;
  }>(settings, systemPrompt, sections);

  const facts = sanitizeExtractedFacts(raw?.facts, now);
  const itemsByKey = new Map<DescriptionFindingKey, DescriptionFinding>();

  if (Array.isArray(raw?.items)) {
    for (const entry of raw.items) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      const key = item.key as DescriptionFindingKey;
      if (!ALLOWED_FINDING_KEYS.has(key) || itemsByKey.has(key)) continue;
      const label = typeof item.label === "string" ? item.label.trim().slice(0, 120) : "";
      const snippet = typeof item.snippet === "string" ? snippetOf(item.snippet.trim()) : "";
      if (!label || !snippet) continue;
      const year = validYear(item.year, now) ?? undefined;
      const amountEur = validPositive(item.amountEur, 50_000_000) ?? undefined;
      itemsByKey.set(key, {
        key,
        label,
        snippet,
        ...(year != null ? { year } : {}),
        ...(amountEur != null ? { amountEur } : {}),
      });
    }
  }

  // Keep deterministic findings that the LLM did not emit, unless the LLM explicitly marked a boolean false.
  for (const fallbackItem of regexResult.items) {
    if (itemsByKey.has(fallbackItem.key)) continue;
    if (fallbackItem.key === "leasehold" && facts.leasehold === false) continue;
    if (fallbackItem.key === "monument" && facts.monument === false) continue;
    if (fallbackItem.key === "rented" && facts.tenantOccupied === false) continue;
    itemsByKey.set(fallbackItem.key, fallbackItem);
  }

  const renovatedYear =
    facts.yearRefurbished ??
    itemsByKey.get("renovated")?.year ??
    regexResult.renovatedYear ??
    null;
  const heatingReplacedYear =
    facts.heatingReplacedYear ??
    itemsByKey.get("heating_replaced")?.year ??
    regexResult.heatingReplacedYear ??
    null;

  return {
    descriptionHash: hash,
    model: settings.model,
    extractedAt: new Date().toISOString(),
    items: [...itemsByKey.values()],
    renovatedYear,
    heatingReplacedYear,
    extractedFacts: {
      ...facts,
      yearRefurbished: renovatedYear,
      heatingReplacedYear,
    },
  };
}

/**
 * Fills missing fields on `input` from description findings without ever overwriting a stored value
 * from the portal or a user PATCH correction.
 */
export function mergeExtractedFacts(
  input: ListingInput,
  findings: DescriptionFindings,
): { analysed: ListingInput; filledFields: string[] } {
  const analysed: ListingInput = { ...input };
  const filledFields: string[] = [];

  const targetRefurbished =
    findings.renovatedYear ?? findings.extractedFacts?.yearRefurbished ?? null;
  if (analysed.yearRefurbished == null && targetRefurbished != null) {
    analysed.yearRefurbished = targetRefurbished;
    filledFields.push("yearRefurbished");
  }

  const facts = findings.extractedFacts;
  if (!facts) {
    return { analysed, filledFields };
  }

  if (analysed.energySource == null && facts.energySource != null) {
    analysed.energySource = facts.energySource;
    filledFields.push("energySource");
  }
  if (analysed.heatingSystem == null && facts.heatingSystem != null) {
    analysed.heatingSystem = facts.heatingSystem;
    filledFields.push("heatingSystem");
  }
  if (analysed.condoFeeEur == null && facts.condoFeeEur != null && facts.condoFeeEur > 0) {
    analysed.condoFeeEur = facts.condoFeeEur;
    filledFields.push("condoFeeEur");
  }
  if (analysed.coldRentEur == null && facts.coldRentEur != null && facts.coldRentEur > 0) {
    analysed.coldRentEur = facts.coldRentEur;
    filledFields.push("coldRentEur");
  }
  if (analysed.groundRentEur == null && facts.groundRentEur != null && facts.groundRentEur > 0) {
    analysed.groundRentEur = facts.groundRentEur;
    filledFields.push("groundRentEur");
  }
  if (analysed.parkingSpaces == null && facts.parkingSpaces != null && facts.parkingSpaces > 0) {
    analysed.parkingSpaces = facts.parkingSpaces;
    filledFields.push("parkingSpaces");
  }
  if (analysed.parkingPriceEur == null && facts.parkingPriceEur != null && facts.parkingPriceEur > 0) {
    analysed.parkingPriceEur = facts.parkingPriceEur;
    filledFields.push("parkingPriceEur");
  }
  if (!analysed.leasehold && facts.leasehold === true) {
    analysed.leasehold = true;
    filledFields.push("leasehold");
  }
  if (!analysed.monument && facts.monument === true) {
    analysed.monument = true;
    filledFields.push("monument");
  }
  if (!analysed.tenantOccupied && facts.tenantOccupied === true) {
    analysed.tenantOccupied = true;
    filledFields.push("tenantOccupied");
  }

  return { analysed, filledFields };
}
