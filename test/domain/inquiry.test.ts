import { afterEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../../src/domain/analyze.js";
import { describeFindings } from "../../src/domain/describe.js";
import { buildDueDiligenceInquiry, refineInquiryWithLlm } from "../../src/domain/inquiry.js";
import { DEFAULT_ASSUMPTIONS, type ListingInput } from "../../src/domain/types.js";

function sampleBuyListing(overrides: Partial<ListingInput> = {}): ListingInput {
  return {
    source: "immobilienscout24",
    sourceUrl: "https://www.immobilienscout24.de/expose/12345",
    externalId: "12345",
    title: "Altbauwohnung in Schwabing",
    offer: "buy",
    priceEur: 550000,
    livingAreaM2: 82,
    plotAreaM2: null,
    rooms: 3,
    city: "München",
    district: "Schwabing",
    postalCode: "80801",
    state: "BY",
    street: null,
    latitude: null,
    longitude: null,
    locationPrecision: null,
    propertyType: "apartment",
    yearBuilt: 1962,
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
    floor: "3. OG",
    features: [],
    snippet: "",
    leasehold: false,
    groundRentEur: null,
    monument: false,
    tenantOccupied: true,
    heatingSystem: null,
    energySource: null,
    parkingSpaces: null,
    parkingType: null,
    parkingPriceEur: null,
    bathrooms: 1,
    bedrooms: 2,
    availableFrom: null,
    listedAt: null,
    portalPreviousPriceEur: null,
    portalMarketEurPerM2: null,
    portalMarketLowEurPerM2: null,
    portalMarketHighEurPerM2: null,
    description: {
      object: "Schöne 3-Zimmer-Wohnung. Eine Sonderumlage für das Dach wird diskutiert.",
      furnishing: null,
      location: null,
      other: null,
    },
    details: [],
    images: [],
    ...overrides,
  };
}

describe("domain/inquiry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds a deterministic due-diligence checklist and German Makler message for a buy flat with missing data", () => {
    const listing = sampleBuyListing();
    const findings = describeFindings(listing.description, 2026);
    const analysis = analyze(listing, DEFAULT_ASSUMPTIONS, undefined, findings);
    const draft = buildDueDiligenceInquiry({ listing, analysis, findings });

    expect(draft.source).toBe("deterministic");
    const titles = draft.checklist.map((item) => item.title).join(" | ");
    expect(titles).toContain("energy certificate");
    expect(titles).toContain("Condo fee (Hausgeld) & WEG documents");
    expect(titles).toContain("Existing tenancy & cold rent");
    expect(titles).toContain("Special levy");
    expect(draft.messageGerman).toContain("Altbauwohnung in Schwabing");
    expect(draft.messageGerman).toContain("Hausgeld");
    expect(draft.messageGerman).toContain("Energieausweis");
    expect(draft.messageGerman).toContain("Instandhaltungsrücklage");
    expect(draft.messageGerman).toContain("Sonderumlage");
  });

  it("refines an inquiry via LLM when configured", async () => {
    const listing = sampleBuyListing();
    const findings = describeFindings(listing.description, 2026);
    const analysis = analyze(listing, DEFAULT_ASSUMPTIONS, undefined, findings);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  checklist: [
                    {
                      key: "weg_protocols",
                      title: "Request WEG protocols",
                      whyEnglish: "Verify planned roof works and reserve balance.",
                      questionGerman: "Könnten Sie mir bitte die letzten drei WEG-Protokolle zusenden?",
                    },
                  ],
                  messageGerman:
                    "Guten Tag,\n\nich interessiere mich für die Wohnung und bitte um die letzten drei WEG-Protokolle.\n\nMit freundlichen Grüßen",
                }),
              },
            },
          ],
        }),
    } as Response);

    const refined = await refineInquiryWithLlm(
      {
        provider: "openai",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: "",
        model: "qwen2.5:14b",
        autoExtractOnSave: false,
      },
      { listing, analysis, findings },
    );

    expect(refined.source).toBe("llm");
    expect(refined.model).toBe("qwen2.5:14b");
    expect(refined.checklist).toHaveLength(1);
    expect(refined.checklist[0]?.title).toBe("Request WEG protocols");
    expect(refined.messageGerman).toContain("WEG-Protokolle");
  });
});
