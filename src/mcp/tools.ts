import { eq } from "drizzle-orm";
import type { getDb } from "../db/client.js";
import { listings, observations, settings } from "../db/schema.js";
import {
  isAiConfigured,
  type AgentToolDef,
  type EnvAiDefaults,
} from "../domain/ai.js";
import { analyze } from "../domain/analyze.js";
import { normalizeAssumptions } from "../domain/assumptions.js";
import { rentAgainstBuy } from "../domain/compare.js";
import {
  extractDescriptionWithLlm,
  mergeExtractedFacts,
} from "../domain/describe.js";
import { districtSaleBandFor } from "../domain/district-band.js";
import { priceHistoryOf } from "../domain/history.js";
import {
  buildDueDiligenceInquiry,
  refineInquiryWithLlm,
} from "../domain/inquiry.js";
import { maxOffer } from "../domain/max-offer.js";
import { energySourceOf } from "../domain/ingest.js";
import { fold } from "../domain/reference.js";
import { STATES, type ListingInput, type Provenance } from "../domain/types.js";
import {
  asBodenrichtwert,
  asInput,
  bodenrichtwertView,
  createListingPresenter,
  findingsFor,
  loadCurrentAiSettings,
  purchaseOf,
  readFacts,
  toCohort,
} from "../routes/listings.js";
import type { EncryptionService } from "../services/encryption.js";

type DbInstance = ReturnType<typeof getDb>;

export type AgentDeps = {
  db: DbInstance;
  encryption?: EncryptionService;
  envConfig?: EnvAiDefaults;
};

