import { parseState } from "./reference.js";
import { IMAGE_HOSTS } from "./types.js";
import type { DetailPair, EnergyCert, ImageRef, ListingDescription, ListingInput, Offer, ParkingType, PropertyType, Source } from "./types.js";

/** Keys added after the first extension release. A body that lacks one keeps the stored value on a re-save. */
export const EXTRA_KEYS = [
  "heatingSystem",
  "energySource",
  "parkingSpaces",
  "parkingType",
  "parkingPriceEur",
  "bathrooms",
  "bedrooms",
  "availableFrom",
  "listedAt",
  "portalPreviousPriceEur",
  "portalMarketEurPerM2",
  "portalMarketLowEurPerM2",
  "portalMarketHighEurPerM2",
  "description",
  "details",
  "images",
] as const;
export type ExtraKey = (typeof EXTRA_KEYS)[number];

export type IngestResult =
  | { ok: true; listing: ListingInput; provided: ReadonlySet<ExtraKey> }
  | { ok: false; error: string };

const LONG_TEXT_MAX = 6000;
const DETAIL_PAIRS_MAX = 40;

function positiveNumber(value: unknown): number | null {
  const parsed = looseNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function count(value: unknown, max: number): number | null {
  const parsed = looseNumber(value);
  return parsed != null && Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : null;
}

/** Paragraphs stay as published. Control characters and runs of blank lines do not. */
function longText(value: unknown): string | null {
  if (value == null) return null;
  // Keep tab and newline, drop every other control character.
  const clean = Array.from(String(value).replace(/\r\n?/g, "\n"))
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10;
    })
    .join("");
  const text = clean
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, LONG_TEXT_MAX);
  return text || null;
}

function descriptionOf(value: unknown): ListingDescription | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const result = {
    object: longText(body.object),
    furnishing: longText(body.furnishing),
    location: longText(body.location),
    other: longText(body.other),
  };
  return Object.values(result).some((part) => part != null) ? result : null;
}

