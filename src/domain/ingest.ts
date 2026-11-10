import { parseState } from "./reference.js";
import type { EnergyCert, ListingInput, Offer, PropertyType, Source } from "./types.js";

export type IngestResult = { ok: true; listing: ListingInput } | { ok: false; error: string };

function looseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null || value === "") return null;
  let text = String(value).trim();
  if (!text || /anfrage/i.test(text)) return null;
  text = text.replace(/\s/g, "").replace(/€/g, "").replace(/m²|qm|kwh.*$/i, "");
  text = text.replace(/[^0-9,.-]/g, "");
  if (!text || text === "-" || text === "." || text === ",") return null;
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, "");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function looseBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "true" || text === "yes" || text === "ja" || text === "1";
}

function textOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function year(value: unknown): number | null {
  const parsed = looseNumber(value);
  return parsed != null && parsed >= 1600 && parsed <= 2100 ? Math.round(parsed) : null;
}

function energyClass(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = String(value).toUpperCase().replaceAll(" ", "").replace("A_PLUS", "A+");
  return text.match(/A\+|A|B|C|D|E|F|G|H/)?.[0] ?? null;
}

function energyCert(value: unknown): EnergyCert | null {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("bedarf") || text.includes("demand") || text.includes("required")) return "demand";
  if (text.includes("verbrauch") || text.includes("consum")) return "consumption";
  return null;
}

function offerOf(value: unknown): Offer {
  const text = String(value ?? "").toLowerCase();
  if (text === "buy" || text === "sale" || text.includes("kauf") || text.includes("purchase")) return "buy";
  if (text === "rent" || text.includes("miete")) return "rent";
  return "buy";
}

function propertyTypeOf(value: unknown): PropertyType {
  const text = String(value ?? "").toLowerCase();
  if (text === "apartment" || text === "house" || text === "land" || text === "multi" || text === "other") return text;
  if (text.includes("wohn") || text.includes("apartment") || text.includes("etage")) return "apartment";
  if (text.includes("zinshaus") || text.includes("multi") || text.includes("mfh")) return "multi";
  if (text.includes("grund") || text.includes("plot") || text.includes("land")) return "land";
  if (text.includes("haus") || text.includes("house")) return "house";
  return "other";
}

function sourceOf(value: unknown): Source {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("immowelt")) return "immowelt";
  if (text.includes("scout") || text.includes("is24")) return "immobilienscout24";
  return "manual";
}

function rentContract(value: unknown): ListingInput["rentContract"] {
  const text = String(value ?? "").toLowerCase();
  if (!text) return null;
  if (text.includes("staffel") || text.includes("step")) return "stepped";
  if (text.includes("index")) return "indexed";
  if (text.includes("befrist") || text.includes("fixed")) return "fixed";
  if (text.includes("unbefrist") || text.includes("open")) return "open";
  return null;
}

export function parseIngest(input: unknown): IngestResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Expected a listing object." };
  }
  const body = input as Record<string, unknown>;
  const offer = offerOf(body.offer ?? body.listingKind);
  const price = looseNumber(body.priceEur);
  const coldRent = looseNumber(body.coldRentEur);
  const title = String(body.title ?? "").replace(/\s+/g, " ").trim() || "Listing";
  return {
    ok: true,
    listing: {
      source: sourceOf(body.source),
      sourceUrl: String(body.sourceUrl ?? "").trim(),
      externalId: textOrNull(body.externalId),
      title,
      offer,
      priceEur: offer === "rent" ? (coldRent ?? price) : price,
      livingAreaM2: looseNumber(body.livingAreaM2),
      plotAreaM2: looseNumber(body.plotAreaM2),
      rooms: looseNumber(body.rooms),
      city: String(body.city ?? "").trim(),
      district: textOrNull(body.district),
      postalCode: textOrNull(body.postalCode)?.replace(/\s/g, "") ?? null,
      state: parseState(body.state),
      propertyType: propertyTypeOf(body.propertyType),
      yearBuilt: year(body.yearBuilt),
      yearRefurbished: year(body.yearRefurbished),
      energyClass: energyClass(body.energyClass),
      energyKwh: looseNumber(body.energyKwh),
      energyCert: energyCert(body.energyCert),
      heating: textOrNull(body.heating),
      condoFeeEur: looseNumber(body.condoFeeEur ?? body.hausgeldEur),
      coldRentEur: offer === "rent" ? (coldRent ?? price) : coldRent,
      warmRentEur: looseNumber(body.warmRentEur),
      depositEur: looseNumber(body.depositEur),
      rentContract: rentContract(body.rentContract),
      commissionPercent: looseNumber(body.commissionPercent ?? body.provisionPercent),
      commissionText: textOrNull(body.commissionText ?? body.provisionText),
      condition: textOrNull(body.condition),
      floor: textOrNull(body.floor),
      features: Array.isArray(body.features) ? body.features.map((item) => String(item).trim()).filter(Boolean).slice(0, 24) : [],
      snippet: String(body.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 600),
      leasehold: looseBool(body.leasehold),
      groundRentEur: looseNumber(body.groundRentEur),
      monument: looseBool(body.monument),
      tenantOccupied: looseBool(body.tenantOccupied ?? body.rentedOut),
    },
  };
}
