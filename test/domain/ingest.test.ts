import { describe, expect, it } from "vitest";
import { parseIngest } from "../../src/domain/ingest.js";

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
