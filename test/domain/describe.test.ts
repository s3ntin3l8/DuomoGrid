import { describe, expect, it, vi } from "vitest";
import {
  describeFindings,
  descriptionDigest,
  extractDescriptionWithLlm,
  mergeExtractedFacts,
  sanitizeExtractedFacts,
} from "../../src/domain/describe.js";
import type { ListingInput } from "../../src/domain/types.js";

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

  it("extracts structured facts via LLM and merges only missing listing fields without overwriting existing ones", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    { key: "heat_pump", label: "Heat pump", snippet: "Neue Luft-Wasser-Wärmepumpe eingebaut." },
                    { key: "maintenance_reserve", label: "Maintenance reserve 62,000 €", snippet: "Rücklage 62.000 €", amountEur: 62000 },
                  ],
                  facts: {
                    yearRefurbished: 2021,
                    heatingReplacedYear: 2022,
                    condoFeeEur: 340,
                    energySource: "Wärmepumpe",
                    heatingSystem: "Fußbodenheizung",
                    leasehold: true,
                    groundRentEur: 180,
                    monument: false,
                    tenantOccupied: true,
                    coldRentEur: 1150,
                  },
                }),
              },
            },
          ],
        }),
    } as Response);

    const desc = text("Neue Luft-Wasser-Wärmepumpe 2022 eingebaut. Hausgeld 340 EUR, Rücklage 62.000 €, Erbpacht 180 €/Monat, vermietet für 1.150 € kalt.");
    const extracted = await extractDescriptionWithLlm(
      {
        provider: "openai",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: "",
        model: "qwen2.5:14b",
        autoExtractOnSave: true,
      },
      desc,
      [],
      JSON.stringify(desc),
      2026,
    );

    expect(extracted.descriptionHash).toBe(descriptionDigest(JSON.stringify(desc)));
    expect(extracted.model).toBe("qwen2.5:14b");
    expect(extracted.extractedFacts.condoFeeEur).toBe(340);
    expect(extracted.extractedFacts.leasehold).toBe(true);
    expect(extracted.extractedFacts.groundRentEur).toBe(180);
    expect(extracted.extractedFacts.tenantOccupied).toBe(true);
    expect(extracted.extractedFacts.coldRentEur).toBe(1150);

    const baseListing: ListingInput = {
      source: "manual",
      sourceUrl: "",
      externalId: null,
      title: "ETW München",
      offer: "buy",
      priceEur: 480000,
      livingAreaM2: 78,
      plotAreaM2: null,
      rooms: 3,
      city: "München",
      district: null,
      postalCode: "80331",
      state: "BY",
      street: null,
      latitude: null,
      longitude: null,
      locationPrecision: null,
      propertyType: "apartment",
      yearBuilt: 1972,
      yearRefurbished: null,
      energyClass: null,
      energyKwh: null,
      energyCert: null,
      heating: null,
      condoFeeEur: null,
      coldRentEur: null,
      warmRentEur: null,
      depositEur: null,
      rentContract: null,
      commissionPercent: 3.57,
      commissionText: null,
      condition: null,
      floor: null,
      features: [],
      snippet: "",
      leasehold: false,
      groundRentEur: null,
      monument: false,
      tenantOccupied: false,
      heatingSystem: null,
      energySource: "Gas", // already set -> must NOT be overwritten
      parkingSpaces: null,
      parkingType: null,
      parkingPriceEur: null,
      bathrooms: null,
      bedrooms: null,
      availableFrom: null,
      listedAt: null,
      portalPreviousPriceEur: null,
      portalMarketEurPerM2: null,
      portalMarketLowEurPerM2: null,
      portalMarketHighEurPerM2: null,
      description: desc,
      details: [],
      images: [],
    };

    const merged = mergeExtractedFacts(baseListing, extracted);
    // Stored energySource ("Gas") is preserved, never overwritten by LLM ("Wärmepumpe")
    expect(merged.analysed.energySource).toBe("Gas");
    expect(merged.filledFields).not.toContain("energySource");
    // Missing fields are filled
    expect(merged.analysed.condoFeeEur).toBe(340);
    expect(merged.analysed.yearRefurbished).toBe(2021);
    expect(merged.analysed.heatingSystem).toBe("Fußbodenheizung");
    expect(merged.analysed.leasehold).toBe(true);
    expect(merged.analysed.groundRentEur).toBe(180);
    expect(merged.analysed.tenantOccupied).toBe(true);
    expect(merged.analysed.coldRentEur).toBe(1150);
    expect(merged.filledFields).toEqual(
      expect.arrayContaining([
        "condoFeeEur",
        "yearRefurbished",
        "heatingSystem",
        "leasehold",
        "groundRentEur",
        "tenantOccupied",
        "coldRentEur",
      ]),
    );
    vi.restoreAllMocks();
  });

  it("sanitizes out-of-range LLM facts safely", () => {
    const clean = sanitizeExtractedFacts(
      {
        yearRefurbished: 2099,
        heatingReplacedYear: 2019,
        condoFeeEur: -50,
        energySource: "Wärmepumpe",
      },
      2026,
    );
    expect(clean.yearRefurbished).toBeNull();
    expect(clean.heatingReplacedYear).toBe(2019);
    expect(clean.condoFeeEur).toBeNull();
    expect(clean.energySource).toBe("Wärmepumpe");
  });
});
