import { beforeAll, describe, expect, it } from "vitest";

type ExtractGlobals = typeof globalThis & {
  duomoParseCoordinate: (value: unknown) => number | null;
  duomoJoinStreet: (streetName: unknown, houseNumber: unknown) => string | null;
  duomoBuildListing: (
    records: Record<string, unknown>[],
    page: { href: string; title: string; text: string },
  ) =>
    | { ok: true; listing: { latitude: number | null; longitude: number | null; street: string | null } }
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
});
