import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/app.js";
import { listings } from "../../src/db/schema.js";

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
    await app.close();
  });
});
