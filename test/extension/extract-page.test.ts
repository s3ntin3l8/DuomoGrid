import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

type Extracted = {
  ok: true;
  listing: {
    source: string;
    externalId: string | null;
    title: string;
    priceEur: number | null;
    livingAreaM2: number | null;
    plotAreaM2: number | null;
    city: string;
    postalCode: string | null;
    state: string | null;
    latitude: number | null;
    longitude: number | null;
    propertyType: string;
    listingKind: string;
  };
};

type ExtractGlobals = typeof globalThis & {
  duomoExtract: (doc: unknown, href: string) => Extracted | { ok: false; reason: string };
};

describe("extract a saved exposé document", () => {
  beforeAll(async () => {
    await import("../../extension/extract.js");
  });

  it("reads price from keyValues, area and the point from obj_/geo_ fields, place from JSON-LD, and plot from the label", () => {
    const html = fs.readFileSync(new URL("./fixtures/synthetic-expose.html", import.meta.url), "utf8");
    const doc = new JSDOM(html).window.document;
    const result = (globalThis as ExtractGlobals).duomoExtract(doc, "https://www.immobilienscout24.de/expose/999001");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.listing).toMatchObject({
      source: "immobilienscout24",
      externalId: "999001",
      title: "Altstadt apartment",
      priceEur: 465000,
      livingAreaM2: 92.5,
      plotAreaM2: 520,
      city: "Landshut",
      postalCode: "84028",
      state: "Bayern",
      latitude: 48.537,
      longitude: 12.152,
      propertyType: "apartment",
      listingKind: "sale",
    });
  });
});