const READ_TOOLS: AgentToolDef[] = [
  {
    name: "list_listings",
    description:
      "List saved buy and rent listings in DuomoGrid with their scores, verdicts, monthly costs, and key flags. Supports filtering by offer, status, city, minimum score, and maximum price.",
    inputSchema: {
      type: "object",
      properties: {
        offer: {
          type: "string",
          enum: ["buy", "rent"],
          description: "Filter by buy or rent.",
        },
        status: {
          type: "string",
          enum: ["open", "visit", "offer", "pass"],
          description: "Filter by workflow status.",
        },
        city: {
          type: "string",
          description: "Filter by city name (case- and umlaut-insensitive).",
        },
        minScore: {
          type: "number",
          description: "Minimum buy score (0-100).",
        },
        maxPriceEur: {
          type: "number",
          description: "Maximum asking price or cold rent in EUR.",
        },
      },
    },
  },
  {
    name: "get_listing",
    description:
      "Get the full detail, deterministic financial analysis, description findings, price history, cohort comparison, Bodenrichtwert, and max-offer thresholds for one saved listing by ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The listing UUID.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "simulate_analysis",
    description:
      "Run DuomoGrid's deterministic German real-estate calculator on a saved listing (or hypothetical parameters) with temporary what-if overrides (e.g. price discount, different interest rate, equity, condo fee, cold rent, or energy class) without modifying stored data.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Listing ID to use as the baseline.",
        },
        priceEur: {
          type: "number",
          description: "Override asking price in EUR.",
        },
        discountPercent: {
          type: "number",
          description:
            "Percentage discount off the listing's current price (e.g. 10 for 10% off). Ignored if priceEur is set.",
        },
        interestPercent: {
          type: "number",
          description: "Override annual loan interest rate in percent (e.g. 3.8).",
        },
        equityMode: {
          type: "string",
          enum: ["percent", "eur"],
          description: "Override whether equity is a percentage of price or fixed EUR.",
        },
        equityPercent: {
          type: "number",
          description: "Override equity percentage (when equityMode is percent).",
        },
        equityEur: {
          type: "number",
          description: "Override fixed equity in EUR (when equityMode is eur).",
        },
        termYears: {
          type: "number",
          description: "Override loan amortization term in years.",
        },
        fixedYears: {
          type: "number",
          description: "Override interest rate fixation period (Zinsbindung) in years.",
        },
        monthlyBudgetEur: {
          type: "number",
          description: "Override monthly budget in EUR.",
        },
        condoFeeEur: {
          type: "number",
          description: "Override monthly condo fee (Hausgeld) in EUR.",
        },
        coldRentEur: {
          type: "number",
          description: "Override monthly net cold rent in EUR (for gross yield).",
        },
        energyClass: {
          type: "string",
          enum: ["A+", "A", "B", "C", "D", "E", "F", "G", "H"],
          description: "Override energy efficiency class.",
        },
        energySource: {
          type: "string",
          description: "Override heating fuel (e.g. Wärmepumpe, Gas, Fernwärme, Pellets).",
        },
        yearRefurbished: {
          type: "number",
          description: "Override refurbishment year.",
        },
      },
    },
  },
  {
    name: "compare_listings",
    description:
      "Compare multiple saved listings side-by-side on price per m², cash to close, monthly total, remaining debt after fixed-rate period, score, and rent-vs-buy horizon net wealth.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description:
            "Listing IDs to compare (2 to 5). If omitted, compares the top-scored buy listings.",
        },
      },
    },
  },
  {
    name: "generate_makler_inquiry",
    description:
      "Generate a due-diligence checklist (in English) and a copy-pasteable German inquiry message to the real-estate agent (Makler) based on missing fields and warning flags for a listing.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The listing UUID.",
        },
        useLlm: {
          type: "boolean",
          description:
            "If true and an AI provider is configured, tailor the German message to nuances in the seller's text.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "get_assumptions",
    description:
      "Read the current financing, tax, upkeep, and horizon assumptions used across all listings.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

const WRITE_TOOLS: AgentToolDef[] = [
  {
    name: "update_listing",
    description:
      "Update a saved listing's workflow status (open, visit, offer, pass), notes, or corrected facts (priceEur, livingAreaM2, plotAreaM2, rooms, city, district, state, propertyType, yearBuilt, energyClass).",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The listing UUID.",
        },
        status: {
          type: "string",
          enum: ["open", "visit", "offer", "pass"],
        },
        notes: {
          type: "string",
          description: "User notes on the listing (up to 4000 chars).",
        },
        priceEur: { type: "number" },
        livingAreaM2: { type: "number" },
        plotAreaM2: { type: "number" },
        rooms: { type: "number" },
        city: { type: "string" },
        district: { type: "string" },
        state: { type: "string" },
        propertyType: {
          type: "string",
          enum: ["apartment", "house", "land", "multi", "other"],
        },
        yearBuilt: { type: "number" },
        energyClass: {
          type: "string",
          enum: ["A+", "A", "B", "C", "D", "E", "F", "G", "H"],
        },
      },
      required: ["id"],
    },
  },
  {
    name: "update_assumptions",
    description:
      "Update global financing, tax, upkeep, or horizon assumptions (partial updates are merged with current assumptions).",
    inputSchema: {
      type: "object",
      properties: {
        equityMode: { type: "string", enum: ["percent", "eur"] },
        equityPercent: { type: "number" },
        equityEur: { type: "number" },
        interestPercent: { type: "number" },
        termYears: { type: "number" },
        fixedYears: { type: "number" },
        notaryPercent: { type: "number" },
        registerPercent: { type: "number" },
        fallbackCommissionPercent: { type: "number" },
        monthlyBudgetEur: { type: ["number", "null"] },
        targetEurPerM2: { type: ["number", "null"] },
        defaultState: { type: ["string", "null"] },
        horizonYears: { type: "number" },
        equityReturnPercent: { type: "number" },
        appreciationPercent: { type: "number" },
        rentGrowthPercent: { type: "number" },
      },
    },
  },
  {
    name: "extract_listing_description",
    description:
      "Run LLM structured fact & finding extraction on a listing's German description and cache the result.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The listing UUID.",
        },
      },
      required: ["id"],
    },
  },
];

const READ_TOOL_NAMES = new Set(READ_TOOLS.map((tool) => tool.name));

export function getAgentTools(opts: { readOnly?: boolean } = {}): AgentToolDef[] {
  return opts.readOnly ? READ_TOOLS : [...READ_TOOLS, ...WRITE_TOOLS];
}

