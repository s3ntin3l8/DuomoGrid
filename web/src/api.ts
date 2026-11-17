/** Where a number came from. `user` means the owner typed it, `market` that they accepted a published figure. */
export type Provenance = {
  source: "user" | "market" | "builtin";
  asOf: string | null;
  note: string | null;
};

export type EnergyRate = "electric" | "gas" | "district" | "oil" | "biomass" | "unknown";

/** The heating rate per fuel, and where each one came from. */
export type EnergyRateAssumptions = {
  electric: number;
  electricProvenance: Provenance;
  gas: number;
  gasProvenance: Provenance;
  district: number;
  districtProvenance: Provenance;
  oil: number;
  oilProvenance: Provenance;
  biomass: number;
  biomassProvenance: Provenance;
  unknown: number;
  unknownProvenance: Provenance;
};

export type Assumptions = {
  equityMode: "percent" | "eur";
  equityPercent: number;
  equityEur: number;
  interestPercent: number;
  interestProvenance: Provenance;
  termYears: number;
  fixedYears: number;
  notaryPercent: number;
  notaryProvenance: Provenance;
  registerPercent: number;
  registerProvenance: Provenance;
  fallbackCommissionPercent: number;
  commissionProvenance: Provenance;
  energyRates: EnergyRateAssumptions;
  horizonYears: number;
  equityReturnPercent: number;
  appreciationPercent: number;
  rentGrowthPercent: number;
  maintenanceEurPerM2Year: number;
  propertyTaxEurYear: number;
  insuranceEurPerM2Year: number;
  monthlyBudgetEur: number | null;
  targetEurPerM2: number | null;
  defaultState: string | null;
};

/** What the desk can offer for a value, and why. */
export type Suggestion = {
  value: number;
  asOf: string;
  source: string;
  lowPercent: number | null;
  highPercent: number | null;
  preliminary: boolean;
  detail: string;
};

export type Suggestions = {
  interest: Suggestion | null;
  notary: Suggestion | null;
  register: Suggestion | null;
  commission: Suggestion | null;
  /** The heating rate on offer per fuel. Only electricity and gas have a published price. */
  energy: Partial<Record<EnergyRate, Suggestion>>;
};

export type MarketRateHistoryPoint = { period: string; percent: number };

export type MarketRates = {
  asOf: string;
  secured10yPercent: number | null;
  unsecured10yPercent: number | null;
  allNewPercent: number | null;
  floatingPercent: number | null;
  secured10yLowPercent: number | null;
  secured10yHighPercent: number | null;
  /** How many months the range covers. */
  secured10yRangeMonths: number;
  history: MarketRateHistoryPoint[];
  spreadPercent: number | null;
  source: string;
  preliminary: boolean;
  fetchedAt: string;
};

export type EnergyPrices = {
  asOf: string;
  electricityEurPerKwh: number | null;
  /** The period the electricity price belongs to. The two tables cover different spans. */
  electricityAsOf: string;
  gasEurPerKwh: number | null;
  /** The period the gas price belongs to. */
  gasAsOf: string;
  source: string;
  fetchedAt: string;
};

export type MarketSnapshot = {
  rates: MarketRates | null;
  energy: EnergyPrices | null;
  fetchedAt: string;
  note: string | null;
};

export type AssumptionsResponse = {
  assumptions: Assumptions;
  states: StateOption[];
  market: MarketSnapshot;
  suggestions: Suggestions;
};

export type StateOption = { id: string; name: string; tax: number };

export type Flag = { severity: "bad" | "warn" | "info" | "good"; title: string; detail: string };

export type Subscore = {
  key: string;
  label: string;
  score: number;
  weight: number;
  note: string;
  applicable: boolean;
};

