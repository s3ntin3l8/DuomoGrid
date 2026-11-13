import { beforeAll, describe, expect, it } from "vitest";

type ExtractGlobals = typeof globalThis & {
  duomoParseCoordinate: (value: unknown) => number | null;
  duomoJoinStreet: (streetName: unknown, houseNumber: unknown) => string | null;
  duomoBuildListing: (
    records: Record<string, unknown>[],
    page: { href: string; title: string; text: string },
  ) =>
    | {
        ok: true;
        listing: {
          latitude: number | null;
          longitude: number | null;
          street: string | null;
          locationPrecision: string | null;
          provisionPercent: number | null;
          provisionText: string | null;
          rentedOut: boolean;
        };
      }
    | { ok: false; reason: string };
};

describe("extract helpers", () => {
  beforeAll(async () => {
    await import("../../extension/extract.js");
  });

  it("keeps a coordinate that looks like a German thousand, and does not repeat a house-number token", () => {
    const { duomoParseCoordinate, duomoJoinStreet } = globalThis as ExtractGlobals;
    expect(duomoParseCoordinate("48.137")).toBe(48.137);
    expect(duomoParseCoordinate("12,152")).toBe(12.152);
    expect(duomoJoinStreet("Altstadtstraße 12a", "12")).toBe("Altstadtstraße 12a");
    expect(duomoJoinStreet("Altstadt 12", "12")).toBe("Altstadt 12");
    expect(duomoJoinStreet("Altstadt", "12")).toBe("Altstadt 12");
    expect(duomoJoinStreet("Hauptstraße 112", "12")).toBe("Hauptstraße 112 12");
    expect(duomoJoinStreet("", "12")).toBeNull();
    expect(duomoJoinStreet("Altstadt", "")).toBe("Altstadt");
  });

  it("reads a point and a street from an exposé record, and drops 0,0", () => {
    const { duomoBuildListing } = globalThis as ExtractGlobals;
    const page = { href: "https://www.immobilienscout24.de/expose/123", title: "Altstadt", text: "" };
    const placed = duomoBuildListing(
      [{ latitude: "48.137", longitude: "11.576", street: "Altstadtstraße 12a", houseNumber: "12" }],
      page,
    );
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.listing.latitude).toBe(48.137);
    expect(placed.listing.longitude).toBe(11.576);
    expect(placed.listing.street).toBe("Altstadtstraße 12a");

    const origin = duomoBuildListing([{ latitude: "0", longitude: "0", street: "Nowhere" }], page);
    expect(origin.ok).toBe(true);
    if (!origin.ok) return;
    expect(origin.listing.latitude).toBeNull();
    expect(origin.listing.longitude).toBeNull();
    expect(origin.listing.street).toBe("Nowhere");
  });

  const page = { href: "https://www.immobilienscout24.de/expose/123", title: "Altstadt", text: "" };

  it("labels a point approximate only when the collector says so, and has no label without a point", () => {
    const { duomoBuildListing } = globalThis as ExtractGlobals;
    const approximate = duomoBuildListing([{ latitude: 48.5, longitude: 11.5, locationPrecision: "approximate" }], page);
    const plain = duomoBuildListing([{ latitude: 48.5, longitude: 11.5 }], page);
    const none = duomoBuildListing([{ locationPrecision: "approximate" }], page);
    for (const result of [approximate, plain, none]) expect(result.ok).toBe(true);
    if (!approximate.ok || !plain.ok || !none.ok) return;
    expect(approximate.listing.locationPrecision).toBe("approximate");
    expect(plain.listing.locationPrecision).toBe("exact");
    expect(none.listing.locationPrecision).toBeNull();
  });

  it("reads an obj_courtage text as the commission, and a bare y or n as no text (n is not claimed to mean zero)", () => {
    const { duomoBuildListing } = globalThis as ExtractGlobals;
    const text = duomoBuildListing([{ objcourtage: "3,57 % inkl. MwSt." }], page);
    const yes = duomoBuildListing([{ obj_courtage: "y" }], page);
    const no = duomoBuildListing([{ obj_courtage: "n" }], page);
    const none = duomoBuildListing([{ hascourtage: "no" }], page);
    for (const result of [text, yes, no, none]) expect(result.ok).toBe(true);
    if (!text.ok || !yes.ok || !no.ok || !none.ok) return;
    expect(text.listing.provisionPercent).toBe(3.57);
    expect(yes.listing.provisionPercent).toBeNull();
    expect(yes.listing.provisionText).toBeNull();
    expect(no.listing.provisionPercent).toBeNull();
    expect(no.listing.provisionText).toBeNull();
    expect(none.listing.provisionPercent).toBe(0);
  });

  it("does not read 'nicht vermietet' as tenant occupied, even across a line break", () => {
    const { duomoBuildListing } = globalThis as ExtractGlobals;
    const free = duomoBuildListing([{ description: "Die Wohnung ist nicht\n  vermietet." }], page);
    const rented = duomoBuildListing([{ description: "Die Wohnung ist vermietet." }], page);
    for (const result of [free, rented]) expect(result.ok).toBe(true);
    if (!free.ok || !rented.ok) return;
    expect(free.listing.rentedOut).toBe(false);
    expect(rented.listing.rentedOut).toBe(true);
  });

  it("takes the town instead of the Kreis in every spelling, and keeps a real city", () => {
    const { duomoBuildListing } = globalThis as ExtractGlobals & {
      duomoBuildListing: (r: Record<string, unknown>[], p: typeof page) => { ok: boolean; listing?: { city: string; district: string | null } };
    };
    const cases: [string, string, string, string | null][] = [
      ["Eichstätt_Kreis", "Kösching", "Kösching", null],
      ["Landkreis Testland", "Testdorf", "Testdorf", null],
      ["Lkr. Testland", "Testdorf", "Testdorf", null],
      ["München", "Schwabing", "München", "Schwabing"],
    ];
    for (const [regio2, regio3, city, district] of cases) {
      const result = duomoBuildListing([{ objregio2: regio2, objregio3: regio3 }], page);
      expect(result.listing).toMatchObject({ city, district });
    }
  });

  it("leaves description and details out when nothing was found, so a partial page never blanks stored text", () => {
    const { duomoBuildListing } = globalThis as ExtractGlobals & {
      duomoBuildListing: (r: Record<string, unknown>[], p: typeof page) => { ok: boolean; listing?: Record<string, unknown> };
    };
    const bare = duomoBuildListing([{ description: "A short meta teaser from a decoy record." }], page).listing as Record<string, unknown>;
    expect("description" in bare).toBe(false);
    expect("details" in bare).toBe(false);
    const full = duomoBuildListing([{ descriptionobject: "The real text." }], { ...page, details: [{ label: "Heizungsart", value: "Gas" }] }).listing as Record<string, unknown>;
    expect(full.description).toMatchObject({ object: "The real text." });
    expect(full.details).toEqual([{ label: "Heizungsart", value: "Gas" }]);
  });
});
