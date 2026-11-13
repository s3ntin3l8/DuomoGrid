import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/app.js";
import { listings, observations } from "../../src/db/schema.js";

describe("listings", () => {
  afterEach(() => {
    delete process.env.INGEST_TOKEN;
  });

  it("rejects ingest when no token is configured", async () => {
    delete process.env.INGEST_TOKEN;
    const app = await buildApp();
    const response = await app.inject({ method: "POST", url: "/listings", payload: { title: "x", priceEur: 1 } });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it("stores a purchase from the extension field names and keeps one observation on a repeat", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const payload = {
      v: 1,
      source: "immobilienscout24",
      sourceUrl: "https://www.immobilienscout24.de/expose/123",
      externalId: "123",
      title: "Old apartment",
      priceEur: 465000,
      livingAreaM2: 92,
      city: "Darmstadt",
      postalCode: "64283",
      state: "HE",
      propertyType: "apartment",
      listingKind: "sale",
      hausgeldEur: 285,
      provisionPercent: 3.57,
      energyClass: "D",
    };
    const created = await app.inject({
      method: "POST",
      url: "/listings",
      headers: { authorization: "Bearer test-token" },
      payload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().created).toBe(true);
    expect(created.json().analysis.transferTaxEur).toBe(27900);
    expect(created.json().listing.offer).toBe("buy");
    expect(created.json().listing.condoFeeEur).toBe(285);
    expect(created.json().listing.latitude).toBeNull();
    expect(created.json().listing.street).toBeNull();

    const streetOnly = await app.inject({
      method: "POST",
      url: "/listings",
      headers: { authorization: "Bearer test-token" },
      payload: { ...payload, street: "Altstadt 1" },
    });
    expect(streetOnly.statusCode).toBe(200);
    expect(streetOnly.json().listing.street).toBe("Altstadt 1");
    expect(streetOnly.json().listing.latitude).toBeNull();

    const again = await app.inject({
      method: "POST",
      url: "/listings",
      headers: { authorization: "Bearer test-token" },
      payload,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().created).toBe(false);
    expect(again.json().id).toBe(created.json().id);

    const listed = await app.inject({
      method: "GET",
      url: "/listings",
      headers: { authorization: "Bearer test-token" },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);

    const moved = await app.inject({
      method: "POST",
      url: "/listings",
      headers: { authorization: "Bearer test-token" },
      payload: { ...payload, latitude: "48.537", longitude: "12.152", street: "Altstadt 12", locationPrecision: "city" },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().listing.latitude).toBe(48.537);
    expect(moved.json().listing.longitude).toBe(12.152);
    expect(moved.json().listing.locationPrecision).toBe("exact");
    expect(moved.json().listing.street).toBe("Altstadt 12");

    const pointOnly = await app.inject({
      method: "POST",
      url: "/listings",
      headers: { authorization: "Bearer test-token" },
      payload: { ...payload, latitude: "48.538", longitude: "12.153" },
    });
    expect(pointOnly.json().listing.latitude).toBe(48.538);
    expect(pointOnly.json().listing.longitude).toBe(12.153);
    expect(pointOnly.json().listing.street).toBe("Altstadt 12");

    const half = await app.inject({
      method: "POST",
      url: "/listings",
      headers: { authorization: "Bearer test-token" },
      payload: { ...payload, latitude: 47.1 },
    });
    expect(half.json().listing.latitude).toBe(48.538);
    expect(half.json().listing.longitude).toBe(12.153);
    expect(half.json().listing.street).toBe("Altstadt 12");

    const omitted = await app.inject({
      method: "POST",
      url: "/listings",
      headers: { authorization: "Bearer test-token" },
      payload,
    });
    expect(omitted.json().listing.latitude).toBe(48.538);
    expect(omitted.json().listing.street).toBe("Altstadt 12");
    expect(omitted.json().notes).toBe("");

    const patched = await app.inject({
      method: "PATCH",
      url: `/listings/${created.json().id}`,
      headers: { authorization: "Bearer test-token" },
      payload: { notes: "Ask about the roof", status: "visit" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().notes).toBe("Ask about the roof");
    expect(patched.json().status).toBe("visit");

    const id = created.json().id as string;
    const before = app.db.select().from(listings).where(eq(listings.id, id)).all()[0];
    const dragged = await app.inject({
      method: "PATCH",
      url: `/listings/${id}`,
      headers: { authorization: "Bearer test-token" },
      payload: { latitude: "48.540", longitude: "12.160" },
    });
    expect(dragged.statusCode).toBe(200);
    expect(dragged.json().listing.latitude).toBe(48.54);
    expect(dragged.json().listing.longitude).toBe(12.16);
    expect(dragged.json().listing.locationPrecision).toBe("exact");
    expect(dragged.json().listing.street).toBe("Altstadt 12");
    expect(dragged.json().notes).toBe("Ask about the roof");
    expect(dragged.json().status).toBe("visit");
    const movedRow = app.db.select().from(listings).where(eq(listings.id, id)).all()[0];
    expect(movedRow?.createdAt).toBe(before?.createdAt);

    const rejected = await app.inject({
      method: "PATCH",
      url: `/listings/${id}`,
      headers: { authorization: "Bearer test-token" },
      payload: { latitude: 0, longitude: 0 },
    });
    expect(rejected.statusCode).toBe(400);
    expect(app.db.select().from(listings).where(eq(listings.id, id)).all()[0]?.latitude).toBe(48.54);

    const cleared = await app.inject({
      method: "PATCH",
      url: `/listings/${id}`,
      headers: { authorization: "Bearer test-token" },
      payload: { clearPoint: true },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().listing.latitude).toBeNull();
    expect(cleared.json().listing.longitude).toBeNull();
    expect(cleared.json().listing.locationPrecision).toBeNull();
    expect(cleared.json().listing.street).toBe("Altstadt 12");
    expect(cleared.json().notes).toBe("Ask about the roof");
    expect(cleared.json().status).toBe("visit");
    expect(app.db.select().from(listings).where(eq(listings.id, id)).all()[0]?.createdAt).toBe(before?.createdAt);

    const assumptions = await app.inject({
      method: "PUT",
      url: "/assumptions",
      headers: { authorization: "Bearer test-token" },
      payload: { notaryPercent: 2 },
    });
    expect(assumptions.statusCode).toBe(200);
    const scored = await app.inject({
      method: "GET",
      url: `/listings/${created.json().id}`,
      headers: { authorization: "Bearer test-token" },
    });
    expect(scored.json().analysis.notaryEur).toBe(9300);
    expect(scored.json().bodenrichtwert).toBeNull();
    await app.close();
  });

  it("caches a Bavarian land value on the detail and does not score it", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const realFetch = globalThis.fetch;
    const calls: string[] = [];
    let body = "bodenrichtwertszonenname = Untere Altstadt\nbodenrichtwert = 2.000\nstichtag = 01.01.2026\n";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const headers = { authorization: "Bearer test-token" };
    const payload = {
      v: 1,
      source: "immobilienscout24",
      sourceUrl: "https://www.immobilienscout24.de/expose/456",
      externalId: "456",
      title: "Altstadt apartment",
      priceEur: 465000,
      livingAreaM2: 92,
      city: "Landshut",
      postalCode: "84028",
      state: "BY",
      propertyType: "apartment",
      listingKind: "sale",
    };
    try {
      const created = await app.inject({ method: "POST", url: "/listings", headers, payload });
      expect(created.statusCode).toBe(201);
      const id = created.json().id as string;
      const score = created.json().analysis.score as number;
      const bare = await app.inject({ method: "GET", url: `/listings/${id}`, headers });
      expect(bare.json().bodenrichtwert).toBeNull();
      expect(calls).toHaveLength(0);

      const placed = await app.inject({
        method: "POST",
        url: "/listings",
        headers,
        payload: { ...payload, latitude: "48.537", longitude: "12.152" },
      });
      expect(placed.json().listing.latitude).toBe(48.537);
      const listed = await app.inject({ method: "GET", url: "/listings", headers });
      const row = listed.json().find((item: { id: string }) => item.id === id);
      expect(row.bodenrichtwert).toEqual({ status: "unknown", zone: null, eurPerM2: null, stichtag: null });
      expect(calls).toHaveLength(0);

      const detail = await app.inject({ method: "GET", url: `/listings/${id}`, headers });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().bodenrichtwert).toEqual({
        status: "published",
        zone: "Untere Altstadt",
        eurPerM2: 2000,
        stichtag: "01.01.2026",
      });
      expect(detail.json().analysis.score).toBe(score);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("bodenrichtwerte_2026");
      expect(calls[0]).toContain("EPSG%3A4326");

      const again = await app.inject({ method: "GET", url: `/listings/${id}`, headers });
      expect(again.json().bodenrichtwert.eurPerM2).toBe(2000);
      expect(calls).toHaveLength(1);

      const kept = await app.inject({ method: "POST", url: "/listings", headers, payload });
      expect(kept.json().bodenrichtwert.eurPerM2).toBe(2000);
      expect(calls).toHaveLength(1);

      body = "";
      await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { latitude: 49.8728, longitude: 8.6512 },
      });
      const outside = await app.inject({ method: "GET", url: `/listings/${id}`, headers });
      expect(outside.json().bodenrichtwert).toEqual({ status: "none", zone: null, eurPerM2: null, stichtag: null });
      expect(outside.json().analysis.score).toBe(score);
      await app.inject({ method: "GET", url: `/listings/${id}`, headers });
      expect(calls).toHaveLength(2);

      body = "bodenrichtwertszonenname = Marienplatz\nbodenrichtwert = Information gebührenpflichtig\nstichtag = 01.01.2026\n";
      const moved = await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { latitude: 48.1374, longitude: 11.5755 },
      });
      expect(moved.json().bodenrichtwert.status).toBe("unknown");
      expect(moved.json().analysis.score).toBe(score);
      const paywalled = await app.inject({ method: "GET", url: `/listings/${id}`, headers });
      expect(paywalled.json().bodenrichtwert).toEqual({
        status: "unpublished",
        zone: "Marienplatz",
        eurPerM2: null,
        stichtag: "01.01.2026",
      });
      expect(paywalled.json().analysis.score).toBe(score);
      expect(calls).toHaveLength(3);

      body = "bodenrichtwertszonenname = Acker\nbodenrichtwert = 0,4\nstichtag = 01.01.2026\n";
      await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { latitude: 48.8, longitude: 12.4 },
      });
      const decimal = await app.inject({ method: "GET", url: `/listings/${id}`, headers });
      expect(decimal.json().bodenrichtwert).toEqual({
        status: "published",
        zone: "Acker",
        eurPerM2: 0.4,
        stichtag: "01.01.2026",
      });
      expect(decimal.json().analysis.score).toBe(score);

      let failures = 0;
      globalThis.fetch = (async () => {
        failures += 1;
        throw new Error("offline");
      }) as typeof fetch;
      const shifted = await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { latitude: 48.5748, longitude: 13.4609 },
      });
      expect(shifted.statusCode).toBe(200);
      const failed = await app.inject({ method: "GET", url: `/listings/${id}`, headers });
      expect(failed.statusCode).toBe(200);
      expect(failed.json().bodenrichtwert.status).toBe("unknown");
      expect(failed.json().analysis.score).toBe(score);
      const failedAgain = await app.inject({ method: "GET", url: `/listings/${id}`, headers });
      expect(failedAgain.json().bodenrichtwert.status).toBe("unknown");
      expect(failures).toBe(1);

      const cleared = await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { clearPoint: true },
      });
      expect(cleared.json().bodenrichtwert).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
      await app.close();
    }
  });

  it("shows a district sale band for a buy and not for a rental", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const base = {
      v: 1,
      source: "immobilienscout24",
      sourceUrl: "https://www.immobilienscout24.de/expose/789",
      externalId: "789",
      title: "Munich apartment",
      priceEur: 700000,
      livingAreaM2: 80,
      city: "München",
      state: "BY",
      propertyType: "apartment",
      listingKind: "sale",
    };
    const created = await app.inject({ method: "POST", url: "/listings", headers, payload: base });
    expect(created.statusCode).toBe(201);
    expect(created.json().districtSaleBand).toEqual({
      name: "München",
      stateName: "Bayern",
      year: 2024,
      band: "3250 und mehr",
      kind: "apartment",
    });

    const house = await app.inject({
      method: "POST",
      url: "/listings",
      headers,
      payload: {
        ...base,
        externalId: "790",
        sourceUrl: "https://www.immobilienscout24.de/expose/790",
        propertyType: "house",
        title: "Munich house",
      },
    });
    expect(house.json().districtSaleBand).toMatchObject({ kind: "house", band: "3500 und mehr", name: "München" });

    const landshut = await app.inject({
      method: "POST",
      url: "/listings",
      headers,
      payload: {
        ...base,
        externalId: "792",
        sourceUrl: "https://www.immobilienscout24.de/expose/792",
        city: "Landshut",
        title: "Landshut apartment",
      },
    });
    expect(landshut.json().districtSaleBand).toMatchObject({ name: "Landshut", kind: "apartment", year: 2024 });
    const unmatched = await app.inject({
      method: "POST",
      url: "/listings",
      headers,
      payload: {
        ...base,
        externalId: "793",
        sourceUrl: "https://www.immobilienscout24.de/expose/793",
        city: "Nowhere",
        title: "Unmatched apartment",
      },
    });
    expect(unmatched.json().districtSaleBand).toBeNull();
    expect(landshut.json().analysis.score).toEqual(expect.any(Number));
    expect(landshut.json().analysis.score).toBe(unmatched.json().analysis.score);
    expect(landshut.json().analysis.subscores).toEqual(unmatched.json().analysis.subscores);

    const rented = await app.inject({
      method: "POST",
      url: "/listings",
      headers,
      payload: {
        ...base,
        externalId: "791",
        sourceUrl: "https://www.immobilienscout24.de/expose/791",
        listingKind: "rent",
        priceEur: 1800,
        title: "Munich rent",
      },
    });
    expect(rented.json().districtSaleBand).toBeNull();
    expect(rented.json().analysis.score).toBeNull();
    expect(rented.json().analysis.verdict).toBe("rent");
    expect(rented.json().analysis.flags.some((flag: { title: string; detail: string }) => /bodenrichtwert|district sale band/i.test(`${flag.title} ${flag.detail}`))).toBe(false);
    await app.close();
  });

  it("flags a published land value and a district sale band without changing the score", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("bodenrichtwertszonenname = Untere Altstadt\nbodenrichtwert = 2.000\nstichtag = 01.01.2026\n", { status: 200 })) as typeof fetch;
    const headers = { authorization: "Bearer test-token" };
    try {
      const created = await app.inject({
        method: "POST",
        url: "/listings",
        headers,
        payload: {
          v: 1,
          source: "immobilienscout24",
          sourceUrl: "https://www.immobilienscout24.de/expose/794",
          externalId: "794",
          title: "Landshut apartment",
          priceEur: 280000,
          livingAreaM2: 80,
          city: "Landshut",
          state: "BY",
          propertyType: "apartment",
          listingKind: "sale",
          latitude: "48.537",
          longitude: "12.152",
        },
      });
      expect(created.statusCode).toBe(201);
      const score = created.json().analysis.score;
      expect(created.json().analysis.flags.some((flag: { title: string }) => flag.title === "Inside the district sale band")).toBe(true);
      expect(created.json().analysis.flags.some((flag: { title: string }) => /bodenrichtwert/i.test(flag.title))).toBe(false);

      const detail = await app.inject({ method: "GET", url: `/listings/${created.json().id}`, headers });
      expect(detail.json().bodenrichtwert).toMatchObject({ status: "published", eurPerM2: 2000 });
      expect(detail.json().analysis.score).toBe(score);
      expect(detail.json().analysis.subscores).toEqual(created.json().analysis.subscores);
      const land = detail.json().analysis.flags.find((flag: { title: string }) => flag.title === "Bodenrichtwert is a land value");
      expect(land.detail).toContain("2.000 EUR/m2 of land");
      expect(land.detail).toContain("not the same unit");
      expect(detail.json().analysis.flags.some((flag: { title: string }) => flag.title === "Inside the district sale band")).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
      await app.close();
    }
  });

  it("rejects delete when no token is configured", async () => {
    delete process.env.INGEST_TOKEN;
    const app = await buildApp();
    const response = await app.inject({ method: "DELETE", url: "/listings/x" });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it("corrects facts without moving the point and deletes the listing", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("bodenrichtwertszonenname = Untere Altstadt\nbodenrichtwert = 2.000\nstichtag = 01.01.2026\n", {
        status: 200,
      })) as typeof fetch;
    const headers = { authorization: "Bearer test-token" };
    try {
      const created = await app.inject({
        method: "POST",
        url: "/listings",
        headers,
        payload: {
          v: 1,
          source: "immobilienscout24",
          sourceUrl: "https://www.immobilienscout24.de/expose/901",
          externalId: "901",
          title: "Altstadt apartment",
          priceEur: 465000,
          livingAreaM2: 92,
          city: "Landshut",
          state: "BY",
          propertyType: "apartment",
          listingKind: "sale",
          latitude: "48.537",
          longitude: "12.152",
        },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json().id as string;
      const detail = await app.inject({ method: "GET", url: `/listings/${id}`, headers });
      expect(detail.json().bodenrichtwert.eurPerM2).toBe(2000);

      const corrected = await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { livingAreaM2: 100, offer: "rent" },
      });
      expect(corrected.statusCode).toBe(200);
      expect(corrected.json().listing.livingAreaM2).toBe(100);
      expect(corrected.json().analysis.pricePerLivingM2).toBe(4650);
      expect(corrected.json().listing.offer).toBe("buy");
      expect(corrected.json().listing.latitude).toBe(48.537);
      expect(corrected.json().listing.longitude).toBe(12.152);
      expect(corrected.json().bodenrichtwert).toMatchObject({ status: "published", eurPerM2: 2000 });
      expect(corrected.json().districtSaleBand).not.toBeNull();

      const zero = await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { livingAreaM2: 0, latitude: 49.1, longitude: 8.1 },
      });
      expect(zero.statusCode).toBe(400);
      const unchanged = app.db.select().from(listings).where(eq(listings.id, id)).all()[0];
      expect(unchanged?.livingAreaM2).toBe(100);
      expect(unchanged?.latitude).toBe(48.537);
      expect(unchanged?.brwEurPerM2).toBe(2000);

      const comma = await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { livingAreaM2: "92,5" },
      });
      expect(comma.statusCode).toBe(400);
      expect(app.db.select().from(listings).where(eq(listings.id, id)).all()[0]?.livingAreaM2).toBe(100);

      const badYear = await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { yearBuilt: 1500 },
      });
      expect(badYear.statusCode).toBe(400);
      const badClass = await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { energyClass: "A++" },
      });
      expect(badClass.statusCode).toBe(400);
      const clearedType = await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { propertyType: "" },
      });
      expect(clearedType.statusCode).toBe(400);

      const priced = await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { priceEur: 450000 },
      });
      expect(priced.statusCode).toBe(200);
      expect(priced.json().listing.priceEur).toBe(450000);
      expect(priced.json().observations).toHaveLength(2);
      expect(priced.json().observations[0].priceEur).toBe(450000);

      const repeat = await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { priceEur: 450000 },
      });
      expect(repeat.json().observations).toHaveLength(2);

      const noted = await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { notes: "Ask about the roof" },
      });
      expect(noted.json().notes).toBe("Ask about the roof");
      expect(noted.json().observations).toHaveLength(2);

      const state = await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { state: "XX" },
      });
      expect(state.statusCode).toBe(400);
      expect(app.db.select().from(listings).where(eq(listings.id, id)).all()[0]?.state).toBe("BY");

      const city = await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { city: null },
      });
      expect(city.statusCode).toBe(200);
      expect(city.json().listing.city).toBe("");
      expect(city.json().districtSaleBand).toBeNull();

      const blank = await app.inject({
        method: "PATCH",
        url: `/listings/${id}`,
        headers,
        payload: { city: "  ", district: "" },
      });
      expect(blank.json().listing.city).toBe("");
      expect(blank.json().listing.district).toBeNull();

      const denied = await app.inject({ method: "DELETE", url: `/listings/${id}` });
      expect(denied.statusCode).toBe(401);
      const missing = await app.inject({ method: "DELETE", url: "/listings/missing-id", headers });
      expect(missing.statusCode).toBe(404);
      const removed = await app.inject({ method: "DELETE", url: `/listings/${id}`, headers });
      expect(removed.statusCode).toBe(200);
      expect(removed.json()).toEqual({ deleted: true });
      expect(app.db.select().from(observations).where(eq(observations.listingId, id)).all()).toEqual([]);
      const gone = await app.inject({ method: "GET", url: `/listings/${id}`, headers });
      expect(gone.statusCode).toBe(404);
      const listed = await app.inject({ method: "GET", url: "/listings", headers });
      expect(listed.json().some((item: { id: string }) => item.id === id)).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
      await app.close();
    }
  });

  it("writes a rental price change onto the cold rent the analysis uses", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const created = await app.inject({
      method: "POST",
      url: "/listings",
      headers,
      payload: {
        v: 1,
        source: "immowelt",
        sourceUrl: "https://www.immowelt.de/expose/iw-1",
        externalId: "iw-1",
        title: "Rental",
        priceEur: 1000,
        warmRentEur: 1400,
        livingAreaM2: 50,
        city: "Darmstadt",
        state: "HE",
        propertyType: "apartment",
        listingKind: "rent",
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json().listing.coldRentEur).toBe(1000);
    expect(created.json().analysis.rentPerM2).toBe(20);
    expect(created.json().analysis.score).toBeNull();

    const priced = await app.inject({
      method: "PATCH",
      url: `/listings/${id}`,
      headers,
      payload: { priceEur: 1200 },
    });
    expect(priced.statusCode).toBe(200);
    expect(priced.json().listing.offer).toBe("rent");
    expect(priced.json().listing.priceEur).toBe(1200);
    expect(priced.json().listing.coldRentEur).toBe(1200);
    expect(priced.json().listing.warmRentEur).toBe(1400);
    expect(priced.json().analysis.rentPerM2).toBe(24);
    expect(priced.json().analysis.score).toBeNull();
    expect(priced.json().observations).toHaveLength(2);

    const repeat = await app.inject({
      method: "PATCH",
      url: `/listings/${id}`,
      headers,
      payload: { priceEur: 1200 },
    });
    expect(repeat.json().observations).toHaveLength(2);
    expect(repeat.json().listing.coldRentEur).toBe(1200);

    const zero = await app.inject({
      method: "PATCH",
      url: `/listings/${id}`,
      headers,
      payload: { priceEur: 0 },
    });
    expect(zero.statusCode).toBe(400);
    expect(app.db.select().from(listings).where(eq(listings.id, id)).all()[0]?.coldRentEur).toBe(1200);
    await app.close();
  });

  it("accepts the other fact fields and rejects a bad correction before writing", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const created = await app.inject({
      method: "POST",
      url: "/listings",
      headers,
      payload: {
        v: 1,
        source: "immobilienscout24",
        sourceUrl: "https://www.immobilienscout24.de/expose/902",
        externalId: "902",
        title: "House",
        priceEur: 300000,
        livingAreaM2: 120,
        city: "Landshut",
        state: "BY",
        propertyType: "apartment",
        listingKind: "sale",
        latitude: "48.537",
        longitude: "12.152",
      },
    });
    const id = created.json().id as string;
    const missing = await app.inject({
      method: "PATCH",
      url: "/listings/missing-id",
      headers,
      payload: { city: "X" },
    });
    expect(missing.statusCode).toBe(404);

    const filled = await app.inject({
      method: "PATCH",
      url: `/listings/${id}`,
      headers,
      payload: {
        plotAreaM2: 520,
        rooms: 3.5,
        district: " Altstadt ",
        state: "HE",
        propertyType: "house",
        yearBuilt: 1910,
        energyClass: "A+",
        city: " Darmstadt ",
      },
    });
    expect(filled.statusCode).toBe(200);
    expect(filled.json().listing).toMatchObject({
      plotAreaM2: 520,
      rooms: 3.5,
      district: "Altstadt",
      state: "HE",
      propertyType: "house",
      yearBuilt: 1910,
      energyClass: "A+",
      city: "Darmstadt",
      latitude: 48.537,
      offer: "buy",
    });
    expect(filled.json().analysis.transferTaxPercent).toBe(6);
    expect(filled.json().bodenrichtwert.status).toBe("unknown");

    const cleared = await app.inject({
      method: "PATCH",
      url: `/listings/${id}`,
      headers,
      payload: { plotAreaM2: "", rooms: null, district: "   ", state: "", yearBuilt: "", energyClass: null, livingAreaM2: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().listing).toMatchObject({
      plotAreaM2: null,
      rooms: null,
      district: null,
      state: null,
      yearBuilt: null,
      energyClass: null,
      livingAreaM2: null,
    });
    expect(cleared.json().listing.latitude).toBe(48.537);

    const both = await app.inject({
      method: "PATCH",
      url: `/listings/${id}`,
      headers,
      payload: { clearPoint: true, latitude: 49, longitude: 8 },
    });
    expect(both.statusCode).toBe(400);
    expect(app.db.select().from(listings).where(eq(listings.id, id)).all()[0]?.latitude).toBe(48.537);

    for (const payload of [{ city: 12 }, { district: 4 }, { plotAreaM2: -3 }, { rooms: 0 }, { yearBuilt: 2101 }, { energyClass: "a" }]) {
      const rejected = await app.inject({ method: "PATCH", url: `/listings/${id}`, headers, payload });
      expect(rejected.statusCode).toBe(400);
    }
    const row = app.db.select().from(listings).where(eq(listings.id, id)).all()[0];
    expect(row?.city).toBe("Darmstadt");
    expect(row?.latitude).toBe(48.537);
    await app.close();
  });

  it("keeps a point the user placed when a later save carries only an approximate one", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const payload = {
      v: 1,
      source: "immowelt",
      sourceUrl: "https://www.immowelt.de/expose/aaaa",
      externalId: "aaaa",
      title: "Hepberg",
      priceEur: 319000,
      livingAreaM2: 100,
      city: "Hepberg",
      state: "BY",
      propertyType: "apartment",
      listingKind: "sale",
      latitude: 48.8,
      longitude: 11.46,
      locationPrecision: "approximate",
    };
    const first = await app.inject({ method: "POST", url: "/listings", headers, payload });
    expect(first.statusCode).toBe(201);
    expect(first.json().listing.locationPrecision).toBe("approximate");
    const id = first.json().id as string;

    // An approximate point may be replaced by a newer approximate one.
    const nudged = await app.inject({ method: "POST", url: "/listings", headers, payload: { ...payload, latitude: 48.81 } });
    expect(nudged.json().listing.latitude).toBe(48.81);
    expect(nudged.json().listing.locationPrecision).toBe("approximate");

    // Dragging the pin makes it exact.
    const dragged = await app.inject({ method: "PATCH", url: `/listings/${id}`, headers, payload: { latitude: 48.83, longitude: 11.47 } });
    expect(dragged.json().listing.locationPrecision).toBe("exact");

    // A re-save from the portal must not undo that.
    const resaved = await app.inject({ method: "POST", url: "/listings", headers, payload });
    expect(resaved.statusCode).toBe(200);
    expect(resaved.json().listing.latitude).toBe(48.83);
    expect(resaved.json().listing.longitude).toBe(11.47);
    expect(resaved.json().listing.locationPrecision).toBe("exact");

    // An exact point from the portal still replaces it.
    const exact = await app.inject({
      method: "POST",
      url: "/listings",
      headers,
      payload: { ...payload, latitude: 48.9, longitude: 11.5, locationPrecision: "exact" },
    });
    expect(exact.json().listing.latitude).toBe(48.9);
    expect(exact.json().listing.locationPrecision).toBe("exact");
    await app.close();
  });

  it("handles precision across saves: first save, old extensions, and a pin move with a cached land value", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const payload = {
      source: "immobilienscout24",
      sourceUrl: "https://www.immobilienscout24.de/expose/7",
      externalId: "7",
      title: "Koesching",
      priceEur: 549000,
      livingAreaM2: 128,
      city: "Kösching",
      state: "BY",
      propertyType: "apartment",
      listingKind: "sale",
      latitude: 48.815,
      longitude: 11.509,
      locationPrecision: "approximate",
    };
    const first = await app.inject({ method: "POST", url: "/listings", headers, payload });
    expect(first.json().listing.locationPrecision).toBe("approximate");
    const id = first.json().id as string;
    const cache = { brwStatus: "published", brwZone: "Zone", brwEurPerM2: 2000, brwStichtag: "01.01.2026" };
    app.db.update(listings).set(cache).where(eq(listings.id, id)).run();

    // Sending the stored numbers back through PATCH does not make the point exact, and keeps the cache.
    const same = await app.inject({ method: "PATCH", url: `/listings/${id}`, headers, payload: { latitude: 48.815, longitude: 11.509 } });
    expect(same.json().listing.locationPrecision).toBe("approximate");
    expect(app.db.select().from(listings).where(eq(listings.id, id)).all()[0]?.brwStatus).toBe("published");

    // The same point again keeps the cached land value.
    await app.inject({ method: "POST", url: "/listings", headers, payload });
    expect(app.db.select().from(listings).where(eq(listings.id, id)).all()[0]?.brwStatus).toBe("published");

    // A different approximate point clears it.
    await app.inject({ method: "POST", url: "/listings", headers, payload: { ...payload, latitude: 48.82 } });
    expect(app.db.select().from(listings).where(eq(listings.id, id)).all()[0]?.brwStatus).toBeNull();

    // An older extension sends no precision, so its point is trusted as exact and replaces the approximate one.
    const { locationPrecision: _dropped, ...old } = payload;
    const relabelled = await app.inject({ method: "POST", url: "/listings", headers, payload: { ...old, latitude: 48.83 } });
    expect(relabelled.json().listing.locationPrecision).toBe("exact");
    expect(relabelled.json().listing.latitude).toBe(48.83);

    // Moving an approximate pin with PATCH flips it to exact and clears the cached land value together.
    await app.inject({ method: "DELETE", url: `/listings/${id}`, headers });
    const again = await app.inject({ method: "POST", url: "/listings", headers, payload });
    const id2 = again.json().id as string;
    app.db.update(listings).set(cache).where(eq(listings.id, id2)).run();
    const moved = await app.inject({ method: "PATCH", url: `/listings/${id2}`, headers, payload: { latitude: 48.9, longitude: 11.6 } });
    expect(moved.json().listing.locationPrecision).toBe("exact");
    const row = app.db.select().from(listings).where(eq(listings.id, id2)).all()[0];
    expect(row?.brwStatus).toBeNull();
    expect(row?.brwEurPerM2).toBeNull();
    await app.close();
  });

  it("keeps the long text on the detail route only, and keeps stored details when a save lacks the keys", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const base = {
      source: "immowelt",
      sourceUrl: "https://www.immowelt.de/expose/bbbb",
      externalId: "bbbb",
      title: "Details",
      priceEur: 300000,
      livingAreaM2: 90,
      city: "Hepberg",
      state: "BY",
      propertyType: "apartment",
      listingKind: "sale",
    };
    const rich = {
      ...base,
      heatingSystem: "Zentralheizung",
      energySource: "Pellets",
      parkingSpaces: 2,
      parkingType: "garage",
      parkingPriceEur: 10000,
      bathrooms: 1,
      description: { object: "Die Wohnung wurde ca. im Jahr 2015 renoviert. Keine Sonderumlage.", other: "Sonstiges" },
      details: [{ label: "Heizungsart", value: "Zentralheizung" }],
    };
    const created = await app.inject({ method: "POST", url: "/listings", headers, payload: rich });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json().listing.description).toBeNull();
    expect(created.json().listing.details).toEqual([]);

    const listedAll = await app.inject({ method: "GET", url: "/listings", headers });
    type Row = { id: string; listing: { description: unknown; parkingSpaces: number | null }; descriptionFindings: unknown; analysis: { score: number | null } };
    const listedRow = (listedAll.json() as Row[]).find((item) => item.id === id) as Row;
    expect(listedRow.listing.description).toBeNull();
    expect(listedRow.listing.parkingSpaces).toBe(2);
    expect(listedRow.descriptionFindings).toBeNull();

    const detail = await app.inject({ method: "GET", url: `/listings/${id}`, headers });
    expect(detail.json().listing.description.object).toContain("renoviert");
    expect(detail.json().listing.details).toEqual([{ label: "Heizungsart", value: "Zentralheizung" }]);
    expect(detail.json().descriptionFindings.renovatedYear).toBe(2015);
    expect(detail.json().descriptionFindings.items.map((item: { key: string }) => item.key)).not.toContain("special_levy");

    // The score and flags do not depend on which route asked.
    expect(listedRow.analysis.score).toBe(detail.json().analysis.score);

    // The observation copy of the body does not carry the long text.
    const observed = app.db.select().from(observations).where(eq(observations.listingId, id)).all()[0];
    expect(observed?.rawJson).not.toContain("renoviert");
    expect(observed?.rawJson).toContain("Hepberg");

    // An older extension re-saves without the new keys: nothing is blanked.
    const again = await app.inject({ method: "POST", url: "/listings", headers, payload: base });
    expect(again.statusCode).toBe(200);
    const kept = await app.inject({ method: "GET", url: `/listings/${id}`, headers });
    expect(kept.json().listing).toMatchObject({ heatingSystem: "Zentralheizung", energySource: "Pellets", parkingSpaces: 2, parkingPriceEur: 10000, bathrooms: 1 });
    expect(kept.json().listing.description.object).toContain("renoviert");
    expect(kept.json().listing.details).toHaveLength(1);

    // A newer extension that sends the key as null does clear it: the page really no longer says it.
    const cleared = await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, parkingSpaces: null, description: null } });
    expect(cleared.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: `/listings/${id}`, headers });
    expect(after.json().listing.parkingSpaces).toBeNull();
    expect(after.json().listing.description).toBeNull();
    expect(after.json().listing.energySource).toBe("Pellets");

    // The year read from the text moves nothing the stored columns say, and the list and the detail agree on the result.
    const flagsOf = (value: { analysis: { flags: { title: string }[]; score: number | null } }) => ({ score: value.analysis.score, flags: value.analysis.flags.map((flag) => flag.title) });
    await app.inject({
      method: "POST",
      url: "/listings",
      headers,
      payload: { ...base, yearBuilt: 1960, energyClass: "G", description: { object: "Das Bad wurde 2019 renoviert." } },
    });
    const viaDetail = (await app.inject({ method: "GET", url: `/listings/${id}`, headers })).json();
    const viaList = ((await app.inject({ method: "GET", url: "/listings", headers })).json() as { id: string }[]).find((item) => item.id === id) as typeof viaDetail;
    expect(viaDetail.listing.yearRefurbished).toBeNull();
    expect(viaDetail.descriptionFindings.renovatedYear).toBe(2019);
    expect(flagsOf(viaList)).toEqual(flagsOf(viaDetail));
    expect(flagsOf(viaDetail).flags).not.toContain("Unrenovated building");

    // The findings follow the stored text: a save with another description is read again, not served from the cache.
    await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, description: { object: "Das Bad wurde 2012 renoviert." } } });
    const reread = (await app.inject({ method: "GET", url: `/listings/${id}`, headers })).json();
    expect(reread.descriptionFindings.renovatedYear).toBe(2012);

    // A renovation year read from the text never overrides a stored one.
    const stored = await app.inject({ method: "POST", url: "/listings", headers, payload: { ...rich, yearRefurbished: 2020 } });
    expect(stored.json().listing.yearRefurbished).toBe(2020);
    await app.close();
  });

  it("returns images on the detail route only, gives the list a cover, and keeps them when a save lacks the key", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const base = {
      source: "immowelt",
      sourceUrl: "https://www.immowelt.de/expose/cccc",
      externalId: "cccc",
      title: "Pictures",
      priceEur: 300000,
      livingAreaM2: 90,
      city: "Hepberg",
      state: "BY",
      propertyType: "apartment",
      listingKind: "sale",
    };
    const plan = { url: "https://mms.immowelt.de/f/1.jpg", caption: "1. OG", kind: "floorplan" };
    const photo = { url: "https://mms.immowelt.de/p/1.jpg", caption: "Titelbild", kind: "photo" };
    const created = await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, images: [plan, photo, { url: "https://evil.example/x.jpg" }] } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json().listing.images).toEqual([]);
    expect(created.json().coverUrl).toBe(photo.url);

    type Row = { id: string; coverUrl: string | null; listing: { images: unknown[] } };
    const listed = ((await app.inject({ method: "GET", url: "/listings", headers })).json() as Row[]).find((item) => item.id === id) as Row;
    expect(listed.listing.images).toEqual([]);
    expect(listed.coverUrl).toBe(photo.url);

    const detail = await app.inject({ method: "GET", url: `/listings/${id}`, headers });
    expect(detail.json().listing.images).toEqual([
      { url: plan.url, caption: "1. OG", kind: "floorplan" },
      { url: photo.url, caption: "Titelbild", kind: "photo" },
    ]);

    const observed = app.db.select().from(observations).where(eq(observations.listingId, id)).all()[0];
    expect(observed?.rawJson).not.toContain("mms.immowelt.de");

    // A floor plan alone is not a cover.
    const planOnly = await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, images: [plan] } });
    expect(planOnly.json().coverUrl).toBeNull();

    // An older extension re-saves without the key: nothing is blanked. An explicit empty list does clear it.
    await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, images: [plan, photo] } });
    await app.inject({ method: "POST", url: "/listings", headers, payload: base });
    expect((await app.inject({ method: "GET", url: `/listings/${id}`, headers })).json().listing.images).toHaveLength(2);
    // A save in which every URL was refused (a changed CDN host) is not a statement that there are none.
    await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, images: [{ url: "https://evil.example/x.jpg" }] } });
    expect((await app.inject({ method: "GET", url: `/listings/${id}`, headers })).json().listing.images).toHaveLength(2);
    await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, images: [] } });
    expect((await app.inject({ method: "GET", url: `/listings/${id}`, headers })).json().listing.images).toEqual([]);
    await app.close();
  });

  it("lets the desk load images from the two portal CDNs and from nowhere else", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    const policy = String(response.headers["content-security-policy"]);
    const imgSrc = policy.split(";").map((part) => part.trim()).find((part) => part.startsWith("img-src")) ?? "";
    expect(imgSrc).toContain("https://pictures.immobilienscout24.de");
    expect(imgSrc).toContain("https://mms.immowelt.de");
    expect(imgSrc).not.toContain("*");
    await app.close();
  });

  it("builds the price history from saves and the portal's earlier price, and keeps the first one reported", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const base = {
      source: "immowelt",
      sourceUrl: "https://www.immowelt.de/expose/dddd",
      externalId: "dddd",
      title: "History",
      livingAreaM2: 100,
      city: "Hepberg",
      state: "BY",
      propertyType: "apartment",
      listingKind: "sale",
      listedAt: "2026-10-30T12:00:00.000Z",
    };
    const first = await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, priceEur: 319000, portalPreviousPriceEur: 329000 } });
    const id = first.json().id as string;
    expect(first.json().priceHistory).toMatchObject({ firstKnownPriceEur: 329000, currentPriceEur: 319000, reductions: 1, startedBasis: "portal" });
    expect(first.json().priceHistory.points[0]).toEqual({ priceEur: 329000, at: null, source: "portal" });

    // The portal cuts again and now reports 319000 as the earlier price. 329000 is the one that predates what we saw.
    const second = await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, priceEur: 299000, portalPreviousPriceEur: 319000 } });
    expect(second.json().priceHistory.points.map((point: { priceEur: number }) => point.priceEur)).toEqual([329000, 319000, 299000]);
    expect(second.json().priceHistory).toMatchObject({ reductions: 2, currentPriceEur: 299000, firstKnownPriceEur: 329000 });
    expect(second.json().priceHistory.totalChangePct).toBeCloseTo((-30000 / 329000) * 100);

    // A save without the key keeps it too, and the same price adds no observation.
    await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, priceEur: 299000 } });
    const stored = app.db.select().from(listings).where(eq(listings.id, id)).all()[0];
    expect(stored?.portalPreviousPriceEur).toBe(329000);
    expect(app.db.select().from(observations).where(eq(observations.listingId, id)).all()).toHaveLength(2);

    // The list caps the observations it sends at 12; the history behind priceHistory does not.
    for (let price = 298000; price > 298000 - 15 * 1000; price -= 1000) {
      await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, priceEur: price } });
    }
    type Row = { id: string; observations: unknown[]; priceHistory: { reductions: number } };
    const listed = ((await app.inject({ method: "GET", url: "/listings", headers })).json() as Row[]).find((item) => item.id === id) as Row;
    expect(listed.observations).toHaveLength(12);
    expect(listed.priceHistory.reductions).toBe(17);
    const detail = (await app.inject({ method: "GET", url: `/listings/${id}`, headers })).json() as Row;
    expect(detail.observations).toHaveLength(17);
    await app.close();
  });

  it("refreshes only a saved listing when asked to update only, and never saves a new one", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const payload = {
      source: "immobilienscout24",
      sourceUrl: "https://www.immobilienscout24.de/expose/777001",
      externalId: "777001",
      title: "Update only",
      priceEur: 400000,
      livingAreaM2: 80,
      city: "Landshut",
      state: "BY",
      propertyType: "apartment",
      listingKind: "sale",
    };
    const before = app.db.select().from(listings).all().length;
    const unsaved = await app.inject({ method: "POST", url: "/listings?updateOnly=1", headers, payload });
    expect(unsaved.statusCode).toBe(204);
    expect(unsaved.body).toBe("");
    expect(app.db.select().from(listings).all()).toHaveLength(before);

    const saved = await app.inject({ method: "POST", url: "/listings", headers, payload });
    expect(saved.statusCode).toBe(201);
    const id = saved.json().id as string;
    await app.inject({ method: "PATCH", url: `/listings/${id}`, headers, payload: { notes: "keep me", status: "visit" } });

    const refreshed = await app.inject({ method: "POST", url: "/listings?updateOnly=1", headers, payload: { ...payload, priceEur: 380000 } });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().created).toBe(false);
    expect(refreshed.json().id).toBe(id);
    expect(refreshed.json().notes).toBe("keep me");
    expect(refreshed.json().status).toBe("visit");
    expect(refreshed.json().priceHistory.reductions).toBe(1);
    expect(app.db.select().from(observations).where(eq(observations.listingId, id)).all()).toHaveLength(2);

    // The guard still applies to the query form.
    const denied = await app.inject({ method: "POST", url: "/listings?updateOnly=1", payload });
    expect(denied.statusCode).toBe(401);
    await app.close();
  });

  it("treats an update-only save as a price check: corrections stay, nothing is erased, a null price is not recorded", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const payload = {
      source: "immobilienscout24",
      sourceUrl: "https://www.immobilienscout24.de/expose/777002",
      externalId: "777002",
      title: "Price check",
      priceEur: 400000,
      livingAreaM2: 80,
      rooms: 3,
      city: "Landshut",
      state: "BY",
      propertyType: "apartment",
      listingKind: "sale",
      energyClass: "C",
      description: { object: "Original text." },
    };
    const saved = await app.inject({ method: "POST", url: "/listings", headers, payload });
    const id = saved.json().id as string;
    await app.inject({ method: "PATCH", url: `/listings/${id}`, headers, payload: { livingAreaM2: 95, city: "Corrected" } });

    // The page shows a new price, a different area, no rooms, and a partly loaded description.
    const checked = await app.inject({
      method: "POST",
      url: "/listings?updateOnly=true",
      headers,
      payload: { ...payload, priceEur: 380000, livingAreaM2: 60, rooms: null, energyClass: null, description: { object: "Different." }, listedAt: "2026-11-01T00:00:00.000Z" },
    });
    expect(checked.statusCode).toBe(200);
    const after = (await app.inject({ method: "GET", url: `/listings/${id}`, headers })).json();
    expect(after.listing).toMatchObject({ priceEur: 380000, livingAreaM2: 95, city: "Corrected", rooms: 3, energyClass: "C", listedAt: "2026-11-01T00:00:00.000Z" });
    expect(after.listing.description.object).toBe("Original text.");
    expect(app.db.select().from(observations).where(eq(observations.listingId, id)).all()).toHaveLength(2);

    // A page that shows no price does not null the stored one.
    const blank = await app.inject({ method: "POST", url: "/listings?updateOnly=1", headers, payload: { ...payload, priceEur: null } });
    expect(blank.statusCode).toBe(200);
    expect(blank.json().listing.priceEur).toBe(380000);
    expect(app.db.select().from(observations).where(eq(observations.listingId, id)).all()).toHaveLength(2);

    // The same price again writes nothing at all.
    const stamp = app.db.select().from(listings).where(eq(listings.id, id)).all()[0]?.updatedAt;
    await app.inject({ method: "POST", url: "/listings?updateOnly=1", headers, payload: { ...payload, priceEur: 380000, listedAt: "2026-11-01T00:00:00.000Z" } });
    expect(app.db.select().from(listings).where(eq(listings.id, id)).all()[0]?.updatedAt).toBe(stamp);
    await app.close();
  });

  it("counts prices seen, not rows, and lets the portal's price win over a hand-corrected one", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const base = {
      source: "immowelt",
      sourceUrl: "https://www.immowelt.de/expose/seen1",
      externalId: "seen1",
      title: "Seen",
      livingAreaM2: 100,
      city: "Hepberg",
      state: "BY",
      propertyType: "apartment",
      listingKind: "sale",
    };
    // The first save had no price, so a row exists but no price has been seen. The earlier price is still accepted.
    const first = await app.inject({ method: "POST", url: "/listings", headers, payload: base });
    const id = first.json().id as string;
    const priced = await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, priceEur: 300000, portalPreviousPriceEur: 320000 } });
    expect(priced.json().priceHistory.points.map((point: { priceEur: number }) => point.priceEur)).toEqual([320000, 300000]);
    expect(app.db.select().from(listings).where(eq(listings.id, id)).all()[0]?.portalPreviousPriceEur).toBe(320000);

    // A price corrected by hand is an observation, and the portal's price replaces it on the next price check.
    await app.inject({ method: "PATCH", url: `/listings/${id}`, headers, payload: { priceEur: 250000 } });
    const checked = await app.inject({ method: "POST", url: "/listings?updateOnly=1", headers, payload: { ...base, priceEur: 300000 } });
    expect(checked.json().listing.priceEur).toBe(300000);
    await app.close();
  });

  it("keeps a rental's cold rent in step when an update-only save sees a new rent", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const payload = {
      source: "immowelt",
      sourceUrl: "https://www.immowelt.de/expose/rent1",
      externalId: "rent1",
      title: "Rent",
      priceEur: 1400,
      coldRentEur: 1400,
      livingAreaM2: 70,
      city: "Landshut",
      state: "BY",
      propertyType: "apartment",
      listingKind: "rent",
    };
    const saved = await app.inject({ method: "POST", url: "/listings", headers, payload });
    const id = saved.json().id as string;
    const checked = await app.inject({ method: "POST", url: "/listings?updateOnly=1", headers, payload: { ...payload, priceEur: 1350, coldRentEur: 1350 } });
    expect(checked.json().listing.coldRentEur).toBe(1350);
    expect(checked.json().analysis.rentPerM2).toBeCloseTo(1350 / 70);
    expect(checked.json().analysis.score).toBeNull();
    expect(app.db.select().from(observations).where(eq(observations.listingId, id)).all()).toHaveLength(2);
    await app.close();
  });

  it("ignores an earlier price that arrives after this desk has seen the price move", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const base = {
      source: "immowelt",
      sourceUrl: "https://www.immowelt.de/expose/late1",
      externalId: "late1",
      title: "Late",
      livingAreaM2: 100,
      city: "Hepberg",
      state: "BY",
      propertyType: "apartment",
      listingKind: "sale",
    };
    const first = await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, priceEur: 500000 } });
    const id = first.json().id as string;
    await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, priceEur: 450000 } });
    const late = await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, priceEur: 400000, portalPreviousPriceEur: 450000 } });
    expect(app.db.select().from(listings).where(eq(listings.id, id)).all()[0]?.portalPreviousPriceEur).toBeNull();
    expect(late.json().priceHistory.points.map((point: { priceEur: number }) => point.priceEur)).toEqual([500000, 450000, 400000]);
    expect(late.json().priceHistory).toMatchObject({ reductions: 2, increases: 0 });
    await app.close();
  });

  it("adds parking to the cash needed and raises history flags, with the same result on the list and the detail", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const base = {
      source: "immobilienscout24",
      sourceUrl: "https://www.immobilienscout24.de/expose/888001",
      externalId: "888001",
      title: "Parking",
      priceEur: 549000,
      livingAreaM2: 128,
      city: "Kösching",
      state: "BY",
      propertyType: "apartment",
      listingKind: "sale",
      energyClass: "A+",
      parkingSpaces: 2,
      parkingPriceEur: 10000,
    };
    const created = await app.inject({ method: "POST", url: "/listings", headers, payload: base });
    const id = created.json().id as string;
    expect(created.json().analysis).toMatchObject({ parkingEur: 20000, transferTaxPercent: 3.5 });
    // 569000 * 3.5 percent: the tax is charged on the parking as well.
    expect(created.json().analysis.transferTaxEur).toBe(19915);
    expect(created.json().analysis.pricePerLivingM2).toBeCloseTo(549000 / 128);
    await app.inject({ method: "POST", url: "/listings", headers, payload: { ...base, priceEur: 499000 } });

    type Row = { id: string; analysis: { score: number | null; flags: { title: string }[] } };
    const viaList = ((await app.inject({ method: "GET", url: "/listings", headers })).json() as Row[]).find((item) => item.id === id) as Row;
    const viaDetail = (await app.inject({ method: "GET", url: `/listings/${id}`, headers })).json() as Row;
    expect(viaList.analysis.score).toBe(viaDetail.analysis.score);
    const titles = viaDetail.analysis.flags.map((flag) => flag.title);
    expect(titles).toEqual(expect.arrayContaining(["Parking is priced separately", "Price has been reduced"]));
    expect(viaList.analysis.flags.map((flag) => flag.title)).toEqual(titles);
    await app.close();
  });
});