export type DeskListing = {
  id: string;
  status: string;
  notes: string;
  updatedAt: string;
  listing: {
    title: string;
    offer: "buy" | "rent";
    city: string;
    district: string | null;
    postalCode: string | null;
    state: string | null;
    street: string | null;
    latitude: number | null;
    longitude: number | null;
    locationPrecision: "exact" | "approximate" | null;
    source: string;
    sourceUrl: string;
    propertyType: string;
    priceEur: number | null;
    livingAreaM2: number | null;
    plotAreaM2: number | null;
    rooms: number | null;
    yearBuilt: number | null;
    energyClass: string | null;
    energyKwh: number | null;
    energyCert: string | null;
    heating: string | null;
    condoFeeEur: number | null;
    coldRentEur: number | null;
    warmRentEur: number | null;
    depositEur: number | null;
    rentContract: string | null;
    floor: string | null;
    condition: string | null;
    features: string[];
    leasehold: boolean;
    snippet: string;
    heatingSystem: string | null;
    energySource: string | null;
    parkingSpaces: number | null;
    parkingType: "garage" | "underground" | "carport" | "outdoor" | "other" | null;
    parkingPriceEur: number | null;
    bathrooms: number | null;
    bedrooms: number | null;
    availableFrom: string | null;
    listedAt: string | null;
    portalPreviousPriceEur: number | null;
    portalMarketEurPerM2: number | null;
    portalMarketLowEurPerM2: number | null;
    portalMarketHighEurPerM2: number | null;
    /** Only on the detail route. The list returns null and []. */
    description: { object: string | null; furnishing: string | null; location: string | null; other: string | null } | null;
    details: { label: string; value: string }[];
    /** Hotlinked from the portal CDN. Only on the detail route; the list returns []. */
    images: { url: string; caption: string | null; kind: "photo" | "floorplan" }[];
  };
  /** The first photo, on the list as well, for the row thumbnail. */
  coverUrl: string | null;
  /** Null on the list. Present once the detail route has answered. */
  descriptionFindings: {
    items: { key: string; label: string; snippet: string; year?: number; amountEur?: number }[];
    renovatedYear: number | null;
    heatingReplacedYear: number | null;
    filledFields?: string[];
    source?: "regex" | "llm";
    model?: string | null;
  } | null;
  analysis: {
    pricePerLivingM2: number | null;
    rentPerM2: number | null;
    transferTaxPercent: number | null;
    transferTaxEur: number | null;
    notaryEur: number | null;
    registerEur: number | null;
    commissionPercent: number | null;
    commissionAssumed: boolean;
    commissionEur: number | null;
    parkingEur: number | null;
    parkingUnitEur: number | null;
    parkingSpaces: number | null;
    parkingSpacesAssumed: boolean;
    extraEur: number | null;
    cashToCloseEur: number | null;
    equityEur: number | null;
    loanEur: number | null;
    equityCoversCosts: boolean | null;
    fixedYears: number | null;
    remainingDebtEur: number | null;
    refinanceMonthlyPlus1Eur: number | null;
    refinanceMonthlyPlus2Eur: number | null;
    monthlyDebt: number | null;
    monthlyHeating: number | null;
    monthlyCondoFee: number | null;
    monthlyGroundRent: number | null;
    monthlyRunning: number | null;
    monthlyMaintenance: number | null;
    monthlyPropertyTax: number | null;
    monthlyInsurance: number | null;
    monthlyTotal: number | null;
    monthlyPartial: number | null;
    grossYield: number | null;
    score: number | null;
    verdict: string;
    flags: Flag[];
    subscores: Subscore[];
    stateName: string | null;
    benchmark: { label: string; eurPerM2: number } | null;
    benchmarkDeltaPct: number | null;
  };
  observations: { seenAt: string; priceEur: number | null }[];
  priceHistory: {
    /** Oldest to newest. The portal's earlier price comes first, undated, when it adds something. */
    points: { priceEur: number; at: string | null; source: "portal" | "saved" }[];
    firstKnownPriceEur: number | null;
    currentPriceEur: number | null;
    totalChangeEur: number | null;
    totalChangePct: number | null;
    reductions: number;
    increases: number;
    lastChangeAt: string | null;
    startedAt: string;
    startedBasis: "portal" | "saved";
    daysOnMarket: number;
  };
  /** Null on the list. The detail route fills it for a buy listing. */
  maxOffer: { budgetPriceEur: number | null; scorePriceEur: number | null; scoreTarget: number } | null;
  cohort: { count: number; medianEurPerM2: number | null; deltaPct: number | null };
  rentComparison: {
    rentCount: number;
    medianColdRentEur: number | null;
    /** Null without a rent sample or when the cost of owning is incomplete. */
    horizon: {
      horizonYears: number;
      unrecoverableBuyMonthlyEur: number;
      averageRentMonthlyEur: number;
      homeValueEur: number;
      remainingDebtEur: number;
      netWealthBuyEur: number;
      netWealthRentEur: number;
      buyAdvantageEur: number;
    } | null;
  } | null;
  bodenrichtwert: {
    status: "unknown" | "none" | "published" | "unpublished";
    zone: string | null;
    eurPerM2: number | null;
    stichtag: string | null;
  } | null;
  districtSaleBand: {
    name: string;
    stateName: string;
    year: number;
    band: string;
    kind: "apartment" | "house";
  } | null;
};

