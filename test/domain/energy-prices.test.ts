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
 * A GENESIS flat file: semicolon-delimited, German decimal comma, one value per record.
 *
 * The columns are the ones table 61243-0001 really has: the half-year is the first variable, the
 * area the second, the price kind the third and the consumption class the fourth. The class
 * labels are spelled the way Destatis spells them, with a space in the thousands.
 */
const HEADER =
  "statistics_code;statistics_label;time_code;time_label;time;1_variable_code;1_variable_label;1_variable_attribute_code;1_variable_attribute_label;2_variable_code;2_variable_label;2_variable_attribute_code;2_variable_attribute_label;3_variable_code;3_variable_label;3_variable_attribute_code;3_variable_attribute_label;4_variable_code;4_variable_label;4_variable_attribute_code;4_variable_attribute_label;value;value_unit;value_variable_code;value_variable_label";

const CSV = `${HEADER}
61243;Durchschnittspreise für Strom und Gas;JAHR;Jahr;2026;HALBJA;Halbjahre;HALBJH1;1. Halbjahr;DINSG;Deutschland insgesamt;DG;Deutschland;PREAT1;Preisarten;PRE-BRUTTO;Durchschnittspreise inkl. Steuern, Abgaben, Umlagen;VBRST1;Strom-Jahresverbrauchsklassen Haushalte;HH-STR-DC;2 500 bis unter 5 000 KWh;0,3618;EUR/kWh;PRE060;Strompreise für Haushalte
61243;Durchschnittspreise für Strom und Gas;JAHR;Jahr;2026;HALBJA;Halbjahre;HALBJH1;1. Halbjahr;DINSG;Deutschland insgesamt;DG;Deutschland;PREAT1;Preisarten;PRE-NETTO-02;Durchschnittspreise ohne Umsatzsteuer u.a. abz.St.;VBRST1;Strom-Jahresverbrauchsklassen Haushalte;HH-STR-DC;2 500 bis unter 5 000 KWh;0,2598;EUR/kWh;PRE060;Strompreise für Haushalte
61243;Durchschnittspreise für Strom und Gas;JAHR;Jahr;2026;HALBJA;Halbjahre;HALBJH2;2. Halbjahr;DINSG;Deutschland insgesamt;DG;Deutschland;PREAT1;Preisarten;PRE-BRUTTO;Durchschnittspreise inkl. Steuern, Abgaben, Umlagen;VBRST1;Strom-Jahresverbrauchsklassen Haushalte;HH-STR-DC;2 500 bis unter 5 000 KWh;...;EUR/kWh;PRE060;Strompreise für Haushalte
61243;Durchschnittspreise für Strom und Gas;JAHR;Jahr;2025;HALBJA;Halbjahre;HALBJH2;2. Halbjahr;DINSG;Deutschland insgesamt;DG;Deutschland;PREAT1;Preisarten;PRE-BRUTTO;Durchschnittspreise inkl. Steuern, Abgaben, Umlagen;VBRST1;Strom-Jahresverbrauchsklassen Haushalte;HH-STR-DC;2 500 bis unter 5 000 KWh;0,3901;EUR/kWh;PRE060;Strompreise für Haushalte
`;

/** The gas table, with the class label Destatis spells it. */
const GAS_CSV = `${HEADER}
61243;Durchschnittspreise für Strom und Gas;JAHR;Jahr;2026;HALBJA;Halbjahre;HALBJH1;1. Halbjahr;DINSG;Deutschland insgesamt;DG;Deutschland;PREAT1;Preisarten;PRE-BRUTTO;Durchschnittspreise inkl. Steuern, Abgaben, Umlagen;VBRGAS1;Erdgas-Jahresverbrauchsklassen Haushalte;HH-GAS-B;5 600 bis unter 55 600 KWh;0,1158;EUR/kWh;PRE060;Erdgaspreise für Haushalte
`;

describe("parseGenesisCsv", () => {
  it("reads the header and the records", () => {
    const rows = parseGenesisCsv(CSV);
    expect(rows.length).toBe(5);
    expect(rows[0]?.[0]).toBe("statistics_code");
    expect(rows[1]?.[0]).toBe("61243");
  });

  it("keeps a quoted field with a comma in it", () => {
    const rows = parseGenesisCsv(CSV);
    expect(rows[1]?.[16]).toBe("Durchschnittspreise inkl. Steuern, Abgaben, Umlagen");
  });
});

describe("findGenesisPrice", () => {
  it("finds the price of a consumption class, including taxes", () => {
    const rows = parseGenesisCsv(CSV);
    // The newest half-year is published without a figure yet, so the latest priced one is used.
    expect(findGenesisPrice(rows, ELECTRICITY_CLASS)?.value).toBe(0.3618);
  });

  it("finds the gas price for the class Destatis publishes", () => {
    const rows = parseGenesisCsv(GAS_CSV);
    expect(findGenesisPrice(rows, GAS_CLASS)?.value).toBe(0.1158);
  });

  it("matches the class label however Destatis spaces it", () => {
    const rows = parseGenesisCsv(CSV);
    // The publisher writes "2 500 bis unter 5 000 KWh"; the class is the same one.
    expect(findGenesisPrice(rows, "2500 bis unter 5000 KWh")?.value).toBe(0.3618);
    expect(findGenesisPrice(rows, "2 500 bis unter 5 000 KWh")?.value).toBe(0.3618);
  });

  it("says which period the price belongs to", () => {
    const rows = parseGenesisCsv(CSV);
    // The second half of 2026 has no figure yet, so the first half is the newest priced one.
    expect(findGenesisPrice(rows, ELECTRICITY_CLASS)?.period).toBe("2026-H1");
  });

  it("ignores the price without taxes", () => {
    const rows = parseGenesisCsv(CSV);
    // The row without VAT carries a figure for the same class, and it is not read.
    expect(findGenesisPrice(rows, ELECTRICITY_CLASS)?.value).not.toBe(0.2598);
  });

  it("has no price for a class the table does not carry", () => {
    const rows = parseGenesisCsv(CSV);
    expect(findGenesisPrice(rows, "9999 bis unter 1 KWh")).toBeNull();
  });

  it("skips a placeholder", () => {
    // A table whose only tax-inclusive row for the class carries no figure yet.
    const only = parseGenesisCsv(
      `${HEADER}\n61243;x;JAHR;Jahr;2026;HALBJA;Halbjahre;HALBJH1;1. Halbjahr;DINSG;Deutschland insgesamt;DG;Deutschland;PREAT1;Preisarten;PRE-BRUTTO;Durchschnittspreise inkl. Steuern, Abgaben, Umlagen;VBRST1;Strom-Jahresverbrauchsklassen Haushalte;HH-STR-DC;2 500 bis unter 5 000 KWh;...;EUR/kWh;PRE060;Strompreise für Haushalte\n`,
    );
    expect(findGenesisPrice(only, ELECTRICITY_CLASS)).toBeNull();
  });

  it("has no price for a table without the expected columns", () => {
    expect(findGenesisPrice(parseGenesisCsv("a;b\n1;2\n"), ELECTRICITY_CLASS)).toBeNull();
  });

  it("takes the price from the newest period that has one", () => {
    const rows = parseGenesisCsv(CSV);
    const price = findGenesisPrice(rows, ELECTRICITY_CLASS);
    expect(price?.value).toBe(0.3618);
    expect(price?.period).toBe("2026-H1");
  });
});

describe("findGenesisPeriod", () => {
  it("reads the year and the half-year of the newest record", () => {
    const rows = parseGenesisCsv(CSV);
    expect(findGenesisPeriod(rows)).toBe("2026-H2");
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
