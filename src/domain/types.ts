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
  /** Photos and floor plans, hotlinked from the portal CDN. Only the detail route returns them. */
  images: ImageRef[];
};

/** The only hosts an image may be loaded from. The desk's img-src allows the same two. */
export const IMAGE_HOSTS = ["pictures.immobilienscout24.de", "mms.immowelt.de"] as const;
/** Photos and floor plans are capped apart, so many photos never push the plans out. Mirrored in extension/extract.js. */
export const IMAGE_QUOTA = { photo: 30, floorplan: 10 } as const;
export type ImageRef = { url: string; caption: string | null; kind: "photo" | "floorplan" };

export type ParkingType = "garage" | "underground" | "carport" | "outdoor" | "other";
export type ListingDescription = {
  object: string | null;
  furnishing: string | null;
  location: string | null;
  other: string | null;
};
export type DetailPair = { label: string; value: string };

/**
 * Where a number came from.
 *
 * - `user` means the desk owner typed it. A market refresh never moves it.
 * - `market` means the owner accepted a published market figure. A refresh may move it, and the
 *   desk says when it did.
 * - `builtin` means the shipped default. A refresh only offers a suggestion; it never moves it on
 *   its own, so a score stays put until the owner accepts a new figure.
 */
export type Provenance = {
  source: "user" | "market" | "builtin";
  /** The period the figure belongs to, as published. Null when there is no dated source. */
  asOf: string | null;
  /** Who published it, for the desk to show. */
  note: string | null;
};

export const BUILTIN_PROVENANCE: Provenance = { source: "builtin", asOf: null, note: null };

export type Assumptions = {
  equityMode: "percent" | "eur";
  equityPercent: number;
  equityEur: number;
  interestPercent: number;
  /** Where `interestPercent` came from. */
  interestProvenance: Provenance;
  termYears: number;
  /** Years the interest rate is fixed (Zinsbindung). After that the rest of the loan is refinanced at another rate. */
  fixedYears: number;
  notaryPercent: number;
  /** Where `notaryPercent` came from. */
  notaryProvenance: Provenance;
  registerPercent: number;
  /** Where `registerPercent` came from. */
  registerProvenance: Provenance;
  fallbackCommissionPercent: number;
  /** Where `fallbackCommissionPercent` came from. */
  commissionProvenance: Provenance;
  /** Upkeep of a house you own, per m2 of living area and year, before the age factor. A flat's Hausgeld already covers it. */
  maintenanceEurPerM2Year: number;
  /** Grundsteuer for a house you own, per year. */
  propertyTaxEurYear: number;
  /** Building insurance for a house you own, per m2 of living area and year. */
  insuranceEurPerM2Year: number;
  /** How long you would own the home when buying is compared with renting. */
  horizonYears: number;
  /** What money kept out of the home would earn per year. Also the opportunity cost of the equity. */
  equityReturnPercent: number;
  /** How much the home's price is assumed to change per year. */
  appreciationPercent: number;
  /** How much the rent is assumed to rise per year. */
  rentGrowthPercent: number;
  monthlyBudgetEur: number | null;
  targetEurPerM2: number | null;
  defaultState: StateId | null;
};

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  equityMode: "percent",
  equityPercent: 20,
  equityEur: 100000,
  interestPercent: 3.6,
  interestProvenance: BUILTIN_PROVENANCE,
  termYears: 30,
  fixedYears: 10,
  notaryPercent: 1.5,
  notaryProvenance: BUILTIN_PROVENANCE,
  registerPercent: 0.5,
  registerProvenance: BUILTIN_PROVENANCE,
  fallbackCommissionPercent: 3.57,
  commissionProvenance: BUILTIN_PROVENANCE,
  maintenanceEurPerM2Year: 10,
  propertyTaxEurYear: 450,
  insuranceEurPerM2Year: 2.5,
  horizonYears: 10,
  equityReturnPercent: 3,
  appreciationPercent: 1.5,
  rentGrowthPercent: 2,
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
