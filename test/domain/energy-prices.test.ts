import { describe, expect, it } from "vitest";
import {
  ELECTRICITY_CLASS,
  GAS_CLASS,
  energyRatesFrom,
  findGenesisPeriod,
  findGenesisPrice,
  parseGenesisCsv,
} from "../../src/domain/energy-prices.js";

/**
 * A GENESIS flat file: semicolon-delimited, German decimal comma, one value per record. The
 * variables sit in labelled columns. The class labels are spelled the way Destatis spells them,
 * with a space in the thousands.
 */
const CSV = `statistics_label;time;1_variable_attribute_code;1_variable_attribute_label;2_variable_attribute_code;2_variable_attribute_label;3_variable_attribute_code;3_variable_attribute_label;value
Verbraucherpreisindex;2024;1H1;1. Halbjahr;PREIS1;Durchschnittspreise ohne Steuern, Abgaben, Umlagen;KG1;unter 1 000 KWh;0,3010
Verbraucherpreisindex;2024;1H1;1. Halbjahr;PREIS1;Durchschnittspreise ohne Steuern, Abgaben, Umlagen;KG2;2 500 bis unter 5 000 KWh;0,2598
Verbraucherpreisindex;2024;1H1;1. Halbjahr;PREIS3;Durchschnittspreise inkl. Steuern, Abgaben, Umlagen;KG1;unter 1 000 KWh;0,4347
Verbraucherpreisindex;2024;1H1;1. Halbjahr;PREIS3;Durchschnittspreise inkl. Steuern, Abgaben, Umlagen;KG2;2 500 bis unter 5 000 KWh;0,3835
Verbraucherpreisindex;2025;2H2;2. Halbjahr;PREIS3;Durchschnittspreise inkl. Steuern, Abgaben, Umlagen;KG2;2 500 bis unter 5 000 KWh;0,3901
`;

/** The gas table, with the class label Destatis spells it. */
const GAS_CSV = `statistics_label;time;1_variable_attribute_code;1_variable_attribute_label;2_variable_attribute_code;2_variable_attribute_label;3_variable_attribute_code;3_variable_attribute_label;value
Erdgaspreis;2026;1H1;1. Halbjahr;PREIS3;Durchschnittspreise inkl. Steuern, Abgaben, Umlagen;KG2;5 600 bis unter 55 600 KWh;0,1158
`;

describe("parseGenesisCsv", () => {
  it("reads the header and the records", () => {
    const rows = parseGenesisCsv(CSV);
    expect(rows.length).toBe(6);
    expect(rows[0]?.[0]).toBe("statistics_label");
    expect(rows[1]?.[0]).toBe("Verbraucherpreisindex");
  });

  it("keeps a quoted field with a comma in it", () => {
    const rows = parseGenesisCsv(CSV);
    expect(rows[1]?.[5]).toBe("Durchschnittspreise ohne Steuern, Abgaben, Umlagen");
  });
});

