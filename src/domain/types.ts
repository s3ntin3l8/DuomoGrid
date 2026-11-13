export const STATES = [
  { id: "BW", name: "Baden-Wuerttemberg", tax: 5 },
  { id: "BY", name: "Bavaria", tax: 3.5 },
  { id: "BE", name: "Berlin", tax: 6 },
  { id: "BB", name: "Brandenburg", tax: 6.5 },
  { id: "HB", name: "Bremen", tax: 5.5 },
  { id: "HH", name: "Hamburg", tax: 5.5 },
  { id: "HE", name: "Hesse", tax: 6 },
  { id: "MV", name: "Mecklenburg-Vorpommern", tax: 6 },
  { id: "NI", name: "Lower Saxony", tax: 5 },
  { id: "NW", name: "North Rhine-Westphalia", tax: 6.5 },
  { id: "RP", name: "Rhineland-Palatinate", tax: 5 },
  { id: "SL", name: "Saarland", tax: 6.5 },
  { id: "SN", name: "Saxony", tax: 5.5 },
  { id: "ST", name: "Saxony-Anhalt", tax: 5 },
  { id: "SH", name: "Schleswig-Holstein", tax: 6.5 },
  { id: "TH", name: "Thuringia", tax: 5 },
] as const;

export type StateId = (typeof STATES)[number]["id"];
export type Offer = "buy" | "rent";
export type PropertyType = "apartment" | "house" | "land" | "multi" | "other";
export type Source = "immobilienscout24" | "immowelt" | "manual";
export type EnergyCert = "consumption" | "demand";
export type ListingStatus = "open" | "visit" | "offer" | "pass";

export type ListingInput = {
  source: Source;
  sourceUrl: string;
  externalId: string | null;
  title: string;
  offer: Offer;
  priceEur: number | null;
  livingAreaM2: number | null;
  plotAreaM2: number | null;
  rooms: number | null;
  city: string;
  district: string | null;
  postalCode: string | null;
  state: StateId | null;
  street: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Set by the server. "exact" means both coordinates came from the exposé. */
  locationPrecision: "exact" | "approximate" | null;
  propertyType: PropertyType;
  yearBuilt: number | null;
  yearRefurbished: number | null;
  energyClass: string | null;
  energyKwh: number | null;
  energyCert: EnergyCert | null;
  heating: string | null;
  condoFeeEur: number | null;
  coldRentEur: number | null;
  warmRentEur: number | null;
  depositEur: number | null;
  rentContract: "open" | "fixed" | "stepped" | "indexed" | null;
  commissionPercent: number | null;
  commissionText: string | null;
  condition: string | null;
  floor: string | null;
  features: string[];
  snippet: string;
  leasehold: boolean;
  groundRentEur: number | null;
  monument: boolean;
  tenantOccupied: boolean;
  /** The heating installation ("Zentralheizung"), not the fuel. `heating` stays the combined label. */
  heatingSystem: string | null;
  /** The fuel or source ("Pellets", "Wärmepumpe", "Gas"), canonical when it is a known one. */
  energySource: string | null;
  parkingSpaces: number | null;
  parkingType: ParkingType | null;
  /** Extra purchase price for the parking space, when the exposé states one. */
  parkingPriceEur: number | null;
  bathrooms: number | null;
  bedrooms: number | null;
  availableFrom: string | null;
  /** When the portal says the listing went online, as an ISO timestamp. */
  listedAt: string | null;
  /** The earlier asking price the portal shows, undated. Not an observation. */
  portalPreviousPriceEur: number | null;
  /** The portal's own EUR/m2 estimate and its range. Display only, area not stated. */
  portalMarketEurPerM2: number | null;
  portalMarketLowEurPerM2: number | null;
  portalMarketHighEurPerM2: number | null;
  /** Long text, as published. Only the detail route returns it. */
  description: ListingDescription | null;
  /** Label and value pairs from the exposé, as published. Only the detail route returns them. */
  details: DetailPair[];
};

export type ParkingType = "garage" | "underground" | "carport" | "outdoor" | "other";
export type ListingDescription = {
  object: string | null;
  furnishing: string | null;
  location: string | null;
  other: string | null;
};
export type DetailPair = { label: string; value: string };

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
  defaultState: StateId | null;
};

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  equityMode: "percent",
  equityPercent: 20,
  equityEur: 100000,
  interestPercent: 3.6,
  termYears: 30,
  notaryPercent: 1.5,
  registerPercent: 0.5,
  fallbackCommissionPercent: 3.57,
  monthlyBudgetEur: null,
  targetEurPerM2: null,
  defaultState: null,
};

export type Flag = {
  severity: "bad" | "warn" | "info" | "good";
  title: string;
  detail: string;
};

export type Subscore = {
  key: string;
  label: string;
  score: number;
  weight: number;
  note: string;
  applicable: boolean;
};
