import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { installIngestGuard } from "../auth/guard.js";
import { normalizeAssumptions } from "../domain/assumptions.js";
import { analyze } from "../domain/analyze.js";
import { cohortSummary, rentAgainstBuy, type CohortRow } from "../domain/compare.js";
import { exactPoint, parseIngest } from "../domain/ingest.js";
import { districtSaleBandFor } from "../domain/district-band.js";
import { fetchBodenrichtwert, type Bodenrichtwert } from "../domain/bodenrichtwert.js";
import { DEFAULT_ASSUMPTIONS } from "../domain/types.js";
import type { Assumptions, ListingInput, Offer, PropertyType, Source } from "../domain/types.js";
import { listings, observations, settings } from "../db/schema.js";

type ListingRow = typeof listings.$inferSelect;

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
    locationPrecision: row.locationPrecision === "exact" ? "exact" : null,
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

  function present(row: ListingRow, priceMap: Map<string, number | null>, past: Map<string, { seenAt: string; priceEur: number | null }[]>, model: Assumptions) {
    const priceEur = priceMap.get(row.id) ?? null;
    const input = asInput(row, priceEur);
    const districtSaleBand = districtSaleBandFor({
      offer: row.offer,
      propertyType: row.propertyType,
      city: row.city,
      district: row.district,
      state: row.state,
    });
    const bodenrichtwert = bodenrichtwertView(row);
    const analysis = analyze(input, model, { bodenrichtwert, districtSaleBand });
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
      listing: input,
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
    return present(stored, ctx.priceMap, ctx.past, ctx.model);
  });

  app.patch<{ Params: { id: string }; Body: { notes?: unknown; status?: unknown; latitude?: unknown; longitude?: unknown; clearPoint?: unknown } }>(
    "/listings/:id",
    async (request, reply) => {
      const row = app.db.select().from(listings).where(eq(listings.id, request.params.id)).all()[0];
      if (!row) return reply.code(404).send({ error: "Listing not found." });
      const notes = typeof request.body?.notes === "string" ? request.body.notes.slice(0, 4000) : row.notes;
      const nextStatus =
        typeof request.body?.status === "string" && ["open", "visit", "offer", "pass"].includes(request.body.status)
          ? request.body.status
          : row.status;
      const body = request.body ?? {};
      const wantsClear = body.clearPoint === true;
      const wantsMove = Object.prototype.hasOwnProperty.call(body, "latitude") || Object.prototype.hasOwnProperty.call(body, "longitude");
      if (wantsClear && wantsMove) return reply.code(400).send({ error: "Send a point or clearPoint, not both." });
      let latitude = row.latitude;
      let longitude = row.longitude;
      let locationPrecision = row.locationPrecision === "exact" ? "exact" : null;
      if (wantsClear) {
        latitude = null;
        longitude = null;
        locationPrecision = null;
      } else if (wantsMove) {
        const placed = exactPoint(body.latitude, body.longitude);
        if (!placed) return reply.code(400).send({ error: "A point needs both coordinates in range." });
        latitude = placed.latitude;
        longitude = placed.longitude;
        locationPrecision = "exact";
      }
      const pointMoved = !samePoint(row.latitude, row.longitude, latitude, longitude);
      const brw = pointMoved ? clearedBrw() : keptBrw(row);
      app.db
        .update(listings)
        .set({ notes, status: nextStatus, latitude, longitude, locationPrecision, ...brw, updatedAt: new Date().toISOString() })
        .where(eq(listings.id, row.id))
        .run();
      const stored = app.db.select().from(listings).where(eq(listings.id, row.id)).all()[0];
      const ctx = context();
      return present(stored, ctx.priceMap, ctx.past, ctx.model);
    },
  );

  app.post("/listings", async (request, reply) => {
    const parsed = parseIngest(request.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const listing = parsed.listing;
    const now = new Date().toISOString();
    const rows = app.db.select().from(listings).all();
    const existing = rows.find((row) => {
      if (listing.externalId && row.externalId === listing.externalId && row.source === listing.source) return true;
      return Boolean(listing.sourceUrl && listing.sourceUrl.length > 8 && row.sourceUrl === listing.sourceUrl);
    });
    const id = existing?.id ?? crypto.randomUUID();
    const located = listing.latitude != null && listing.longitude != null;
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
      locationPrecision: located ? "exact" : (existing?.locationPrecision === "exact" ? "exact" : null),
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
        rawJson: JSON.stringify(request.body ?? {}),
      }).run();
    }
    const stored = app.db.select().from(listings).where(eq(listings.id, id)).all()[0];
    const ctx = context();
    reply.code(existing ? 200 : 201);
    return { created: !existing, ...present(stored, ctx.priceMap, ctx.past, ctx.model) };
  });
}