describe("findGenesisPrice", () => {
  it("finds the price of a consumption class, including taxes", () => {
    const rows = parseGenesisCsv(CSV);
    expect(findGenesisPrice(rows, ELECTRICITY_CLASS)?.value).toBe(0.3901);
  });

  it("finds the gas price for the class Destatis publishes", () => {
    const rows = parseGenesisCsv(GAS_CSV);
    expect(findGenesisPrice(rows, GAS_CLASS)?.value).toBe(0.1158);
  });

  it("matches the class label however Destatis spaces it", () => {
    const rows = parseGenesisCsv(CSV);
    // The publisher writes "2 500 bis unter 5 000 KWh"; the class is the same one.
    expect(findGenesisPrice(rows, "2500 bis unter 5000 KWh")?.value).toBe(0.3901);
    expect(findGenesisPrice(rows, "2 500 bis unter 5 000 KWh")?.value).toBe(0.3901);
  });

  it("says which period the price belongs to", () => {
    const rows = parseGenesisCsv(CSV);
    expect(findGenesisPrice(rows, ELECTRICITY_CLASS)?.period).toBe("2025-H2");
  });

  it("ignores the price without taxes", () => {
    const rows = parseGenesisCsv(CSV);
    // Only the 2024 row without taxes carries this class at this value, and it is not read.
    expect(findGenesisPrice(rows, "unter 1 000 KWh")?.value).toBe(0.4347);
  });

  it("has no price for a class the table does not carry", () => {
    const rows = parseGenesisCsv(CSV);
    expect(findGenesisPrice(rows, "9999 bis unter 1 KWh")).toBeNull();
  });

  it("skips a placeholder", () => {
    const rows = parseGenesisCsv(
      "time;1_variable_attribute_label;2_variable_attribute_label;3_variable_attribute_label;value\n2026;1. Halbjahr;Durchschnittspreise inkl. Steuern, Abgaben, Umlagen;2 500 bis unter 5 000 KWh;...\n",
    );
    expect(findGenesisPrice(rows, ELECTRICITY_CLASS)).toBeNull();
  });

  it("has no price for a table without the expected columns", () => {
    expect(findGenesisPrice(parseGenesisCsv("a;b\n1;2\n"), ELECTRICITY_CLASS)).toBeNull();
  });

  it("takes the price from the newest period, not from the last row", () => {
    // The last row is a later period that carries no figure yet.
    const rows = parseGenesisCsv(
      "time;1_variable_attribute_label;2_variable_attribute_label;3_variable_attribute_label;value\n2025;1. Halbjahr;Durchschnittspreise inkl. Steuern, Abgaben, Umlagen;2 500 bis unter 5 000 KWh;0,31\n2025;2. Halbjahr;Durchschnittspreise inkl. Steuern, Abgaben, Umlagen;2 500 bis unter 5 000 KWh;...\n",
    );
    const price = findGenesisPrice(rows, ELECTRICITY_CLASS);
    expect(price?.value).toBe(0.31);
    expect(price?.period).toBe("2025-H1");
  });
});

describe("findGenesisPeriod", () => {
  it("reads the year and the half-year of the newest record", () => {
    const rows = parseGenesisCsv(CSV);
    expect(findGenesisPeriod(rows)).toBe("2025-H2");
  });

  it("has no period for a table without one", () => {
    expect(findGenesisPeriod(parseGenesisCsv("a;b\n1;2\n"))).toBe("");
  });
});

describe("energyRatesFrom", () => {
  it("has no rates without prices", () => {
    expect(energyRatesFrom(null)).toBeNull();
    expect(
      energyRatesFrom({
        asOf: "",
        electricityEurPerKwh: null,
        electricityAsOf: "",
        gasEurPerKwh: null,
        gasAsOf: "",
        source: "",
        fetchedAt: "",
      }),
    ).toBeNull();
  });

  it("keeps each price with the period it belongs to", () => {
    const rates = energyRatesFrom({
      asOf: "2026-H1",
      electricityEurPerKwh: 0.3797,
      electricityAsOf: "2026-H1",
      gasEurPerKwh: 0.1158,
      gasAsOf: "2025-H2",
      source: "",
      fetchedAt: "",
    });
    expect(rates?.electric).toBe(0.3797);
    expect(rates?.gas).toBe(0.1158);
    expect(rates?.electricAsOf).toBe("2026-H1");
    expect(rates?.gasAsOf).toBe("2025-H2");
  });

  it("leaves a fuel without a published price null rather than zero", () => {
    const rates = energyRatesFrom({
      asOf: "2026-H1",
      electricityEurPerKwh: null,
      electricityAsOf: "",
      gasEurPerKwh: 0.1158,
      gasAsOf: "2026-H1",
      source: "",
      fetchedAt: "",
    });
    expect(rates?.electric).toBeNull();
    expect(rates?.gas).toBe(0.1158);
  });
});