export type AuthSession = { mode: "token" | "proxy" };

const TOKEN_KEY = "duomo.token";

/** Bearer header, or nothing. An empty token must not send `Bearer `, or the proxy routes it past forward-auth. */
export function authHeaders(token: string): Record<string, string> {
  if (!token) return {};
  return { authorization: `Bearer ${token}` };
}

export function storedToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function rememberToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...authHeaders(token),
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export function loadSession() {
  // A stalling proxy must not pin the desk on "Opening the desk…". The catch
  // falls back to the token gate.
  return request<AuthSession>("", "/auth/session", { signal: AbortSignal.timeout(3000) });
}

export function loadListings(token: string) {
  return request<DeskListing[]>(token, "/listings");
}

export function loadListing(token: string, id: string) {
  return request<DeskListing>(token, `/listings/${id}`);
}

export type ListingPatch = {
  notes?: string;
  status?: string;
  latitude?: number;
  longitude?: number;
  clearPoint?: boolean;
  livingAreaM2?: number | null;
  plotAreaM2?: number | null;
  rooms?: number | null;
  city?: string;
  district?: string | null;
  state?: string | null;
  propertyType?: string;
  yearBuilt?: number | null;
  energyClass?: string | null;
  priceEur?: number | null;
};

export function saveListing(token: string, id: string, body: ListingPatch) {
  return request<DeskListing>(token, `/listings/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function removeListing(token: string, id: string) {
  return request<{ deleted: boolean }>(token, `/listings/${id}`, { method: "DELETE" });
}

export function loadAssumptions(token: string) {
  return request<AssumptionsResponse>(token, "/assumptions");
}

export function saveAssumptions(token: string, assumptions: Assumptions, options?: { accept?: string[]; pin?: string[] }) {
  return request<AssumptionsResponse>(token, "/assumptions", {
    method: "PUT",
    body: JSON.stringify({
      ...assumptions,
      ...(options?.accept?.length ? { accept: options.accept } : {}),
      ...(options?.pin?.length ? { pin: options.pin } : {}),
    }),
  });
}

export function refreshMarketRates(token: string) {
  return request<AssumptionsResponse>(token, "/assumptions/refresh", { method: "POST" });
}

export type AiProvider = "none" | "openai" | "anthropic";

export type AiSettingsPublic = {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  autoExtractOnSave: boolean;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  apiKeySource?: "db" | "env" | "none";
  configured: boolean;
  encryptionEnabled?: boolean;
};

export type AiSettingsUpdate = {
  provider?: AiProvider;
  baseUrl?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  model?: string;
  autoExtractOnSave?: boolean;
};

export type DueDiligenceInquiry = {
  checklist: {
    key: string;
    title: string;
    whyEnglish: string;
    questionGerman: string;
  }[];
  messageGerman: string;
  source: "deterministic" | "llm";
  model?: string | null;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatResponse = {
  reply: string;
  toolCalls: { name: string; args: Record<string, unknown>; summary: string }[];
};

export function loadAiSettings(token: string) {
  return request<AiSettingsPublic>(token, "/ai/settings");
}

export function saveAiSettings(token: string, body: AiSettingsUpdate) {
  return request<AiSettingsPublic>(token, "/ai/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export type AiModel = { id: string; name: string };

export function loadAiModels(token: string, body: AiSettingsUpdate) {
  return request<{ models: AiModel[] }>(token, "/ai/models", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function testAiConnection(token: string, body?: AiSettingsUpdate) {
  return request<{ ok: boolean; model: string; latencyMs: number; error?: string }>(token, "/ai/test", {
    method: "POST",
    body: JSON.stringify(body ?? {}),
  });
}

export function extractListingWithAi(token: string, id: string) {
  return request<DeskListing>(token, `/ai/extract/${id}`, { method: "POST" });
}

export function loadListingInquiry(token: string, id: string, useLlm = false) {
  return request<DueDiligenceInquiry>(token, `/ai/inquiry/${id}`, {
    method: "POST",
    body: JSON.stringify({ useLlm }),
  });
}

export function sendChatMessage(
  token: string,
  body: { messages: ChatMessage[]; listingId?: string | null },
) {
  return request<ChatResponse>(token, "/ai/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
