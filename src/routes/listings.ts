import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { installIngestGuard } from "../auth/guard.js";
import { normalizeAssumptions } from "../domain/assumptions.js";
import { analyze } from "../domain/analyze.js";
import { cohortSummary, rentAgainstBuy, type CohortRow } from "../domain/compare.js";
import { describeFindings, type DescriptionFindings } from "../domain/describe.js";
import { exactPoint, parseIngest, type ExtraKey } from "../domain/ingest.js";
import { districtSaleBandFor } from "../domain/district-band.js";
import { fetchBodenrichtwert, type Bodenrichtwert } from "../domain/bodenrichtwert.js";
import { DEFAULT_ASSUMPTIONS, STATES } from "../domain/types.js";
import type { Assumptions, DetailPair, ImageRef, ListingDescription, ListingInput, Offer, ParkingType, PropertyType, Source } from "../domain/types.js";
import { listings, observations, settings } from "../db/schema.js";

type ListingRow = typeof listings.$inferSelect;

function jsonOr<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function asInput(row: ListingRow, priceEur: number | null): ListingInput {
  let features: string[] = [];
  try {
    const parsed = JSON.parse(row.featuresJson) as unknown;
    if (Array.isArray(parsed)) features = parsed.map((item) => String(item));
  } catch {
    features = [];
  }
  return {
    source: row.source as Source,
    sourceUrl: row.sourceUrl,
    externalId: row.externalId,
    title: row.title,
    offer: row.offer as Offer,
    priceEur,
    livingAreaM2: row.livingAreaM2,
    plotAreaM2: row.plotAreaM2,
    rooms: row.rooms,
    city: row.city,
    district: row.district,
    postalCode: row.postalCode,
    state: (row.state as ListingInput["state"]) ?? null,
    street: row.street,
    latitude: row.latitude,
    longitude: row.longitude,
    locationPrecision: precisionOf(row.locationPrecision),
    propertyType: row.propertyType as PropertyType,
    yearBuilt: row.yearBuilt,
    yearRefurbished: row.yearRefurbished,
    energyClass: row.energyClass,
    energyKwh: row.energyKwh,
    energyCert: (row.energyCert as ListingInput["energyCert"]) ?? null,
    heating: row.heating,
    condoFeeEur: row.condoFeeEur,
    coldRentEur: row.coldRentEur,
    warmRentEur: row.warmRentEur,
    depositEur: row.depositEur,
    rentContract: (row.rentContract as ListingInput["rentContract"]) ?? null,
    commissionPercent: row.commissionPercent,
    commissionText: row.commissionText,
    condition: row.condition,
    floor: row.floor,
    features,
    snippet: row.snippet,
    leasehold: row.leasehold,
    groundRentEur: row.groundRentEur,
    monument: row.monument,
    tenantOccupied: row.tenantOccupied,
    heatingSystem: row.heatingSystem,
    energySource: row.energySource,
    parkingSpaces: row.parkingSpaces,
    parkingType: (row.parkingType as ParkingType | null) ?? null,
    parkingPriceEur: row.parkingPriceEur,
    bathrooms: row.bathrooms,
    bedrooms: row.bedrooms,
    availableFrom: row.availableFrom,
    listedAt: row.listedAt,
    portalPreviousPriceEur: row.portalPreviousPriceEur,
    portalMarketEurPerM2: row.portalMarketEurPerM2,
    portalMarketLowEurPerM2: row.portalMarketLowEurPerM2,
    portalMarketHighEurPerM2: row.portalMarketHighEurPerM2,
    description: jsonOr<ListingDescription | null>(row.descriptionJson, null),
    details: jsonOr<DetailPair[]>(row.detailsJson, []),
    images: jsonOr<ImageRef[]>(row.imagesJson, []),
  };
}

function toCohort(row: ListingRow, priceEur: number | null): CohortRow {
  return {
    offer: row.offer as Offer,
    city: row.city,
    propertyType: row.propertyType,
    livingAreaM2: row.livingAreaM2,
    priceEur,
    coldRentEur: row.coldRentEur,
  };
}

