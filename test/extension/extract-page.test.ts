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

function extract(file: string, href: string) {
  const html = fs.readFileSync(new URL(file, import.meta.url), "utf8");
  const doc = new JSDOM(html).window.document;
  return (globalThis as ExtractGlobals).duomoExtract(doc, href);
}

describe("extract a saved exposé document", () => {
  beforeAll(async () => {
    await import("../../extension/extract.js");
  });

  it("reads price from keyValues, area and the point from obj_/geo_ fields, place from JSON-LD, and plot from the label", () => {
    const result = extract("./fixtures/synthetic-expose.html", "https://www.immobilienscout24.de/expose/999001");
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

  it("detects an Immowelt exposé and still prefers the earlier collectors over the decoys", () => {
    const result = extract("./fixtures/synthetic-immowelt.html", "https://www.immowelt.de/expose/iw-77");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.listing).toMatchObject({
      source: "immowelt",
      externalId: "iw-77",
      title: "Isar house",
      priceEur: 210000,
      livingAreaM2: 118,
      plotAreaM2: 640,
      city: "Landshut",
      postalCode: "84028",
      state: "Bayern",
      latitude: 48.537,
      longitude: 12.151,
      propertyType: "house",
      listingKind: "sale",
    });
  });

  it("rejects a results page", () => {
    const result = extract(
      "./fixtures/synthetic-expose.html",
      "https://www.immobilienscout24.de/Suche/de/bayern/landshut/wohnung-kaufen",
    );
    expect(result).toEqual({
      ok: false,
      reason: "Open a single listing on ImmoScout24 or Immowelt, not a results page.",
    });
  });
});
