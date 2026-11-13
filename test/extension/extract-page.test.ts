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
    locationPrecision: string | null;
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

function extractHtml(html: string, href: string) {
  const doc = new JSDOM(html).window.document;
  return (globalThis as ExtractGlobals).duomoExtract(doc, href);
}

function is24Page(location: string) {
  return `<!doctype html><html><head><script>
    IS24.expose = {"exposeMap":{"location":${location}}};
    keyValues = {"obj_purchasePrice":"100000","obj_scoutId":"5"};
  </script></head><body><h1>x</h1></body></html>`;
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

  it("reads the current ImmoScout24 layout: the town, the map point by path, no placeholders", () => {
    const result = extract("./fixtures/synthetic-is24-current.html", "https://www.immobilienscout24.de/expose/999002");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const listing = result.listing as typeof result.listing & Record<string, unknown>;
    expect(listing).toMatchObject({
      externalId: "999002",
      priceEur: 300000,
      livingAreaM2: 80.5,
      rooms: 3,
      // regio2 is the Kreis. The town comes from locationAddress, and the district would only repeat it.
      city: "Testdorf",
      district: null,
      postalCode: "80000",
      state: "Bayern",
      // The location object, not the bounding-box corners that share its key names.
      latitude: 48.5,
      longitude: 11.5,
      locationPrecision: "approximate",
      street: null,
      condition: null,
      energyCert: "bedarf",
      energyClass: "B",
      provisionPercent: null,
      provisionText: "siehe Sonstiges",
      rentedOut: false,
    });
    expect(String(listing.snippet)).toContain("Ruhige Wohnung im Testdorf");
  });

  it("reads the current Immowelt layout from the double-encoded JSON, with the URL id and a polygon centre", () => {
    const result = extract(
      "./fixtures/synthetic-immowelt-current.html",
      "https://www.immowelt.de/expose/11111111-2222-3333-4444-555555555555",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const listing = result.listing as typeof result.listing & Record<string, unknown>;
    expect(listing).toMatchObject({
      source: "immowelt",
      externalId: "11111111-2222-3333-4444-555555555555",
      title: "Helle Wohnung im Testdorf",
      priceEur: 250000,
      livingAreaM2: 90.5,
      rooms: 3,
      city: "Testdorf",
      postalCode: "80000",
      state: "Bayern",
      latitude: 48.1,
      longitude: 11.1,
      locationPrecision: "approximate",
      propertyType: "apartment",
      listingKind: "sale",
      yearBuilt: 1985,
      energyClass: "D",
      energyKwh: 102.5,
      energyCert: "verbrauch",
      heating: "Zentralheizung",
      provisionPercent: 3.57,
      condition: "Well kept",
      floor: "1. Geschoss/2 Geschossen",
      rentedOut: false,
    });
    expect(listing.features).toEqual(["Keller", "Garten"]);
  });

  it("treats a missing showFullAddress as approximate, and ignores a point the portal marks unavailable", () => {
    const missing = extractHtml(is24Page('{"latitude":48.5,"longitude":11.5,"coordinateAvailable":true}'), "https://www.immobilienscout24.de/expose/5");
    const full = extractHtml(is24Page('{"latitude":48.5,"longitude":11.5,"coordinateAvailable":true,"showFullAddress":true}'), "https://www.immobilienscout24.de/expose/5");
    const unavailable = extractHtml(is24Page('{"latitude":48.5,"longitude":11.5,"coordinateAvailable":false}'), "https://www.immobilienscout24.de/expose/5");
    for (const result of [missing, full, unavailable]) expect(result.ok).toBe(true);
    if (!missing.ok || !full.ok || !unavailable.ok) return;
    expect(missing.listing).toMatchObject({ latitude: 48.5, locationPrecision: "approximate" });
    expect(full.listing).toMatchObject({ latitude: 48.5, locationPrecision: "exact" });
    expect(unavailable.listing).toMatchObject({ latitude: null, longitude: null, locationPrecision: null });
  });

  it("does not read the next object when locationAddress is null", () => {
    const html = `<!doctype html><html><head><script>
      IS24.expose = {locationAddress: null, other: {city: "Wrongtown"}};
      keyValues = {"obj_regio2":"Beispiel_Kreis","obj_regio3":"Realdorf","obj_purchasePrice":"1","obj_scoutId":"6"};
    </script></head><body><h1>x</h1></body></html>`;
    const result = extractHtml(html, "https://www.immobilienscout24.de/expose/6");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.listing.city).toBe("Realdorf");
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