type BrwColumns = {
  brwStatus: string | null;
  brwZone: string | null;
  brwEurPerM2: number | null;
  brwStichtag: string | null;
};

function precisionOf(value: string | null): "exact" | "approximate" | null {
  return value === "exact" || value === "approximate" ? value : null;
}

function samePoint(leftLat: number | null, leftLng: number | null, rightLat: number | null, rightLng: number | null) {
  if (leftLat == null || leftLng == null || rightLat == null || rightLng == null) return false;
  return Math.abs(leftLat - rightLat) < 1e-8 && Math.abs(leftLng - rightLng) < 1e-8;
}

function clearedBrw(): BrwColumns {
  return { brwStatus: null, brwZone: null, brwEurPerM2: null, brwStichtag: null };
}

function keptBrw(row: ListingRow): BrwColumns {
  return {
    brwStatus: row.brwStatus,
    brwZone: row.brwZone,
    brwEurPerM2: row.brwEurPerM2,
    brwStichtag: row.brwStichtag,
  };
}

function columnsFromHit(hit: Bodenrichtwert): BrwColumns {
  if (hit.status === "published") {
    return { brwStatus: "published", brwZone: hit.zone, brwEurPerM2: hit.eurPerM2, brwStichtag: hit.stichtag };
  }
  if (hit.status === "unpublished") {
    return { brwStatus: "unpublished", brwZone: hit.zone, brwEurPerM2: null, brwStichtag: hit.stichtag };
  }
  return { brwStatus: "none", brwZone: null, brwEurPerM2: null, brwStichtag: null };
}

function bodenrichtwertView(row: ListingRow) {
  if (row.latitude == null || row.longitude == null) return null;
  if (row.brwStatus === "published" && row.brwZone && row.brwEurPerM2 != null && row.brwEurPerM2 > 0) {
    return { status: "published" as const, zone: row.brwZone, eurPerM2: row.brwEurPerM2, stichtag: row.brwStichtag };
  }
  if (row.brwStatus === "unpublished" && row.brwZone) {
    return { status: "unpublished" as const, zone: row.brwZone, eurPerM2: null, stichtag: row.brwStichtag };
  }
  if (row.brwStatus === "none") return { status: "none" as const, zone: null, eurPerM2: null, stichtag: null };
  return { status: "unknown" as const, zone: null, eurPerM2: null, stichtag: null };
}

function asBodenrichtwert(view: ReturnType<typeof bodenrichtwertView>): Bodenrichtwert | null {
  if (!view || view.status === "unknown") return null;
  if (view.status === "none") return { status: "none" };
  if (view.status === "unpublished") return { status: "unpublished", zone: view.zone, stichtag: view.stichtag };
  return { status: "published", zone: view.zone, eurPerM2: view.eurPerM2, stichtag: view.stichtag };
}

const PROPERTY_TYPES = new Set(["apartment", "house", "land", "multi", "other"]);
const ENERGY_CLASSES = new Set(["A+", "A", "B", "C", "D", "E", "F", "G", "H"]);

type FactPatch = {
  livingAreaM2?: number | null;
  plotAreaM2?: number | null;
  rooms?: number | null;
  city?: string;
  district?: string | null;
  state?: ListingInput["state"];
  propertyType?: PropertyType;
  yearBuilt?: number | null;
  energyClass?: string | null;
  priceEur?: number | null;
};

function owns(body: object, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function optionalPositive(value: unknown, label: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null || value === "") return { ok: true, value: null };
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return { ok: true, value };
  return { ok: false, error: `${label} must be a positive number, or empty.` };
}