function detailsOf(value: unknown): DetailPair[] {
  if (!Array.isArray(value)) return [];
  const pairs: DetailPair[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const label = String((item as Record<string, unknown>).label ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    const text = String((item as Record<string, unknown>).value ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (label && text) pairs.push({ label, value: text });
    if (pairs.length >= DETAIL_PAIRS_MAX) break;
  }
  return pairs;
}

/** Portal placeholders for "not stated". Same pattern as in extension/extract.js. */
const ABSENT = /^(no[_ ]information|keine angabe|n\/a)$/i;

const IMAGES_MAX = 40;

/** https only, and only from the two portal CDNs. Anything else is dropped, not rewritten. */
function imagesOf(value: unknown): ImageRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const images: ImageRef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const body = item as Record<string, unknown>;
    let url: URL;
    try {
      url = new URL(String(body.url ?? ""));
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || !(IMAGE_HOSTS as readonly string[]).includes(url.hostname)) continue;
    if (url.username || url.password) continue;
    const href = url.toString();
    if (seen.has(href)) continue;
    seen.add(href);
    const caption = String(body.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    images.push({ url: href, caption: caption || null, kind: body.kind === "floorplan" ? "floorplan" : "photo" });
    if (images.length >= IMAGES_MAX) break;
  }
  return images;
}

/** Known fuels become one canonical label so analysis can match on it. Anything else stays as published. */
export function energySourceOf(value: unknown): string | null {
  const raw = textOrNull(value);
  if (!raw || ABSENT.test(raw)) return null;
  const text = raw.toLowerCase();
  if (text.includes("pellet")) return "Pellets";
  if (/holz|wood|hackschnitzel/.test(text)) return "Holz";
  if (/w(ä|ae|a)rmepumpe|heat.?pump/.test(text)) return "Wärmepumpe";
  if (/erdw(ä|ae|a)rme|geotherm/.test(text)) return "Erdwärme";
  if (/fernw|fern-|district/.test(text)) return "Fernwärme";
  if (/(^|[^a-zäöü])(öl|oel|oil)([^a-zäöü]|$)|heiz(ö|oe)l/.test(text)) return "Öl";
  if (text.includes("gas")) return "Gas";
  if (/strom|electric|nachtspeicher|night/.test(text)) return "Strom";
  if (text.includes("solar")) return "Solar";
  return raw.slice(0, 60);
}

function heatingSystemOf(value: unknown): string | null {
  const text = textOrNull(value);
  return text && !ABSENT.test(text) ? text.slice(0, 80) : null;
}

function parkingTypeOf(value: unknown): ParkingType | null {
  const text = String(value ?? "").toLowerCase();
  if (!text) return null;
  if (text === "garage" || text === "underground" || text === "carport" || text === "outdoor" || text === "other") return text;
  if (/tiefgarage|underground|tg-/.test(text)) return "underground";
  if (text.includes("carport")) return "carport";
  if (text.includes("garage")) return "garage";
  if (/au(ß|ss)en|outdoor|freiplatz|stellplatz|parkplatz/.test(text)) return "outdoor";
  return null;
}

function listedAtOf(value: unknown): string | null {
  const text = textOrNull(value);
  // ISO only. "05.03.2024" and "03/05/2024" mean different days to different readers, and Date guesses.
  if (!text || !/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  return year >= 2000 && year <= new Date().getUTCFullYear() + 1 ? date.toISOString() : null;
}

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

function streetOf(value: unknown): string | null {
  const text = textOrNull(value);
  return text ? text.slice(0, 160) : null;
}

/** WGS84, not a German amount. "48.137" is a latitude; looseNumber would read it as 48137. */
function coordinate(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null || value === "") return null;
  let text = String(value).trim().replace(/\s/g, "").replace(/°/g, "");
  if (!text) return null;
  if (text.includes(",") && !text.includes(".")) text = text.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A point is stored only when both coordinates are in range. 0,0 is a portal sentinel, not a place. */
function pointOf(latValue: unknown, lngValue: unknown, precisionValue?: unknown): {
  latitude: number | null;
  longitude: number | null;
  locationPrecision: "exact" | "approximate" | null;
} {
  const latitude = coordinate(latValue);
  const longitude = coordinate(lngValue);
  const missing = { latitude: null, longitude: null, locationPrecision: null };
  if (latitude == null || longitude == null) return missing;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return missing;
  if (Math.abs(latitude) < 1e-8 && Math.abs(longitude) < 1e-8) return missing;
  // Only "approximate" is believed. Anything else, or nothing, is exact, so older extensions keep working.
  return { latitude, longitude, locationPrecision: precisionValue === "approximate" ? "approximate" : "exact" };
}

/** Both coordinates in range, or null. 0,0 is not a place. Client precision is ignored. */
export function exactPoint(latValue: unknown, lngValue: unknown): { latitude: number; longitude: number } | null {
  const point = pointOf(latValue, lngValue);
  if (point.latitude == null || point.longitude == null) return null;
  return { latitude: point.latitude, longitude: point.longitude };
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
  const provided = new Set<ExtraKey>(EXTRA_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(body, key)));
  const point = pointOf(body.latitude ?? body.lat ?? body.geoLat, body.longitude ?? body.lng ?? body.lon ?? body.geoLng ?? body.geoLong, body.locationPrecision);
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
      street: streetOf(body.street ?? body.streetAddress),
      latitude: point.latitude,
      longitude: point.longitude,
      locationPrecision: point.locationPrecision,
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
      heatingSystem: heatingSystemOf(body.heatingSystem),
      energySource: energySourceOf(body.energySource),
      parkingSpaces: count(body.parkingSpaces, 99),
      parkingType: parkingTypeOf(body.parkingType),
      parkingPriceEur: positiveNumber(body.parkingPriceEur),
      bathrooms: count(body.bathrooms, 30),
      bedrooms: count(body.bedrooms, 30),
      availableFrom: textOrNull(body.availableFrom)?.slice(0, 80) ?? null,
      listedAt: listedAtOf(body.listedAt),
      portalPreviousPriceEur: positiveNumber(body.portalPreviousPriceEur),
      portalMarketEurPerM2: positiveNumber(body.portalMarketEurPerM2),
      portalMarketLowEurPerM2: positiveNumber(body.portalMarketLowEurPerM2),
      portalMarketHighEurPerM2: positiveNumber(body.portalMarketHighEurPerM2),
      description: descriptionOf(body.description),
      details: detailsOf(body.details),
      images: imagesOf(body.images),
    },
    provided,
  };
}
