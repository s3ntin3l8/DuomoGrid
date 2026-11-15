import { completeJson, isAiConfigured, type AiSettings } from "./ai.js";
import type { Analysis } from "./analyze.js";
import type { DescriptionFindings } from "./describe.js";
import type { ListingInput } from "./types.js";

export type InquiryItem = {
  key: string;
  title: string;
  whyEnglish: string;
  questionGerman: string;
};

export type DueDiligenceInquiry = {
  checklist: InquiryItem[];
  messageGerman: string;
  source: "deterministic" | "llm";
  model?: string | null;
};

export function buildDueDiligenceInquiry(opts: {
  listing: ListingInput;
  analysis: Analysis;
  findings?: DescriptionFindings | null;
}): DueDiligenceInquiry {
  const { listing, analysis, findings } = opts;
  const buy = listing.offer === "buy";
  const checklist: InquiryItem[] = [];
  const findingKeys = new Set((findings?.items ?? []).map((item) => item.key));

  if (listing.propertyType !== "land" && !listing.energyClass && listing.energyKwh == null) {
    checklist.push({
      key: "energy_certificate",
      title: "Missing energy certificate",
      whyEnglish:
        "Neither an energy efficiency class nor a final energy figure (kWh/m²·a) is stated, so heating costs and efficiency are unknown.",
      questionGerman:
        "Könnten Sie mir bitte den aktuellen Energieausweis vorab zur Verfügung stellen?",
    });
  }

  if (
    buy &&
    listing.propertyType !== "land" &&
    (!listing.energySource ||
      findings?.heatingReplacedYear == null ||
      analysis.flags.some((flag) =>
        flag.title.includes("heating") || flag.title.includes("Fossil"),
      ))
  ) {
    checklist.push({
      key: "heating_age",
      title: "Heating system & boiler age",
      whyEnglish:
        "The installation year and fuel of the heating system determine running costs and potential replacement obligations under the German Building Energy Act (GEG).",
      questionGerman:
        "Aus welchem Baujahr stammt die Heizungsanlage bzw. der Wärmeerzeuger, und sind hier in den nächsten Jahren Modernisierungen geplant?",
    });
  }

  if (buy && listing.propertyType === "apartment") {
    if (listing.condoFeeEur == null) {
      checklist.push({
        key: "condo_fee_and_weg",
        title: "Condo fee (Hausgeld) & WEG documents",
        whyEnglish:
          "The monthly Hausgeld is missing, so the monthly carrying cost cannot be completed. You also need the reserve and owners' meeting minutes.",
        questionGerman:
          "Wie hoch ist das aktuelle monatliche Hausgeld (aufgeteilt in umlagefähige und nicht umlagefähige Kosten sowie Zuführung zur Instandhaltungsrücklage), und könnten Sie mir den aktuellen Wirtschaftsplan sowie die letzten drei Eigentümerversammlungsprotokolle zusenden?",
      });
    } else {
      checklist.push({
        key: "weg_reserve_and_minutes",
        title: "Maintenance reserve & WEG minutes",
        whyEnglish:
          "Before buying an apartment, check the maintenance reserve (Instandhaltungsrücklage) and recent owners' resolutions for planned works.",
        questionGerman:
          "Wie hoch ist der aktuelle Stand der Instandhaltungsrücklage (Gesamthaus und Anteil der Wohnung), und könnten Sie mir den Wirtschaftsplan sowie die Protokolle der letzten drei Eigentümerversammlungen zusenden?",
      });
    }
  }

  if (buy && findingKeys.has("special_levy")) {
    checklist.push({
      key: "special_levy",
      title: "Special levy (Sonderumlage)",
      whyEnglish:
        "The description mentions a special levy. Clarify the exact amount and whether the seller pays it before handover.",
      questionGerman:
        "Im Exposé wird eine Sonderumlage erwähnt: In welcher Höhe fällt diese an, wofür wurde sie beschlossen, und wird sie noch vollständig vom Verkäufer getragen?",
    });
  }

  if (buy && (listing.leasehold || findingKeys.has("leasehold"))) {
    checklist.push({
      key: "leasehold_terms",
      title: "Leasehold (Erbbaurecht) contract terms",
      whyEnglish:
        "Leasehold affects both financing and resale. You need the remaining contract term, exact ground rent (Erbbauzins), and indexation clauses.",
      questionGerman:
        "Wie lang ist die Restlaufzeit des Erbbaurechtsvertrags, wie hoch ist der aktuelle Erbbauzins (inkl. eventueller Wertsicherungsklauseln), und wie sind die Vorgaben des Erbbaurechtsgebers zur Belastungsgenehmigung?",
    });
  }

  if (buy && (listing.tenantOccupied || findingKeys.has("rented"))) {
    checklist.push({
      key: "tenancy_details",
      title: "Existing tenancy & cold rent",
      whyEnglish:
        "The property is rented out. You need the current net cold rent, contract start date (for notice periods), and rent adjustment history.",
      questionGerman:
        "Seit wann besteht das aktuelle Mietverhältnis, wie hoch ist die derzeitige Nettokaltmiete, und wann erfolgte die letzte Mietanpassung?",
    });
  }

  if (
    buy &&
    listing.propertyType !== "land" &&
    (listing.yearBuilt == null || (listing.yearBuilt < 1990 && listing.yearRefurbished == null))
  ) {
    checklist.push({
      key: "refurbishment_history",
      title: "Modernization & refurbishment history",
      whyEnglish:
        "For older buildings without a stated refurbishment year, check when roof, windows, facade, pipes, and electrics were last renewed.",
      questionGerman:
        "Welche größeren Sanierungs- oder Modernisierungsmaßnahmen (z. B. Dach, Fassade, Fenster, Steigleitungen, Elektrik, Bäder) wurden in welchen Jahren durchgeführt?",
    });
  }

  if (!buy) {
    if (listing.warmRentEur == null) {
      checklist.push({
        key: "warm_rent_breakdown",
        title: "Warm rent & utility costs",
        whyEnglish:
          "Only the cold rent is stated. Clarify the monthly utility prepayment (Nebenkosten) and whether heating is included.",
        questionGerman:
          "Wie hoch sind die monatlichen Nebenkostenvorauszahlungen, und sind die Heizkosten darin bereits enthalten?",
      });
    }
    if (!listing.rentContract) {
      checklist.push({
        key: "rent_contract_type",
        title: "Lease type & minimum term",
        whyEnglish:
          "Clarify whether the lease uses a stepped rent (Staffelmiete), indexation (Indexmiete), or a minimum rental period.",
        questionGerman:
          "Handelt es sich um einen unbefristeten Standardmietvertrag oder ist eine Index-/Staffelmiete bzw. eine Mindestmietdauer vorgesehen?",
      });
    }
  }

  if (checklist.length === 0) {
    checklist.push({
      key: "viewing_and_documents",
      title: "Documents & viewing appointment",
      whyEnglish:
        "Core figures are present. Request the full exposé documents and propose a viewing.",
      questionGerman:
        buy
          ? "Könnten Sie mir bitte die weiteren Objektunterlagen (Grundrisse, Flurkarte, Energieausweis) zusenden und mir mögliche Termine für eine Besichtigung nennen?"
          : "Ab wann ist ein Einzug möglich, und welche Termine können Sie mir für eine Besichtigung anbieten?",
    });
  }

  const placePart = listing.city ? ` in ${listing.city}` : "";
  const idPart = listing.externalId ? ` (Objekt-Nr. ${listing.externalId})` : "";
  const numbered = checklist
    .map((item, idx) => `${idx + 1}. ${item.questionGerman}`)
    .join("\n");

  const messageGerman = [
    "Sehr geehrte Damen und Herren,",
    "",
    `vielen Dank für das Angebot „${listing.title}“${placePart}${idPart}. Ich interessiere mich sehr für die Immobilie und hätte vorab noch folgende Fragen:`,
    "",
    numbered,
    "",
    "Über Ihre Rückmeldung und einen Vorschlag für einen Besichtigungstermin freue ich mich.",
    "",
    "Mit freundlichen Grüßen",
  ].join("\n");

  return {
    checklist,
    messageGerman,
    source: "deterministic",
    model: null,
  };
}