function readFacts(body: Record<string, unknown>): { ok: true; facts: FactPatch } | { ok: false; error: string } {
  const facts: FactPatch = {};
  if (owns(body, "livingAreaM2")) {
    const parsed = optionalPositive(body.livingAreaM2, "Living area");
    if (!parsed.ok) return parsed;
    facts.livingAreaM2 = parsed.value;
  }
  if (owns(body, "plotAreaM2")) {
    const parsed = optionalPositive(body.plotAreaM2, "Plot area");
    if (!parsed.ok) return parsed;
    facts.plotAreaM2 = parsed.value;
  }
  if (owns(body, "rooms")) {
    const parsed = optionalPositive(body.rooms, "Rooms");
    if (!parsed.ok) return parsed;
    facts.rooms = parsed.value;
  }
  if (owns(body, "priceEur")) {
    const parsed = optionalPositive(body.priceEur, "Price");
    if (!parsed.ok) return parsed;
    facts.priceEur = parsed.value;
  }
  if (owns(body, "city")) {
    const value = body.city;
    if (value === null || value === "") facts.city = "";
    else if (typeof value !== "string") return { ok: false, error: "City must be text." };
    else facts.city = value.trim().slice(0, 120);
  }
  if (owns(body, "district")) {
    const value = body.district;
    if (value === null || value === "") facts.district = null;
    else if (typeof value !== "string") return { ok: false, error: "District must be text." };
    else {
      const trimmed = value.trim().slice(0, 120);
      facts.district = trimmed.length > 0 ? trimmed : null;
    }
  }
  if (owns(body, "state")) {
    const value = body.state;
    if (value === null || value === "") facts.state = null;
    else if (typeof value === "string" && STATES.some((item) => item.id === value)) facts.state = value as ListingInput["state"];
    else return { ok: false, error: "Unknown state." };
  }
  if (owns(body, "propertyType")) {
    const value = body.propertyType;
    if (typeof value === "string" && PROPERTY_TYPES.has(value)) facts.propertyType = value as PropertyType;
    else return { ok: false, error: "Unknown property type." };
  }
  if (owns(body, "yearBuilt")) {
    const value = body.yearBuilt;
    if (value === null || value === "") facts.yearBuilt = null;
    else if (typeof value === "number" && Number.isInteger(value) && value >= 1600 && value <= 2100) facts.yearBuilt = value;
    else return { ok: false, error: "Year built must be an integer from 1600 to 2100, or empty." };
  }
  if (owns(body, "energyClass")) {
    const value = body.energyClass;
    if (value === null || value === "") facts.energyClass = null;
    else if (typeof value === "string" && ENERGY_CLASSES.has(value)) facts.energyClass = value;
    else return { ok: false, error: "Energy class must be A+ to H, or empty." };
  }
  return { ok: true, facts };
}

/**
 * Findings depend only on the description text, which changes on a save and not on a read. Reading the list would
 * otherwise rescan every description on every load, so the result is kept per stored text.
 */
const findingsCache = new Map<string, DescriptionFindings>();
const FINDINGS_CACHE_MAX = 500;

function findingsFor(stored: string | null, description: ListingDescription | null): DescriptionFindings {
  if (!stored) return describeFindings(description);
  const cached = findingsCache.get(stored);
  if (cached) return cached;
  const found = describeFindings(description);
  if (findingsCache.size >= FINDINGS_CACHE_MAX) findingsCache.clear();
  findingsCache.set(stored, found);
  return found;
}

/** The observation copy of a body keeps what priced the listing, not the long text. */
function withoutLongText(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body ?? {};
  const { description: _description, details: _details, images: _images, ...rest } = body as Record<string, unknown>;
  return rest;
}

/**
 * Columns for the fields added after the first extension release. A save that lacks a key keeps the stored value,
 * so an extension that predates the field never blanks it. A save that carries the key, even as null, replaces it.
 */
