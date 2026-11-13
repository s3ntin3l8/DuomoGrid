import type { ListingDescription } from "./types.js";

/** A fact found in the description text. The snippet is the sentence it came from, as published. */
export type DescriptionFinding = {
  key:
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
  label: string;
  snippet: string;
  year?: number;
  amountEur?: number;
};

export type DescriptionFindings = {
  items: DescriptionFinding[];
  renovatedYear: number | null;
  heatingReplacedYear: number | null;
};

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
 * is possible or planned, never produces a finding. Nothing here is a score input.
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
