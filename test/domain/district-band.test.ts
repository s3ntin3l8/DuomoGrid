import { describe, expect, it } from "vitest";
import { loadDistrictBands, matchDistrictBand, parseDistrictBands } from "../../src/domain/district-band.js";

const FIXTURE = `
;Subkr_ID;Subkr_Name_kurz;BERJ;B_Land_Name;Abb_4_55;Abb_4_92
;1;München;2023;Bayern;old house;old apt
;1;München;2024;Bayern;3500 und mehr;3250 und mehr
;2;München, Ldkr.;2024;Bayern;3500 und mehr;3000 bis unter 3500
;3;Landshut, Ldkr.;2024;Bayern;3500 und mehr;2750 bis unter 3250
;4;Darmstadt;2024;Hessen;3500 und mehr;3250 und mehr
;5;Leer;2024;Niedersachsen;NA;NA
`;

const rows = parseDistrictBands(FIXTURE.trim());

describe("district sale band", () => {
  it("uses the latest year and the city, not the surrounding Landkreis", () => {
    expect(matchDistrictBand(rows, { offer: "buy", propertyType: "apartment", city: "München", district: "Altstadt", state: "BY" })).toEqual({
      name: "München",
      stateName: "Bayern",
      year: 2024,
      band: "3250 und mehr",
      kind: "apartment",
    });
    expect(matchDistrictBand(rows, { offer: "buy", propertyType: "house", city: "München", district: null, state: "BY" })?.band).toBe("3500 und mehr");
  });

  it("falls back to the district name and refuses a neighbouring state", () => {
    expect(matchDistrictBand(rows, { offer: "buy", propertyType: "apartment", city: "Ergolding", district: "Landshut, Ldkr.", state: "BY" })?.band).toBe("2750 bis unter 3250");
    expect(matchDistrictBand(rows, { offer: "buy", propertyType: "apartment", city: "München", district: null, state: "HE" })).toBeNull();
    expect(matchDistrictBand(rows, { offer: "buy", propertyType: "apartment", city: "No such place", district: "Also missing", state: "BY" })).toBeNull();
  });

  it("shows nothing for a rental, another property type, or an unpublished band", () => {
    expect(matchDistrictBand(rows, { offer: "rent", propertyType: "apartment", city: "München", district: null, state: "BY" })).toBeNull();
    expect(matchDistrictBand(rows, { offer: "buy", propertyType: "multi", city: "München", district: null, state: "BY" })).toBeNull();
    expect(matchDistrictBand(rows, { offer: "buy", propertyType: "land", city: "München", district: null, state: "BY" })).toBeNull();
    expect(matchDistrictBand(rows, { offer: "buy", propertyType: "apartment", city: "Leer", district: null, state: "NI" })).toBeNull();
  });

  it("reads the vendored 2025 file and ignores a missing file", () => {
    const published = loadDistrictBands();
    expect(matchDistrictBand(published, { offer: "buy", propertyType: "apartment", city: "München", district: null, state: "BY" })).toMatchObject({
      name: "München",
      year: 2024,
      band: "3250 und mehr",
      kind: "apartment",
    });
    expect(matchDistrictBand(published, { offer: "buy", propertyType: "house", city: "München", district: null, state: "BY" })?.band).toBe("3500 und mehr");
    expect(loadDistrictBands("/tmp/duomo-no-such-akoga.csv")).toEqual([]);
  });
});