function extras(listing: ListingInput, provided: ReadonlySet<ExtraKey>, existing: ListingRow | undefined) {
  const pick = <T>(key: ExtraKey, next: T, kept: T): T => (provided.has(key) || !existing ? next : kept);
  return {
    heatingSystem: pick("heatingSystem", listing.heatingSystem, existing?.heatingSystem ?? null),
    energySource: pick("energySource", listing.energySource, existing?.energySource ?? null),
    parkingSpaces: pick("parkingSpaces", listing.parkingSpaces, existing?.parkingSpaces ?? null),
    parkingType: pick("parkingType", listing.parkingType, existing?.parkingType ?? null),
    parkingPriceEur: pick("parkingPriceEur", listing.parkingPriceEur, existing?.parkingPriceEur ?? null),
    bathrooms: pick("bathrooms", listing.bathrooms, existing?.bathrooms ?? null),
    bedrooms: pick("bedrooms", listing.bedrooms, existing?.bedrooms ?? null),
    availableFrom: pick("availableFrom", listing.availableFrom, existing?.availableFrom ?? null),
    listedAt: pick("listedAt", listing.listedAt, existing?.listedAt ?? null),
    portalPreviousPriceEur: pick("portalPreviousPriceEur", listing.portalPreviousPriceEur, existing?.portalPreviousPriceEur ?? null),
    portalMarketEurPerM2: pick("portalMarketEurPerM2", listing.portalMarketEurPerM2, existing?.portalMarketEurPerM2 ?? null),
    portalMarketLowEurPerM2: pick("portalMarketLowEurPerM2", listing.portalMarketLowEurPerM2, existing?.portalMarketLowEurPerM2 ?? null),
    portalMarketHighEurPerM2: pick("portalMarketHighEurPerM2", listing.portalMarketHighEurPerM2, existing?.portalMarketHighEurPerM2 ?? null),
    descriptionJson: pick("description", listing.description ? JSON.stringify(listing.description) : null, existing?.descriptionJson ?? null),
    detailsJson: pick("details", listing.details.length ? JSON.stringify(listing.details) : null, existing?.detailsJson ?? null),
    imagesJson: pick("images", listing.images.length ? JSON.stringify(listing.images) : null, existing?.imagesJson ?? null),
  };
}

