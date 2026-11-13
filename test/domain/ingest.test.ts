import { describe, expect, it } from "vitest";
import { energySourceOf, parseIngest } from "../../src/domain/ingest.js";

describe("parseIngest location", () => {
  it("keeps an in-range point and marks it exact", () => {
    const parsed = parseIngest({
      title: "Altstadt",
      latitude: 48.537,
      longitude: 12.152,
      streetAddress: "Altstadt 1",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.listing.latitude).toBe(48.537);
    expect(parsed.listing.longitude).toBe(12.152);
    expect(parsed.listing.locationPrecision).toBe("exact");
    expect(parsed.listing.street).toBe("Altstadt 1");
  });

  it("drops a point that is missing, out of range, or the 0,0 sentinel", () => {
    for (const coordinates of [
      { latitude: 48.5 },
      { latitude: 91, longitude: 11 },
      { lat: 0, lng: 0 },
    ]) {
      const parsed = parseIngest({ title: "Nowhere", ...coordinates });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.listing.latitude).toBeNull();
      expect(parsed.listing.longitude).toBeNull();
      expect(parsed.listing.locationPrecision).toBeNull();
    }
  });

  it("accepts the geoLat and geoLng aliases", () => {
    const parsed = parseIngest({ title: "Alias", geoLat: "48.37", geoLng: "10.89" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.listing.latitude).toBe(48.37);
    expect(parsed.listing.longitude).toBe(10.89);
  });

  it("does not read a dotted coordinate as a German thousand", () => {
    const parsed = parseIngest({ title: "Dot", latitude: "48.137", longitude: "11.576" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.listing.latitude).toBe(48.137);
    expect(parsed.listing.longitude).toBe(11.576);
    expect(parsed.listing.locationPrecision).toBe("exact");
  });

  it("accepts a comma as the decimal mark on a coordinate", () => {
    const parsed = parseIngest({ title: "Comma", geoLat: "48,137154", geoLng: "11,575382" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.listing.latitude).toBe(48.137154);
    expect(parsed.listing.longitude).toBe(11.575382);
  });

  it("believes only an approximate precision from the client; anything else stays exact", () => {
    const approximate = parseIngest({ title: "Area", latitude: 48.5, longitude: 11.5, locationPrecision: "approximate" });
    const other = parseIngest({ title: "Other", latitude: 48.5, longitude: 11.5, locationPrecision: "city" });
    const absent = parseIngest({ title: "Absent", latitude: 48.5, longitude: 11.5 });
    for (const parsed of [approximate, other, absent]) expect(parsed.ok).toBe(true);
    if (!approximate.ok || !other.ok || !absent.ok) return;
    expect(approximate.listing.locationPrecision).toBe("approximate");
    expect(other.listing.locationPrecision).toBe("exact");
    expect(absent.listing.locationPrecision).toBe("exact");
  });

  it("has no precision without a point, even when the client sends one", () => {
    const parsed = parseIngest({ title: "No point", locationPrecision: "approximate" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.listing.locationPrecision).toBeNull();
  });
});

describe("parseIngest details", () => {
  it("reads the added fields and records which keys the body carried", () => {
    const parsed = parseIngest({
      title: "Details",
      heatingSystem: "Zentralheizung",
      energySource: "Pellet-Heizung",
      parkingSpaces: "2",
      parkingType: "Tiefgarage",
      parkingPriceEur: "10.000 €",
      bathrooms: 2,
      bedrooms: 3,
      availableFrom: "sofort",
      listedAt: "2026-10-30T16:50:15.585Z",
      portalPreviousPriceEur: "329.000 €",
      portalMarketEurPerM2: 3730,
      portalMarketLowEurPerM2: "2.779",
      portalMarketHighEurPerM2: "4.514",
      description: { object: "Helle Wohnung.\r\n\r\n\r\n\r\nRuhig.", location: " Lage " },
      details: [{ label: "Heizungsart", value: "Zentralheizung" }, { label: "", value: "x" }, { label: "y", value: "" }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.listing).toMatchObject({
      heatingSystem: "Zentralheizung",
      energySource: "Pellets",
      parkingSpaces: 2,
      parkingType: "underground",
      parkingPriceEur: 10000,
      bathrooms: 2,
      bedrooms: 3,
      availableFrom: "sofort",
      listedAt: "2026-10-30T16:50:15.585Z",
      portalPreviousPriceEur: 329000,
      portalMarketEurPerM2: 3730,
      portalMarketLowEurPerM2: 2779,
      portalMarketHighEurPerM2: 4514,
      description: { object: "Helle Wohnung.\n\nRuhig.", furnishing: null, location: "Lage", other: null },
      details: [{ label: "Heizungsart", value: "Zentralheizung" }],
    });
    expect(parsed.provided.has("parkingSpaces")).toBe(true);
    expect(parsed.provided.has("bedrooms")).toBe(true);
  });

  it("stores unknown and out-of-range values as null, never as zero", () => {
    const parsed = parseIngest({
      title: "Bad values",
      parkingSpaces: 0,
      parkingPriceEur: 0,
      bathrooms: 1.5,
      bedrooms: 400,
      listedAt: "1970-01-01",
      portalPreviousPriceEur: -5,
      parkingType: "somewhere",
      description: { object: "   " },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.listing).toMatchObject({
      parkingSpaces: null,
      parkingPriceEur: null,
      bathrooms: null,
      bedrooms: null,
      listedAt: null,
      portalPreviousPriceEur: null,
      parkingType: null,
      description: null,
      details: [],
    });
  });

  it("reads only an ISO date as the listing date, and never guesses a dotted or slashed one", () => {
    const read = (value: unknown) => {
      const parsed = parseIngest({ title: "Dated", listedAt: value });
      if (!parsed.ok) throw new Error("not ok");
      return parsed.listing.listedAt;
    };
    expect(read("2026-10-30T16:50:15.585Z")).toBe("2026-10-30T16:50:15.585Z");
    expect(read("2026-10-30")).toBe("2026-10-30T00:00:00.000Z");
    expect(read("05.03.2024")).toBeNull();
    expect(read("03/05/2024")).toBeNull();
    expect(read("yesterday")).toBeNull();
  });

  it("marks nothing as provided for a body from an older extension", () => {
    const parsed = parseIngest({ title: "Old", priceEur: 1 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.provided.size).toBe(0);
  });

  it("never stores a placeholder as a fuel or a heating system", () => {
    for (const placeholder of ["keine Angabe", "no_information", "No information", "n/a"]) {
      expect(energySourceOf(placeholder)).toBeNull();
      const parsed = parseIngest({ title: "Placeholder", heatingSystem: placeholder, energySource: placeholder });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.listing.heatingSystem).toBeNull();
      expect(parsed.listing.energySource).toBeNull();
    }
  });

  it("maps a fuel to one canonical label and keeps an unknown one as published", () => {
    expect(energySourceOf("Pellets")).toBe("Pellets");
    expect(energySourceOf("Luft-Wasser-Wärmepumpe")).toBe("Wärmepumpe");
    expect(energySourceOf("district_heating")).toBe("Fernwärme");
    expect(energySourceOf("Heizöl")).toBe("Öl");
    expect(energySourceOf("oil")).toBe("Öl");
    expect(energySourceOf("boiler")).toBe("boiler");
    expect(energySourceOf("Erdgas")).toBe("Gas");
    expect(energySourceOf("Nachtspeicher")).toBe("Strom");
    expect(energySourceOf("Brennstoffzelle")).toBe("Brennstoffzelle");
    expect(energySourceOf("")).toBeNull();
  });
});