export async function refineInquiryWithLlm(
  settings: AiSettings,
  opts: {
    listing: ListingInput;
    analysis: Analysis;
    findings?: DescriptionFindings | null;
  },
): Promise<DueDiligenceInquiry> {
  const baseline = buildDueDiligenceInquiry(opts);
  if (!isAiConfigured(settings)) return baseline;

  const { listing, analysis, findings } = opts;
  const descriptionText = listing.description
    ? [
        listing.description.object,
        listing.description.furnishing,
        listing.description.location,
        listing.description.other,
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";

  const systemPrompt = `You are a German real-estate due-diligence assistant for DuomoGrid.
Given a listing's facts, analysis flags, and baseline checklist, refine the checklist and draft a concise, polite German inquiry message to the real-estate agent (Makler).
Rules:
1. Keep all "title" and "whyEnglish" fields in clear English.
2. Keep all "questionGerman" and "messageGerman" fields in natural, polite German ("Sie"-form).
3. Ground every question in actual missing data, flags, or ambiguities in the seller's description.
4. Return ONLY valid JSON with shape:
{
  "checklist": [
    {
      "key": "string_id",
      "title": "Short English title",
      "whyEnglish": "1-2 sentences in English explaining why this matters",
      "questionGerman": "Polite German question for the Makler"
    }
  ],
  "messageGerman": "Complete copy-pasteable German message to the Makler"
}`;

  const userPayload = JSON.stringify({
    title: listing.title,
    offer: listing.offer,
    city: listing.city,
    propertyType: listing.propertyType,
    priceEur: listing.priceEur,
    livingAreaM2: listing.livingAreaM2,
    yearBuilt: listing.yearBuilt,
    yearRefurbished: listing.yearRefurbished,
    energyClass: listing.energyClass,
    energyKwh: listing.energyKwh,
    energySource: listing.energySource,
    heating: listing.heating,
    condoFeeEur: listing.condoFeeEur,
    leasehold: listing.leasehold,
    tenantOccupied: listing.tenantOccupied,
    flags: analysis.flags,
    findings: findings?.items ?? [],
    descriptionExcerpt: descriptionText.slice(0, 4000),
    baselineChecklist: baseline.checklist,
  });

  const raw = await completeJson<{
    checklist?: unknown[];
    messageGerman?: unknown;
  }>(settings, systemPrompt, userPayload);

  const refinedList: InquiryItem[] = [];
  if (Array.isArray(raw?.checklist)) {
    for (const entry of raw.checklist.slice(0, 10)) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      const key = typeof rec.key === "string" ? rec.key.trim().slice(0, 60) : `item_${refinedList.length + 1}`;
      const title = typeof rec.title === "string" ? rec.title.trim().slice(0, 120) : "";
      const whyEnglish = typeof rec.whyEnglish === "string" ? rec.whyEnglish.trim().slice(0, 400) : "";
      const questionGerman = typeof rec.questionGerman === "string" ? rec.questionGerman.trim().slice(0, 400) : "";
      if (title && whyEnglish && questionGerman) {
        refinedList.push({ key, title, whyEnglish, questionGerman });
      }
    }
  }

  const usedLlmChecklist = refinedList.length > 0;
  const usedLlmMessage =
    typeof raw?.messageGerman === "string" && raw.messageGerman.trim().length > 20;
  if (!usedLlmChecklist && !usedLlmMessage) {
    return baseline;
  }

  return {
    checklist: usedLlmChecklist ? refinedList : baseline.checklist,
    messageGerman: usedLlmMessage ? (raw.messageGerman as string).trim().slice(0, 4000) : baseline.messageGerman,
    source: "llm",
    model: settings.model,
  };
}