export async function listingsRoute(app: FastifyInstance) {
  installIngestGuard(app, "/listings");

  function assumptions(): Assumptions {
    const row = app.db.select().from(settings).where(eq(settings.key, "assumptions")).all()[0];
    if (!row) return DEFAULT_ASSUMPTIONS;
    try {
      return normalizeAssumptions(JSON.parse(row.value));
    } catch {
      return DEFAULT_ASSUMPTIONS;
    }
  }

  function prices(): Map<string, number | null> {
    const map = new Map<string, number | null>();
    const rows = app.db.select().from(observations).orderBy(desc(observations.seenAt)).all();
    for (const row of rows) {
      if (!map.has(row.listingId)) map.set(row.listingId, row.priceEur);
    }
    return map;
  }

  function history(): Map<string, { seenAt: string; priceEur: number | null }[]> {
    const map = new Map<string, { seenAt: string; priceEur: number | null }[]>();
    const rows = app.db.select().from(observations).orderBy(desc(observations.seenAt)).all();
    for (const row of rows) {
      const list = map.get(row.listingId) ?? [];
      if (list.length < 12) list.push({ seenAt: row.seenAt, priceEur: row.priceEur });
      map.set(row.listingId, list);
    }
    return map;
  }

  /**
   * `full` adds the long description, the detail pairs and the findings read from the description.
   * The list leaves them out, but analysis sees the same input either way, so a score never depends on which route asked.
   */
  function present(row: ListingRow, priceMap: Map<string, number | null>, past: Map<string, { seenAt: string; priceEur: number | null }[]>, model: Assumptions, full = false) {
    const priceEur = priceMap.get(row.id) ?? null;
    const input = asInput(row, priceEur);
    const findings = findingsFor(row.descriptionJson, input.description);
    // A renovation year read from the text only fills a gap. A stored year always wins.
    const analysed = { ...input, yearRefurbished: input.yearRefurbished ?? findings.renovatedYear };
    const districtSaleBand = districtSaleBandFor({
      offer: row.offer,
      propertyType: row.propertyType,
      city: row.city,
      district: row.district,
      state: row.state,
    });
    const bodenrichtwert = bodenrichtwertView(row);
    const analysis = analyze(analysed, model, { bodenrichtwert: asBodenrichtwert(bodenrichtwert), districtSaleBand });
    const everyone = app.db
      .select()
      .from(listings)
      .all()
      .map((item) => toCohort(item, priceMap.get(item.id) ?? null));
    const subject = toCohort(row, priceEur);
    return {
      id: row.id,
      status: row.status,
      notes: row.notes,
      updatedAt: row.updatedAt,
      listing: full ? input : { ...input, description: null, details: [], images: [] },
      // The list shows a thumbnail, so the first photo travels with every row. The rest stays on the detail route.
      coverUrl: input.images.find((image) => image.kind === "photo")?.url ?? null,
      descriptionFindings: full ? findings : null,
      analysis,
      observations: past.get(row.id) ?? [],
      cohort: cohortSummary(subject, everyone),
      rentComparison: rentAgainstBuy({ ...subject, monthlyCarryingEur: analysis.monthlyTotal }, everyone),
      bodenrichtwert,
      districtSaleBand,
    };
  }

  function context() {
    return { priceMap: prices(), past: history(), model: assumptions() };
  }

  const lookupInflight = new Map<string, Promise<ListingRow>>();
  const lookupFailedUntil = new Map<string, number>();

  function landValueCached(row: ListingRow) {
    if (row.brwStatus === "none") return true;
    if (row.brwStatus === "unpublished" && row.brwZone) return true;
    return row.brwStatus === "published" && Boolean(row.brwZone) && row.brwEurPerM2 != null && row.brwEurPerM2 > 0;
  }

  async function ensureBodenrichtwert(row: ListingRow): Promise<ListingRow> {
    if (row.latitude == null || row.longitude == null || landValueCached(row)) return row;
    const key = `${row.id}:${row.latitude}:${row.longitude}`;
    const until = lookupFailedUntil.get(key);
    if (until != null && Date.now() < until) return row;
    const pending = lookupInflight.get(key);
    if (pending) return pending;
    const job = (async () => {
      try {
        const hit = await fetchBodenrichtwert(row.latitude as number, row.longitude as number);
        lookupFailedUntil.delete(key);
        app.db.update(listings).set(columnsFromHit(hit)).where(eq(listings.id, row.id)).run();
        return app.db.select().from(listings).where(eq(listings.id, row.id)).all()[0] ?? row;
      } catch {
        lookupFailedUntil.set(key, Date.now() + 30_000);
        return row;
      } finally {
        lookupInflight.delete(key);
      }
    })();
    lookupInflight.set(key, job);
    return job;
  }

  app.get("/listings", async () => {
    const ctx = context();
    return app.db
      .select()
      .from(listings)
      .all()
      .map((row) => present(row, ctx.priceMap, ctx.past, ctx.model));
  });

  app.get<{ Params: { id: string } }>("/listings/:id", async (request, reply) => {
    const row = app.db.select().from(listings).where(eq(listings.id, request.params.id)).all()[0];
    if (!row) return reply.code(404).send({ error: "Listing not found." });
    const stored = await ensureBodenrichtwert(row);
    const ctx = context();
    return present(stored, ctx.priceMap, ctx.past, ctx.model, true);
  });

  app.patch<{
    Params: { id: string };
    Body: {
      notes?: unknown;
      status?: unknown;
      latitude?: unknown;
      longitude?: unknown;
      clearPoint?: unknown;
      livingAreaM2?: unknown;
      plotAreaM2?: unknown;
      rooms?: unknown;
      city?: unknown;
      district?: unknown;
      state?: unknown;
      propertyType?: unknown;
      yearBuilt?: unknown;
      energyClass?: unknown;
      priceEur?: unknown;
    };
  }>("/listings/:id", async (request, reply) => {
    const row = app.db.select().from(listings).where(eq(listings.id, request.params.id)).all()[0];
    if (!row) return reply.code(404).send({ error: "Listing not found." });
    const body = (request.body ?? {}) as Record<string, unknown>;
    const parsed = readFacts(body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const facts = parsed.facts;
    const notes = typeof body.notes === "string" ? body.notes.slice(0, 4000) : row.notes;
    const nextStatus =
      typeof body.status === "string" && ["open", "visit", "offer", "pass"].includes(body.status) ? body.status : row.status;
    const wantsClear = body.clearPoint === true;
    const wantsMove = owns(body, "latitude") || owns(body, "longitude");
    if (wantsClear && wantsMove) return reply.code(400).send({ error: "Send a point or clearPoint, not both." });
    let latitude = row.latitude;
    let longitude = row.longitude;
    let locationPrecision: "exact" | "approximate" | null = precisionOf(row.locationPrecision);
    if (wantsClear) {
      latitude = null;
      longitude = null;
      locationPrecision = null;
    } else if (wantsMove) {
      const placed = exactPoint(body.latitude, body.longitude);
      if (!placed) return reply.code(400).send({ error: "A point needs both coordinates in range." });
      // Sending the stored numbers back does not make an approximate point exact.
      if (!samePoint(row.latitude, row.longitude, placed.latitude, placed.longitude)) locationPrecision = "exact";
      latitude = placed.latitude;
      longitude = placed.longitude;
    }
    const pointMoved = !samePoint(row.latitude, row.longitude, latitude, longitude);
    const brw = pointMoved ? clearedBrw() : keptBrw(row);
    const now = new Date().toISOString();
    const priceTouched = facts.priceEur !== undefined;
    const nextPrice = facts.priceEur ?? null;
    const previousPrice = priceTouched ? (prices().get(row.id) ?? null) : null;
    const priceChanged = priceTouched && previousPrice !== nextPrice;
    const next = {
      notes,
      status: nextStatus,
      latitude,
      longitude,
      locationPrecision,
      ...brw,
      livingAreaM2: facts.livingAreaM2 !== undefined ? facts.livingAreaM2 : row.livingAreaM2,
      plotAreaM2: facts.plotAreaM2 !== undefined ? facts.plotAreaM2 : row.plotAreaM2,
      rooms: facts.rooms !== undefined ? facts.rooms : row.rooms,
      city: facts.city !== undefined ? facts.city : row.city,
      district: facts.district !== undefined ? facts.district : row.district,
      state: facts.state !== undefined ? facts.state : row.state,
      propertyType: facts.propertyType ?? row.propertyType,
      yearBuilt: facts.yearBuilt !== undefined ? facts.yearBuilt : row.yearBuilt,
      energyClass: facts.energyClass !== undefined ? facts.energyClass : row.energyClass,
      coldRentEur: priceChanged && row.offer === "rent" ? nextPrice : row.coldRentEur,
      updatedAt: now,
    };
    app.db.transaction((tx) => {
      tx.update(listings).set(next).where(eq(listings.id, row.id)).run();
      if (!priceChanged) return;
      tx.insert(observations).values({
        listingId: row.id,
        seenAt: now,
        priceEur: nextPrice,
        coldRentEur: row.offer === "rent" ? nextPrice : row.coldRentEur,
        warmRentEur: row.warmRentEur,
        condoFeeEur: row.condoFeeEur,
        rawJson: JSON.stringify(request.body ?? {}),
      }).run();
    });
    const stored = app.db.select().from(listings).where(eq(listings.id, row.id)).all()[0];
    const ctx = context();
    return present(stored, ctx.priceMap, ctx.past, ctx.model, true);
  });

  app.delete<{ Params: { id: string } }>("/listings/:id", async (request, reply) => {
    const row = app.db.select().from(listings).where(eq(listings.id, request.params.id)).all()[0];
    if (!row) return reply.code(404).send({ error: "Listing not found." });
    app.db.transaction((tx) => {
      tx.delete(observations).where(eq(observations.listingId, row.id)).run();
      tx.delete(listings).where(eq(listings.id, row.id)).run();
    });
    return { deleted: true };
  });

  app.post("/listings", async (request, reply) => {
    const parsed = parseIngest(request.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const listing = parsed.listing;
    const provided = parsed.provided;
    const now = new Date().toISOString();
    const rows = app.db.select().from(listings).all();
    const existing = rows.find((row) => {
      if (listing.externalId && row.externalId === listing.externalId && row.source === listing.source) return true;
      return Boolean(listing.sourceUrl && listing.sourceUrl.length > 8 && row.sourceUrl === listing.sourceUrl);
    });
    const id = existing?.id ?? crypto.randomUUID();
    const incoming = listing.latitude != null && listing.longitude != null;
    // An approximate point from the portal never replaces a stored exact one (dragged or corrected by hand).
    const keepsExact = incoming && listing.locationPrecision === "approximate" && existing?.locationPrecision === "exact"
      && existing.latitude != null && existing.longitude != null;
    const located = incoming && !keepsExact;
    const nextLatitude = located ? listing.latitude : (existing?.latitude ?? null);
    const nextLongitude = located ? listing.longitude : (existing?.longitude ?? null);
    const brw = existing && samePoint(existing.latitude, existing.longitude, nextLatitude, nextLongitude) ? keptBrw(existing) : clearedBrw();
    const values = {
      id,
      source: listing.source,
      externalId: listing.externalId,
      sourceUrl: listing.sourceUrl,
      offer: listing.offer,
      title: listing.title,
      city: listing.city,
      district: listing.district,
      postalCode: listing.postalCode,
      state: listing.state,
      street: listing.street ?? existing?.street ?? null,
      latitude: nextLatitude,
      longitude: nextLongitude,
      locationPrecision: located ? (listing.locationPrecision === "approximate" ? "approximate" : "exact") : precisionOf(existing?.locationPrecision ?? null),
      propertyType: listing.propertyType,
      livingAreaM2: listing.livingAreaM2,
      plotAreaM2: listing.plotAreaM2,
      rooms: listing.rooms,
      yearBuilt: listing.yearBuilt,
      yearRefurbished: listing.yearRefurbished,
      energyClass: listing.energyClass,
      energyKwh: listing.energyKwh,
      energyCert: listing.energyCert,
      heating: listing.heating,
      condoFeeEur: listing.condoFeeEur,
      coldRentEur: listing.coldRentEur,
      warmRentEur: listing.warmRentEur,
      depositEur: listing.depositEur,
      rentContract: listing.rentContract,
      commissionPercent: listing.commissionPercent,
      commissionText: listing.commissionText,
      condition: listing.condition,
      floor: listing.floor,
      featuresJson: JSON.stringify(listing.features),
      snippet: listing.snippet,
      leasehold: listing.leasehold,
      groundRentEur: listing.groundRentEur,
      monument: listing.monument,
      tenantOccupied: listing.tenantOccupied,
      ...extras(listing, provided, existing),
      ...brw,
      notes: existing?.notes ?? "",
      status: existing?.status ?? "open",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) {
      app.db.update(listings).set(values).where(eq(listings.id, id)).run();
    } else {
      app.db.insert(listings).values(values).run();
    }
    const previous = prices().get(id) ?? null;
    const nextPrice = listing.priceEur;
    if (previous == null || previous !== nextPrice) {
      app.db.insert(observations).values({
        listingId: id,
        seenAt: now,
        priceEur: listing.priceEur,
        coldRentEur: listing.coldRentEur,
        warmRentEur: listing.warmRentEur,
        condoFeeEur: listing.condoFeeEur,
        rawJson: JSON.stringify(withoutLongText(request.body)),
      }).run();
    }
    const stored = app.db.select().from(listings).where(eq(listings.id, id)).all()[0];
    const ctx = context();
    reply.code(existing ? 200 : 201);
    return { created: !existing, ...present(stored, ctx.priceMap, ctx.past, ctx.model) };
  });
}