export async function executeAgentTool(
  deps: AgentDeps,
  name: string,
  args: Record<string, unknown>,
  opts: { readOnly?: boolean } = {},
): Promise<{ result: unknown; summary: string }> {
  if (opts.readOnly && !READ_TOOL_NAMES.has(name)) {
    return {
      result: { error: `Tool "${name}" is not allowed in read-only mode.` },
      summary: `Blocked write tool ${name}`,
    };
  }
  const { db, encryption, envConfig } = deps;
  const presenter = createListingPresenter(db);
  const ctx = presenter.context();

  if (name === "list_listings") {
    const allRows = db
      .select()
      .from(listings)
      .all()
      .map((row) => presenter.present(row, ctx.priceMap, ctx.past, ctx.model));

    const offerFilter = typeof args.offer === "string" ? args.offer : null;
    const statusFilter = typeof args.status === "string" ? args.status : null;
    const cityFilter = typeof args.city === "string" && args.city.trim() ? fold(args.city) : null;
    const minScore = typeof args.minScore === "number" ? args.minScore : null;
    const maxPrice = typeof args.maxPriceEur === "number" ? args.maxPriceEur : null;

    const filtered = allRows
      .filter((row) => (offerFilter ? row.listing.offer === offerFilter : true))
      .filter((row) => (statusFilter ? row.status === statusFilter : true))
      .filter((row) => (cityFilter ? fold(row.listing.city).includes(cityFilter) : true))
      .filter((row) => (minScore != null ? (row.analysis.score ?? -1) >= minScore : true))
      .filter((row) =>
        maxPrice != null && row.listing.priceEur != null
          ? row.listing.priceEur <= maxPrice
          : true,
      )
      .sort((a, b) => (b.analysis.score ?? -1) - (a.analysis.score ?? -1));

    const items = filtered.map((row) => ({
      id: row.id,
      title: row.listing.title,
      offer: row.listing.offer,
      status: row.status,
      city: row.listing.city,
      district: row.listing.district,
      propertyType: row.listing.propertyType,
      priceEur: row.listing.priceEur,
      livingAreaM2: row.listing.livingAreaM2,
      rooms: row.listing.rooms,
      energyClass: row.listing.energyClass,
      score: row.analysis.score,
      verdict: row.analysis.verdict,
      pricePerLivingM2: row.analysis.pricePerLivingM2,
      cashToCloseEur: row.analysis.cashToCloseEur,
      monthlyTotal: row.analysis.monthlyTotal ?? row.analysis.monthlyPartial,
      monthlyComplete: row.analysis.monthlyTotal != null,
      topFlags: row.analysis.flags.slice(0, 4).map((f) => `${f.severity.toUpperCase()}: ${f.title}`),
    }));

    return {
      result: { count: items.length, listings: items },
      summary: `Listed ${items.length} matching listing(s)`,
    };
  }

  if (name === "get_listing") {
    const id = String(args.id ?? "").trim();
    const row = db.select().from(listings).where(eq(listings.id, id)).all()[0];
    if (!row) {
      return {
        result: { error: `Listing "${id}" not found.` },
        summary: `Listing ${id} not found`,
      };
    }
    const detail = presenter.present(row, ctx.priceMap, ctx.past, ctx.model, true);
    return {
      result: detail,
      summary: `Loaded detail for "${detail.listing.title}"`,
    };
  }

  if (name === "simulate_analysis") {
    const id = typeof args.id === "string" ? args.id.trim() : "";
    const row = id ? db.select().from(listings).where(eq(listings.id, id)).all()[0] : undefined;
    if (id && !row) {
      return {
        result: { error: `Listing "${id}" not found.` },
        summary: `Listing ${id} not found`,
      };
    }

    const basePrice = row ? (ctx.priceMap.get(row.id) ?? null) : null;
    const baseInput: ListingInput = row
      ? asInput(row, basePrice)
      : {
          source: "manual",
          sourceUrl: "",
          externalId: null,
          title: "Hypothetical listing",
          offer: "buy",
          priceEur: typeof args.priceEur === "number" ? args.priceEur : 400000,
          livingAreaM2: typeof args.livingAreaM2 === "number" ? args.livingAreaM2 : 90,
          plotAreaM2: null,
          rooms: 3,
          city: typeof args.city === "string" ? args.city : "",
          district: null,
          postalCode: null,
          state: ctx.model.defaultState,
          street: null,
          latitude: null,
          longitude: null,
          locationPrecision: null,
          propertyType: "apartment",
          yearBuilt: 2000,
          yearRefurbished: null,
          energyClass: "C",
          energyKwh: null,
          energyCert: null,
          heating: null,
          condoFeeEur: 300,
          coldRentEur: null,
          warmRentEur: null,
          depositEur: null,
          rentContract: null,
          commissionPercent: null,
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
          energySource: null,
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
          description: null,
          details: [],
          images: [],
        };

    const rawFindings = row
      ? findingsFor(row.descriptionJson, baseInput.description, row.llmExtractionJson)
      : { items: [], renovatedYear: null, heatingReplacedYear: null };
    const { analysed: baselineInput } = mergeExtractedFacts(baseInput, rawFindings);

    let nextPrice = baselineInput.priceEur;
    if (typeof args.priceEur === "number" && args.priceEur > 0) {
      nextPrice = args.priceEur;
    } else if (
      typeof args.discountPercent === "number" &&
      baselineInput.priceEur != null &&
      args.discountPercent > -100 &&
      args.discountPercent < 100
    ) {
      nextPrice = Math.round(baselineInput.priceEur * (1 - args.discountPercent / 100));
    }

    const simulatedInput: ListingInput = {
      ...baselineInput,
      priceEur: nextPrice,
      condoFeeEur:
        typeof args.condoFeeEur === "number" ? args.condoFeeEur : baselineInput.condoFeeEur,
      coldRentEur:
        typeof args.coldRentEur === "number" ? args.coldRentEur : baselineInput.coldRentEur,
      energyClass:
        typeof args.energyClass === "string" ? args.energyClass : baselineInput.energyClass,
      energySource:
        typeof args.energySource === "string"
          ? energySourceOf(args.energySource)
          : baselineInput.energySource,
      yearRefurbished:
        typeof args.yearRefurbished === "number"
          ? args.yearRefurbished
          : baselineInput.yearRefurbished,
    };

    const simulatedAssumptions = normalizeAssumptions({
      ...ctx.model,
      ...(typeof args.interestPercent === "number" ? { interestPercent: args.interestPercent } : {}),
      ...(typeof args.equityMode === "string" ? { equityMode: args.equityMode } : {}),
      ...(typeof args.equityPercent === "number" ? { equityPercent: args.equityPercent } : {}),
      ...(typeof args.equityEur === "number" ? { equityEur: args.equityEur } : {}),
      ...(typeof args.termYears === "number" ? { termYears: args.termYears } : {}),
      ...(typeof args.fixedYears === "number" ? { fixedYears: args.fixedYears } : {}),
      ...(args.monthlyBudgetEur !== undefined ? { monthlyBudgetEur: args.monthlyBudgetEur } : {}),
    });

    const market = row
      ? {
          bodenrichtwert: asBodenrichtwert(bodenrichtwertView(row)),
          districtSaleBand: districtSaleBandFor({
            offer: row.offer,
            propertyType: row.propertyType,
            city: row.city,
            district: row.district,
            state: row.state,
          }),
          findings: rawFindings.items,
          heatingReplacedYear: rawFindings.heatingReplacedYear,
          history: priceHistoryOf({
            observations: ctx.past.get(row.id) ?? [],
            portalPreviousPriceEur: row.portalPreviousPriceEur,
            listedAt: row.listedAt,
            createdAt: row.createdAt,
            now: new Date(),
          }),
        }
      : {};

    const baselineAnalysis = analyze(baselineInput, ctx.model, market);
    const simulatedAnalysis = analyze(simulatedInput, simulatedAssumptions, market);
    const simulatedMaxOffer = maxOffer(simulatedInput, simulatedAssumptions, market);

    const everyone = db
      .select()
      .from(listings)
      .all()
      .map((item) => toCohort(item, ctx.priceMap.get(item.id) ?? null));
    const rentComparison = rentAgainstBuy(
      {
        offer: simulatedInput.offer,
        city: simulatedInput.city,
        propertyType: simulatedInput.propertyType,
        livingAreaM2: simulatedInput.livingAreaM2,
        priceEur: simulatedInput.priceEur,
        coldRentEur: simulatedInput.coldRentEur,
        purchase: purchaseOf(simulatedAnalysis),
      },
      everyone,
      simulatedAssumptions,
    );

    const diff = (sim: number | null, base: number | null) =>
      sim != null && base != null ? Math.round((sim - base) * 100) / 100 : null;

    return {
      result: {
        listingTitle: baselineInput.title,
        baseline: {
          priceEur: baselineInput.priceEur,
          cashToCloseEur: baselineAnalysis.cashToCloseEur,
          loanEur: baselineAnalysis.loanEur,
          monthlyDebt: baselineAnalysis.monthlyDebt,
          monthlyTotal: baselineAnalysis.monthlyTotal,
          remainingDebtEur: baselineAnalysis.remainingDebtEur,
          grossYield: baselineAnalysis.grossYield,
          score: baselineAnalysis.score,
          verdict: baselineAnalysis.verdict,
        },
        simulated: {
          priceEur: simulatedInput.priceEur,
          interestPercent: simulatedAssumptions.interestPercent,
          equityEur: simulatedAnalysis.equityEur,
          cashToCloseEur: simulatedAnalysis.cashToCloseEur,
          extraEur: simulatedAnalysis.extraEur,
          loanEur: simulatedAnalysis.loanEur,
          monthlyDebt: simulatedAnalysis.monthlyDebt,
          monthlyHeating: simulatedAnalysis.monthlyHeating,
          monthlyCondoFee: simulatedAnalysis.monthlyCondoFee,
          monthlyTotal: simulatedAnalysis.monthlyTotal,
          remainingDebtEur: simulatedAnalysis.remainingDebtEur,
          refinanceMonthlyPlus1Eur: simulatedAnalysis.refinanceMonthlyPlus1Eur,
          refinanceMonthlyPlus2Eur: simulatedAnalysis.refinanceMonthlyPlus2Eur,
          grossYield: simulatedAnalysis.grossYield,
          score: simulatedAnalysis.score,
          verdict: simulatedAnalysis.verdict,
          flags: simulatedAnalysis.flags,
          maxOffer: simulatedMaxOffer,
          rentComparison,
        },
        deltas: {
          priceDeltaEur: diff(simulatedInput.priceEur, baselineInput.priceEur),
          cashToCloseDeltaEur: diff(simulatedAnalysis.cashToCloseEur, baselineAnalysis.cashToCloseEur),
          monthlyTotalDeltaEur: diff(simulatedAnalysis.monthlyTotal, baselineAnalysis.monthlyTotal),
          scoreDelta: diff(simulatedAnalysis.score, baselineAnalysis.score),
        },
      },
      summary: `Simulated "${baselineInput.title}" at ${simulatedInput.priceEur ?? "—"} EUR (${simulatedAssumptions.interestPercent}% interest) -> score ${simulatedAnalysis.score ?? "—"}, monthly ${simulatedAnalysis.monthlyTotal ?? simulatedAnalysis.monthlyPartial ?? "—"} EUR`,
    };
  }

  if (name === "compare_listings") {
    const requestedIds = Array.isArray(args.ids)
      ? args.ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const allRows = db
      .select()
      .from(listings)
      .all()
      .map((row) => presenter.present(row, ctx.priceMap, ctx.past, ctx.model, true));

    const selected =
      requestedIds.length > 0
        ? requestedIds
            .map((id) => allRows.find((row) => row.id === id))
            .filter((row): row is NonNullable<typeof row> => Boolean(row))
        : allRows
            .filter((row) => row.listing.offer === "buy")
            .sort((a, b) => (b.analysis.score ?? -1) - (a.analysis.score ?? -1))
            .slice(0, 3);

    const comparison = selected.map((row) => ({
      id: row.id,
      title: row.listing.title,
      city: row.listing.city,
      offer: row.listing.offer,
      propertyType: row.listing.propertyType,
      priceEur: row.listing.priceEur,
      livingAreaM2: row.listing.livingAreaM2,
      pricePerLivingM2: row.analysis.pricePerLivingM2,
      cashToCloseEur: row.analysis.cashToCloseEur,
      loanEur: row.analysis.loanEur,
      monthlyDebt: row.analysis.monthlyDebt,
      monthlyTotal: row.analysis.monthlyTotal ?? row.analysis.monthlyPartial,
      remainingDebtEur: row.analysis.remainingDebtEur,
      score: row.analysis.score,
      verdict: row.analysis.verdict,
      maxOffer: row.maxOffer,
      rentComparison: row.rentComparison,
      flags: row.analysis.flags.map((f) => `${f.severity}: ${f.title}`),
    }));

    return {
      result: { count: comparison.length, compared: comparison },
      summary: `Compared ${comparison.length} listing(s)`,
    };
  }

  if (name === "generate_makler_inquiry") {
    const id = String(args.id ?? "").trim();
    const row = db.select().from(listings).where(eq(listings.id, id)).all()[0];
    if (!row) {
      return {
        result: { error: `Listing "${id}" not found.` },
        summary: `Listing ${id} not found`,
      };
    }
    const presented = presenter.present(row, ctx.priceMap, ctx.past, ctx.model, true);
    const aiSettings = loadCurrentAiSettings(db, envConfig, encryption);
    const inquiry =
      args.useLlm === true && isAiConfigured(aiSettings)
        ? await refineInquiryWithLlm(aiSettings, {
            listing: presented.listing as ListingInput,
            analysis: presented.analysis as ReturnType<typeof analyze>,
            findings: presented.descriptionFindings,
          })
        : buildDueDiligenceInquiry({
            listing: presented.listing as ListingInput,
            analysis: presented.analysis as ReturnType<typeof analyze>,
            findings: presented.descriptionFindings,
          });
    return {
      result: inquiry,
      summary: `Generated ${inquiry.checklist.length} due-diligence questions for "${presented.listing.title}"`,
    };
  }

  if (name === "get_assumptions") {
    return {
      result: { assumptions: ctx.model, states: STATES },
      summary: "Loaded current financing assumptions",
    };
  }

  if (name === "update_assumptions") {
    const merged = normalizeAssumptions({ ...ctx.model, ...args });
    // A value the caller set is the caller's own, so a market refresh never overwrites it. A value
    // that was following the market keeps following it only when the caller left it alone.
    const own: Provenance = { source: "user", asOf: null, note: null };
    if (args.interestPercent !== undefined) merged.interestProvenance = own;
    if (args.notaryPercent !== undefined) merged.notaryProvenance = own;
    if (args.registerPercent !== undefined) merged.registerProvenance = own;
    if (args.fallbackCommissionPercent !== undefined) merged.commissionProvenance = own;
    const value = JSON.stringify(merged);
    const existing = db.select().from(settings).where(eq(settings.key, "assumptions")).all()[0];
    if (existing) {
      db.update(settings).set({ value }).where(eq(settings.key, "assumptions")).run();
    } else {
      db.insert(settings).values({ key: "assumptions", value }).run();
    }
    return {
      result: { assumptions: merged },
      summary: "Updated financing assumptions",
    };
  }

  if (name === "update_listing") {
    const id = String(args.id ?? "").trim();
    const row = db.select().from(listings).where(eq(listings.id, id)).all()[0];
    if (!row) {
      return {
        result: { error: `Listing "${id}" not found.` },
        summary: `Listing ${id} not found`,
      };
    }
    const parsed = readFacts(args);
    if (!parsed.ok) {
      return {
        result: { error: parsed.error },
        summary: `Invalid listing update: ${parsed.error}`,
      };
    }
    const facts = parsed.facts;
    const notes = typeof args.notes === "string" ? args.notes.slice(0, 4000) : row.notes;
    const nextStatus =
      typeof args.status === "string" && ["open", "visit", "offer", "pass"].includes(args.status)
        ? args.status
        : row.status;
    const now = new Date().toISOString();
    const priceTouched = facts.priceEur !== undefined;
    const nextPrice = facts.priceEur ?? null;
    const previousPrice = priceTouched ? (ctx.priceMap.get(row.id) ?? null) : null;
    const priceChanged = priceTouched && previousPrice !== nextPrice;

    db.transaction((tx) => {
      tx.update(listings)
        .set({
          notes,
          status: nextStatus,
          livingAreaM2: facts.livingAreaM2 !== undefined ? facts.livingAreaM2 : row.livingAreaM2,
          plotAreaM2: facts.plotAreaM2 !== undefined ? facts.plotAreaM2 : row.plotAreaM2,
          rooms: facts.rooms !== undefined ? facts.rooms : row.rooms,
          city: facts.city !== undefined ? facts.city : row.city,
          district: facts.district !== undefined ? facts.district : row.district,
          state: facts.state !== undefined ? facts.state : row.state,
          propertyType: facts.propertyType ?? row.propertyType,
          yearBuilt: facts.yearBuilt !== undefined ? facts.yearBuilt : row.yearBuilt,
          energyClass: facts.energyClass !== undefined ? facts.energyClass : row.energyClass,
          coldRentEur: priceChanged && row.offer === "rent" ? nextPrice : row.coldRentEur,
          updatedAt: now,
        })
        .where(eq(listings.id, row.id))
        .run();
      if (!priceChanged) return;
      tx.insert(observations)
        .values({
          listingId: row.id,
          seenAt: now,
          priceEur: nextPrice,
          coldRentEur: row.offer === "rent" ? nextPrice : row.coldRentEur,
          warmRentEur: row.warmRentEur,
          condoFeeEur: row.condoFeeEur,
          rawJson: JSON.stringify({ source: "mcp_update", priceEur: nextPrice }),
        })
        .run();
    });

    const refreshed = db.select().from(listings).where(eq(listings.id, row.id)).all()[0];
    const freshCtx = presenter.context();
    const detail = presenter.present(refreshed, freshCtx.priceMap, freshCtx.past, freshCtx.model, true);
    return {
      result: detail,
      summary: `Updated listing "${detail.listing.title}"`,
    };
  }

  if (name === "extract_listing_description") {
    const id = String(args.id ?? "").trim();
    const row = db.select().from(listings).where(eq(listings.id, id)).all()[0];
    if (!row) {
      return {
        result: { error: `Listing "${id}" not found.` },
        summary: `Listing ${id} not found`,
      };
    }
    const aiSettings = loadCurrentAiSettings(db, envConfig, encryption);
    if (!isAiConfigured(aiSettings)) {
      return {
        result: { error: "AI provider is not configured." },
        summary: "AI provider not configured",
      };
    }
    const input = asInput(row, ctx.priceMap.get(row.id) ?? null);
    const extracted = await extractDescriptionWithLlm(
      aiSettings,
      input.description,
      input.details,
      row.descriptionJson,
    );
    db.update(listings)
      .set({ llmExtractionJson: JSON.stringify(extracted) })
      .where(eq(listings.id, row.id))
      .run();
    const refreshed = db.select().from(listings).where(eq(listings.id, row.id)).all()[0];
    const detail = presenter.present(refreshed, ctx.priceMap, ctx.past, ctx.model, true);
    return {
      result: {
        id: detail.id,
        descriptionFindings: detail.descriptionFindings,
        analysis: detail.analysis,
      },
      summary: `Extracted ${detail.descriptionFindings?.items.length ?? 0} findings with ${aiSettings.model}`,
    };
  }

  return {
    result: { error: `Unknown tool "${name}".` },
    summary: `Unknown tool ${name}`,
  };
}
