import { describe, expect, it } from "vitest";
import { describeFindings } from "../../src/domain/describe.js";

const text = (object: string | null, other: string | null = null) => ({ object, furnishing: null, location: null, other });
const keys = (object: string | null, other: string | null = null) => describeFindings(text(object, other), 2026).items.map((item) => item.key);

describe("describeFindings", () => {
  it("returns nothing without a description", () => {
    expect(describeFindings(null)).toEqual({ items: [], renovatedYear: null, heatingReplacedYear: null });
    expect(describeFindings(text(null)).items).toEqual([]);
  });

  it("reads the renovation year and the heating renewal year as separate facts", () => {
    const found = describeFindings(
      text(
        "Das Gebäude wurde ca. im Jahr 1978 als Einfamilienhaus erbaut. Ca. im Jahr 2001 wurde die Zentralheizung des Hauses mit einer Pellet-Zentralheizung erneuert. Die Wohnung wurde ca. im Jahr 2015 renoviert.",
      ),
      2026,
    );
    expect(found.heatingReplacedYear).toBe(2001);
    expect(found.renovatedYear).toBe(2015);
    expect(found.items.find((item) => item.key === "heating_replaced")?.snippet).toContain("Pellet-Zentralheizung");
    expect(found.items.find((item) => item.key === "renovated")?.label).toBe("Renovated 2015");
  });

  it("reads 'renoviert ca. 2015' with the year after the verb, and ignores a future year", () => {
    expect(describeFindings(text("- renoviert ca. 2015"), 2026).renovatedYear).toBe(2015);
    expect(describeFindings(text("Die Fassade wird 2031 saniert."), 2026).renovatedYear).toBeNull();
  });

  it("finds heat pump, underfloor heating, full refurbishment and the KfW standard", () => {
    expect(keys("Kernsanierung auf KfW-55-Standard.", "Wärmepumpe, Fußbodenheizung")).toEqual([
      "full_refurbishment",
      "kfw_standard",
      "heat_pump",
      "underfloor_heating",
    ]);
    const kfw = describeFindings(text("Energieeffizienter KfW-Effizienzhaus 40 Neubau."), 2026).items[0];
    expect(kfw?.label).toBe("KfW 40 standard");
  });

  it("never reports a negated fact", () => {
    expect(keys("Es gibt keine Sonderumlage. Die Wohnung ist nicht vermietet. Kein Erbbaurecht. Ohne Denkmalschutz.")).toEqual([]);
    expect(keys("Eine Sonderumlage wurde beschlossen. Die Wohnung ist vermietet. Erbbaurecht bis 2090. Denkmalschutz liegt vor.")).toEqual([
      "special_levy",
      "rented",
      "leasehold",
      "monument",
    ]);
  });

  it("reads a maintenance reserve amount in German format", () => {
    const item = describeFindings(text("Die Instandhaltungsrücklage beträgt derzeit 45.300,50 EUR."), 2026).items[0];
    expect(item?.key).toBe("maintenance_reserve");
    expect(item?.amountEur).toBe(45300.5);
    expect(describeFindings(text("Instandhaltungsrücklage vorhanden."), 2026).items).toEqual([]);
  });

  it("pairs a year with the verb in its own clause, not with a build year or a tenancy year", () => {
    expect(describeFindings(text("Baujahr 1965, Bad 2015 saniert."), 2026).renovatedYear).toBe(2015);
    expect(describeFindings(text("Baujahr 1970, Heizung 2010 erneuert."), 2026)).toMatchObject({ renovatedYear: null, heatingReplacedYear: 2010 });
    expect(describeFindings(text("Die Wohnung ist saniert und seit 2021 vermietet."), 2026).renovatedYear).toBeNull();
    expect(describeFindings(text("Das Bad wurde 2019 modernisiert, Heizung Gas."), 2026)).toMatchObject({ renovatedYear: 2019, heatingReplacedYear: null });
  });

  it("does not read a street, a spa or a long number as heating or a year", () => {
    const found = describeFindings(text("Nähe Therme und Brenner Straße, Fenster erneuert 2020."), 2026);
    expect(found.heatingReplacedYear).toBeNull();
    expect(found.renovatedYear).toBe(2020);
    expect(describeFindings(text("Bad erneuert für 20.000 EUR."), 2026).renovatedYear).toBeNull();
  });

  it("keeps the heating label and the year it reports in step", () => {
    const found = describeFindings(text("Heizung erneuert 2005. Zweite Anlage: Heizkessel ausgetauscht 2018."), 2026);
    expect(found.heatingReplacedYear).toBe(2018);
    expect(found.items.find((item) => item.key === "heating_replaced")).toMatchObject({ label: "Heating renewed 2018", year: 2018 });
  });

  it("does not report a possibility or a plan as a fact, but still reports a risk", () => {
    expect(keys("Für den Einbau einer Wärmepumpe geeignet. Fußbodenheizung nachrüstbar. Kernsanierung geplant.")).toEqual([]);
    expect(keys("Eine Sonderumlage ist möglich.")).toEqual(["special_levy"]);
  });

  it("reads a KfW standard but not a KfW amount", () => {
    expect(keys("KfW-Darlehen bis zu KfW 100.000 € möglich.")).toEqual([]);
    expect(keys("Förderfähig als KfW 55.")).toEqual(["kfw_standard"]);
  });

  it("reads a reserve written with ca., and rejects a per-area or monthly figure and a tiny one", () => {
    const item = describeFindings(text("Instandhaltungsrücklage von ca. 45.000 € vorhanden."), 2026).items[0];
    expect(item).toMatchObject({ key: "maintenance_reserve", amountEur: 45000 });
    expect(keys("Die Instandhaltungsrücklage beträgt 1,20 € pro m² im Jahr.")).toEqual([]);
    expect(keys("Instandhaltungsrücklage: monatlich 30 € Zuführung.")).toEqual([]);
    expect(keys("Instandhaltungsrücklage 120 € vorhanden.")).toEqual([]);
  });
});
