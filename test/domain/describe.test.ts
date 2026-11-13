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
});
