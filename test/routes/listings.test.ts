import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

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
    await app.close();
  });
});
