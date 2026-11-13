export type Assumptions = {
  equityMode: "percent" | "eur";
  equityPercent: number;
  equityEur: number;
  interestPercent: number;
  termYears: number;
  notaryPercent: number;
  registerPercent: number;
  fallbackCommissionPercent: number;
  monthlyBudgetEur: number | null;
  targetEurPerM2: number | null;
  defaultState: string | null;
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
    locationPrecision: "exact" | null;
    source: string;
    sourceUrl: string;
    propertyType: string;
    priceEur: number | null;
    livingAreaM2: number | null;
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
    features: string[];
    leasehold: boolean;
    snippet: string;
  };
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
    extraEur: number | null;
    cashToCloseEur: number | null;
    equityEur: number | null;
    loanEur: number | null;
    equityCoversCosts: boolean | null;
    monthlyDebt: number | null;
    monthlyHeating: number | null;
    monthlyCondoFee: number | null;
    monthlyGroundRent: number | null;
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
  cohort: { count: number; medianEurPerM2: number | null; deltaPct: number | null };
  rentComparison: {
    rentCount: number;
    medianColdRentEur: number | null;
    monthlyCarryingEur: number | null;
    carryingMinusMedianCold: number | null;
  } | null;
};

const TOKEN_KEY = "duomo.token";

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
      authorization: `Bearer ${token}`,
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

export function loadListings(token: string) {
  return request<DeskListing[]>(token, "/listings");
}

export function saveListing(
  token: string,
  id: string,
  body: { notes?: string; status?: string; latitude?: number; longitude?: number; clearPoint?: boolean },
) {
  return request<DeskListing>(token, `/listings/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function loadAssumptions(token: string) {
  return request<{ assumptions: Assumptions; states: StateOption[] }>(token, "/assumptions");
}

export function saveAssumptions(token: string, assumptions: Assumptions) {
  return request<{ assumptions: Assumptions; states: StateOption[] }>(token, "/assumptions", {
    method: "PUT",
    body: JSON.stringify(assumptions),
  });
}
