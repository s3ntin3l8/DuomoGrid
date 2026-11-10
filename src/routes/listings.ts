import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { analyze } from "../domain/analyze.js";
import { cohortSummary, rentAgainstBuy, type CohortRow } from "../domain/compare.js";
import { parseIngest } from "../domain/ingest.js";
import { DEFAULT_ASSUMPTIONS } from "../domain/types.js";
import type { ListingInput, Offer, PropertyType, Source } from "../domain/types.js";
import { listings, observations } from "../db/schema.js";

function authorized(header: string | undefined, expected: string): boolean {
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const left = Buffer.from(token);
  const right = Buffer.from(expected);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

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

export async function listingsRoute(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    const url = request.url.split("?")[0] ?? "";
    if (!url.startsWith("/listings")) return;
    const expected = app.config.INGEST_TOKEN;
    if (!expected) {
      return reply.code(503).send({ error: "Ingest token is not configured." });
    }
    if (!authorized(request.headers.authorization, expected)) {
      return reply.code(401).send({ error: "Invalid ingest token." });
    }
  });

  function savedPrice(id: string): number | null {
    const latest = app.db
      .select()
      .from(observations)
      .where(eq(observations.listingId, id))
      .orderBy(desc(observations.seenAt))
      .all()[0];
    return latest?.priceEur ?? null;
  }

  function present(row: ListingRow) {
    const priceEur = savedPrice(row.id);
    const input = asInput(row, priceEur);
    const analysis = analyze(input, DEFAULT_ASSUMPTIONS);
    const everyone = app.db.select().from(listings).all().map((item) => toCohort(item, savedPrice(item.id)));
    const subject = toCohort(row, priceEur);
    return {
      id: row.id,
      status: row.status,
      notes: row.notes,
      listing: input,
      analysis,
      cohort: cohortSummary(subject, everyone),
      rentComparison: rentAgainstBuy({ ...subject, monthlyCarryingEur: analysis.monthlyTotal }, everyone),
    };
  }

  app.get("/listings", async () => {
    return app.db
      .select()
      .from(listings)
      .all()
      .map((row) => present(row));
  });

  app.get<{ Params: { id: string } }>("/listings/:id", async (request, reply) => {
    const row = app.db.select().from(listings).where(eq(listings.id, request.params.id)).all()[0];
    if (!row) return reply.code(404).send({ error: "Listing not found." });
    return present(row);
  });

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
    const previous = savedPrice(id);
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
    reply.code(existing ? 200 : 201);
    return { created: !existing, ...present(stored) };
  });
}
