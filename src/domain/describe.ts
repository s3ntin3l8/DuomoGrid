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

const NEGATION = /\b(kein|keine|keinen|keiner|keinem|nicht|ohne|frei von|entf(ä|ae)llt)\b/i;
const YEAR = "((?:19|20)\\d{2})";
const VERB = "(?:renoviert|saniert|modernisiert|erneuert|umgebaut)";
const YEAR_BEFORE_VERB = new RegExp(`${YEAR}[^.\\n]{0,40}?\\b${VERB}`, "i");
const YEAR_AFTER_VERB = new RegExp(`\\b${VERB}[^\\n]{0,20}?${YEAR}`, "i");
const HEATING_WORD = /heizung|heizkessel|brenner|therme/i;
const HEATING_VERB = /erneuer|ausgetauscht|installiert|eingebaut|modernisiert/i;

function sentences(text: string): string[] {
  return text
    // A sentence ends before a capital. "ca. 2015" and "ca. im Jahr" do not end one.
    .split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ])|\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0);
}

function snippetOf(sentence: string): string {
  return sentence.length > 220 ? `${sentence.slice(0, 217)}...` : sentence;
}

function yearIn(sentence: string, now: number): number | null {
  const matches = [sentence.match(YEAR_BEFORE_VERB), sentence.match(YEAR_AFTER_VERB)]
    .map((match) => (match ? Number(match[1]) : null))
    .filter((year): year is number => year != null && year <= now);
  return matches.length ? Math.max(...matches) : null;
}

function germanAmount(raw: string): number | null {
  const text = raw.replace(/\s/g, "");
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, "") : text;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Reads the long description for facts that are worth a second look. Negated sentences ("keine Sonderumlage",
 * "nicht vermietet") never produce a finding. Nothing here is a score input.
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
  let renovatedYear: number | null = null;
  let heatingReplacedYear: number | null = null;

  for (const sentence of sentences(text)) {
    const snippet = snippetOf(sentence);
    const negated = NEGATION.test(sentence);

    if (/w(ä|ae)rmepumpe/i.test(sentence) && !negated) add({ key: "heat_pump", label: "Heat pump", snippet });
    if (/fu(ß|ss)bodenheizung/i.test(sentence) && !negated) add({ key: "underfloor_heating", label: "Underfloor heating", snippet });
    if (/kernsanier|komplettsanier|vollsanier|entkernt/i.test(sentence) && !negated) {
      add({ key: "full_refurbishment", label: "Full refurbishment", snippet });
    }
    const kfw = sentence.match(/kfw[\s-]*(?:effizienzhaus\s*)?(40|55|70|85|100)\b/i);
    if (kfw && !negated) add({ key: "kfw_standard", label: `KfW ${kfw[1]} standard`, snippet });

    const heatingSentence = HEATING_WORD.test(sentence) && HEATING_VERB.test(sentence);
    if (heatingSentence && !negated) {
      const year = yearIn(sentence, now) ?? (sentence.match(new RegExp(YEAR))?.[1] ? Number(sentence.match(new RegExp(YEAR))?.[1]) : null);
      if (year != null && year <= now) {
        if (heatingReplacedYear == null || year > heatingReplacedYear) heatingReplacedYear = year;
        add({ key: "heating_replaced", label: `Heating renewed ${year}`, snippet, year });
      }
    } else if (!negated) {
      const year = yearIn(sentence, now);
      if (year != null) {
        if (renovatedYear == null || year > renovatedYear) renovatedYear = year;
      }
    }

    if (/sonderumlage/i.test(sentence) && !negated) add({ key: "special_levy", label: "Special levy mentioned", snippet });
    const reserve = sentence.match(/instandhaltungsr(ü|ue)cklage[^.\n]{0,80}?(\d[\d.]*(?:,\d+)?)\s*(?:€|eur)/i);
    if (reserve && !negated) {
      const amount = germanAmount(reserve[2]);
      if (amount != null) add({ key: "maintenance_reserve", label: `Maintenance reserve about ${new Intl.NumberFormat("de-DE").format(amount)} EUR`, snippet, amountEur: amount });
    }
    if (/erbbaurecht|erbpacht/i.test(sentence) && !negated) add({ key: "leasehold", label: "Leasehold mentioned", snippet });
    if (/\bvermietet\b/i.test(sentence) && !negated) add({ key: "rented", label: "Rented out", snippet });
    if (/denkmalschutz|denkmalgesch(ü|ue)tzt/i.test(sentence) && !negated) add({ key: "monument", label: "Listed building mentioned", snippet });
  }

  if (renovatedYear != null) {
    found.set("renovated", {
      key: "renovated",
      label: `Renovated ${renovatedYear}`,
      snippet: `Renovation year read from the description.`,
      year: renovatedYear,
    });
  }
  return { items: [...found.values()], renovatedYear, heatingReplacedYear };
}
