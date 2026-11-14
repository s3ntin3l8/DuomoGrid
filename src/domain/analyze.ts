import { annuityMonthly, lookupBenchmark, resolveState, roundEuro, stateById } from "./reference.js";
import type { Bodenrichtwert } from "./bodenrichtwert.js";
import type { DescriptionFinding } from "./describe.js";
import type { DistrictSaleBand } from "./district-band.js";
import type { PriceHistory } from "./history.js";
import type { Assumptions, Flag, ListingInput, Subscore } from "./types.js";

export type Analysis = {
  offer: ListingInput["offer"];
  stateId: string | null;
  stateName: string | null;
  stateSource: "listing" | "postal" | "default" | null;
  pricePerLivingM2: number | null;
  pricePerPlotM2: number | null;
  pricePerRoom: number | null;
  rentPerM2: number | null;
  transferTaxPercent: number | null;
  transferTaxEur: number | null;
  notaryEur: number | null;
  registerEur: number | null;
  commissionPercent: number | null;
  commissionAssumed: boolean;
  commissionEur: number | null;
  /** Parking bought with the home: unit price times the spaces. It is part of what taxes and fees are charged on. */
  parkingEur: number | null;
  parkingUnitEur: number | null;
  parkingSpaces: number | null;
  parkingSpacesAssumed: boolean;
  extraEur: number | null;
  cashToCloseEur: number | null;
  equityEur: number | null;
  loanEur: number | null;
  equityCoversCosts: boolean | null;
  monthlyDebt: number | null;
  initialRepaymentPercent: number | null;
  monthlyHeating: number | null;
  annualHeating: number | null;
  heatingKwh: number | null;
  heatingEuroPerKwh: number | null;
  monthlyCondoFee: number | null;
  monthlyGroundRent: number | null;
  monthlyTotal: number | null;
  monthlyPartial: number | null;
  grossYield: number | null;
  benchmark: { label: string; eurPerM2: number } | null;
  benchmarkDeltaPct: number | null;
  subscores: Subscore[];
  score: number | null;
  verdict: string;
  flags: Flag[];
};

const CLASS_KWH: Record<string, number> = {
  "A+": 20, A: 40, B: 62, C: 88, D: 115, E: 145, F: 180, G: 225, H: 280,
};
const CLASS_SCORE: Record<string, number> = {
  "A+": 100, A: 90, B: 78, C: 64, D: 50, E: 36, F: 22, G: 12, H: 6,
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(ratio: number, points: [number, number][]): number {
  if (ratio <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    const [x0, y0] = points[index - 1];
    const [x1, y1] = points[index];
    if (ratio <= x1) return y0 + ((ratio - x0) / (x1 - x0)) * (y1 - y0);
  }
  return points[points.length - 1][1];
}

type Fuel = "heatpump" | "electric" | "storage" | "district" | "oil" | "biomass" | "biogas" | "gas";

const FUEL_RATE: Record<Fuel, number> = {
  heatpump: 0.28,
  electric: 0.32,
  storage: 0.32,
  district: 0.16,
  oil: 0.1,
  biomass: 0.08,
  biogas: 0.11,
  gas: 0.11,
};

/**
 * What the home is heated with, decided once and used for the rate, the energy adjustment and the flags, so they cannot
 * disagree. The fuel the exposé names wins; the combined heating label only stands in when none is named. A fuel that
 * is named but not recognised is unknown, not read from the label. Renewable and district heat are checked before
 * gas, so "Fernwärme aus Gas" is district heat and "Biogas" is not fossil.
 */
function fuelOf(listing: ListingInput): Fuel | null {
  const text = (listing.energySource ?? listing.heating ?? "").toLowerCase();
  if (!text.trim()) return null;
  if (/w(ä|ae|a)rmepumpe|heat.?pump|erdw|geotherm/.test(text)) return "heatpump";
  if (/nacht|night|storage heater/.test(text)) return "storage";
  if (/strom|electric|elektro|infrarot|direktheiz/.test(text)) return "electric";
  if (/fern|district/.test(text)) return "district";
  // "Ölheizung" and "Öl-Zentralheizung" are compounds, so Öl only has to start a word. "boiler" is not oil.
  if (/(^|[^a-zäöü])(öl|oel)|(^|[^a-z])oil([^a-z]|$)|heiz(ö|oe)l/.test(text)) return "oil";
  if (/pellet|holz|wood|hackschnitzel/.test(text)) return "biomass";
  if (/bio-?gas/.test(text)) return "biogas";
  if (text.includes("gas")) return "gas";
  return null;
}

function figure(value: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value);
}

function bandRange(band: string): { floor: number | null; ceiling: number | null } | null {
  const text = band.trim();
  const bounded = text.match(/^(\d+)\s+bis unter\s+(\d+)$/);
  if (bounded) {
    const floor = Number(bounded[1]);
    const ceiling = Number(bounded[2]);
    if (floor > 0 && ceiling > floor) return { floor, ceiling };
    return null;
  }
  const open = text.match(/^(\d+)\s+und mehr$/);
  if (open) {
    const floor = Number(open[1]);
    return floor > 0 ? { floor, ceiling: null } : null;
  }
  const under = text.match(/^bis unter\s+(\d+)$/);
  if (under) {
    const ceiling = Number(under[1]);
    return ceiling > 0 ? { floor: null, ceiling } : null;
  }
  return null;
}

function landValueFlag(
  buy: boolean,
  listing: ListingInput,
  price: number | null,
  pricePerLivingM2: number | null,
  land: Bodenrichtwert | null | undefined,
): Flag | null {
  if (!buy || price == null || price <= 0 || !land || land.status !== "published" || !(land.eurPerM2 > 0)) return null;
  const eur = land.eurPerM2;
  const zone = land.zone ? ` (${land.zone})` : "";
  const approximate = listing.locationPrecision === "approximate";
  const caveat = approximate ? " The listing's location is approximate, so the zone may not be the one this building is in." : "";
  const plot = listing.plotAreaM2;
  if (plot != null && plot > 0) {
    const total = eur * plot;
    const living = pricePerLivingM2 != null ? `, ${figure(pricePerLivingM2)} EUR/m2 of living area` : "";
    const detail = `The Bodenrichtwert is ${figure(eur)} EUR/m2 of land${zone}, about ${figure(roundEuro(total))} EUR for this ${figure(plot)} m2 plot. The asking price is ${figure(roundEuro(price))} EUR${living}. This compares the two totals in EUR. It does not compare the land value with the price per m2 of living area.${caveat}`;
    if (price < total && !approximate) return { severity: "good", title: "Asking price is under the plot's land value", detail };
    return { severity: "info", title: "Asking price against the Bodenrichtwert", detail };
  }
  if (pricePerLivingM2 == null) {
    return {
      severity: "info",
      title: "Bodenrichtwert is a land value",
      detail: `The Bodenrichtwert is ${figure(eur)} EUR/m2 of land${zone}. The asking price is ${figure(roundEuro(price))} EUR. There is no plot area, so this is not a comparison of two totals.${caveat}`,
    };
  }
  return {
    severity: "info",
    title: "Bodenrichtwert is a land value",
    detail: `The Bodenrichtwert is ${figure(eur)} EUR/m2 of land${zone}. The asking price is ${figure(pricePerLivingM2)} EUR/m2 of living area. These are not the same unit.${caveat}`,
  };
}

function districtBandFlag(
  buy: boolean,
  listing: ListingInput,
  pricePerLivingM2: number | null,
  band: DistrictSaleBand | null | undefined,
): Flag | null {
  if (!buy || !band || pricePerLivingM2 == null || !(pricePerLivingM2 > 0)) return null;
  // matchDistrictBand already ties kind to propertyType. Refuse a hand-built mismatch anyway.
  if (band.kind !== listing.propertyType) return null;
  const range = bandRange(band.band);
  if (!range) return null;
  const kind = band.kind === "apartment" ? "used apartments" : "detached and semi-detached houses";
  const detail = `Asking price is ${figure(pricePerLivingM2)} EUR/m2 of living area. The district sale band for ${kind} in ${band.name} (${band.year}) is "${band.band}". This is not the value of this building.`;
  if (range.floor != null && pricePerLivingM2 < range.floor) return { severity: "good", title: "Below the district sale band", detail };
  if (range.ceiling != null && pricePerLivingM2 >= range.ceiling) return { severity: "warn", title: "Above the district sale band", detail };
  return { severity: "info", title: "Inside the district sale band", detail };
}

export type AnalysisContext = {
  bodenrichtwert?: Bodenrichtwert | null;
  districtSaleBand?: DistrictSaleBand | null;
  /** Facts read from the description. A few become flags; none is a score input. */
  findings?: DescriptionFinding[];
  /** From the description, so it is a hint and never a stored column. Feeds the energy subscore. */
  heatingReplacedYear?: number | null;
  history?: Pick<PriceHistory, "firstKnownPriceEur" | "totalChangeEur" | "totalChangePct" | "reductions" | "daysOnMarket" | "startedBasis"> | null;
  /** For tests. Defaults to the current year. */
  nowYear?: number;
};

export function analyze(listing: ListingInput, assumptions: Assumptions, market: AnalysisContext = {}): Analysis {
  const state = resolveState(listing, assumptions);
  const stateInfo = stateById(state.id);
  const buy = listing.offer === "buy";
  const price = listing.priceEur;
  const living = listing.livingAreaM2;
  const plot = listing.plotAreaM2;
  const benchmark = listing.propertyType === "apartment" ? lookupBenchmark(listing.city) : null;
  const pricePerLivingM2 = buy && price != null && living != null && living > 0 ? price / living : null;
  const pricePerPlotM2 = buy && price != null && plot != null && plot > 0 ? price / plot : null;
  const pricePerRoom = buy && price != null && listing.rooms != null && listing.rooms > 0 ? price / listing.rooms : null;
  const rentBasis = listing.coldRentEur ?? (listing.offer === "rent" ? price : null);
  const rentPerM2 = rentBasis != null && living != null && living > 0 ? rentBasis / living : null;
  const reference = assumptions.targetEurPerM2 && assumptions.targetEurPerM2 > 0 ? assumptions.targetEurPerM2 : (benchmark?.eurPerM2 ?? null);
  const benchmarkDeltaPct = pricePerLivingM2 != null && benchmark ? ((pricePerLivingM2 - benchmark.eurPerM2) / benchmark.eurPerM2) * 100 : null;

  let transferTaxPercent: number | null = null;
  let transferTaxEur: number | null = null;
  let notaryEur: number | null = null;
  let registerEur: number | null = null;
  let commissionPercent: number | null = null;
  let commissionAssumed = false;
  let commissionEur: number | null = null;
  let parkingEur: number | null = null;
  let parkingUnitEur: number | null = null;
  let parkingSpaces: number | null = null;
  let parkingSpacesAssumed = false;
  let extraEur: number | null = null;
  let cashToCloseEur: number | null = null;
  let equityEur: number | null = null;
  let loanEur: number | null = null;
  let equityCoversCosts: boolean | null = null;
  let monthlyDebt: number | null = null;
  let initialRepaymentPercent: number | null = null;

  if (buy && price != null && price > 0) {
    // A parking space sold with the home is part of the same purchase, so taxes and fees are charged on it too.
    // Without a stated price nothing is added, and it is never counted as zero.
    if (listing.parkingPriceEur != null && listing.parkingPriceEur > 0) {
      parkingUnitEur = roundEuro(listing.parkingPriceEur);
      parkingSpaces = listing.parkingSpaces ?? 1;
      parkingSpacesAssumed = listing.parkingSpaces == null;
      parkingEur = roundEuro(parkingUnitEur * parkingSpaces);
    }
    const purchaseBase = roundEuro(price) + (parkingEur ?? 0);
    if (stateInfo) {
      transferTaxPercent = stateInfo.tax;
      transferTaxEur = roundEuro((purchaseBase * stateInfo.tax) / 100);
    }
    notaryEur = roundEuro((purchaseBase * assumptions.notaryPercent) / 100);
    registerEur = roundEuro((purchaseBase * assumptions.registerPercent) / 100);
    if (listing.commissionPercent != null) commissionPercent = listing.commissionPercent;
    else {
      commissionPercent = assumptions.fallbackCommissionPercent;
      commissionAssumed = true;
    }
    commissionEur = roundEuro((purchaseBase * (commissionPercent ?? 0)) / 100);
    const tax = transferTaxEur ?? 0;
    extraEur = tax + notaryEur + registerEur + commissionEur;
    if (transferTaxEur == null) extraEur = null;
    cashToCloseEur = extraEur == null ? null : purchaseBase + extraEur;
    const equityRaw = assumptions.equityMode === "percent" ? (purchaseBase * assumptions.equityPercent) / 100 : assumptions.equityEur;
    equityEur = roundEuro(Math.max(0, equityRaw));
    if (cashToCloseEur != null) {
      loanEur = Math.max(0, cashToCloseEur - equityEur);
      equityCoversCosts = extraEur != null ? equityEur + 1 >= extraEur : null;
      monthlyDebt = roundEuro(annuityMonthly(loanEur, assumptions.interestPercent, assumptions.termYears));
      if (loanEur > 0) {
        const yearly = monthlyDebt * 12;
        const interest = loanEur * (assumptions.interestPercent / 100);
        initialRepaymentPercent = ((yearly - interest) / loanEur) * 100;
      } else initialRepaymentPercent = 0;
    }
  }

  const kwh = listing.energyKwh != null && listing.energyKwh > 0 ? listing.energyKwh : listing.energyClass ? (CLASS_KWH[listing.energyClass] ?? null) : null;
  const fuel = fuelOf(listing);
  const euroKwh = fuel ? FUEL_RATE[fuel] : 0.12;
  const annualHeating = kwh != null && living != null && living > 0 && listing.propertyType !== "land" ? roundEuro(kwh * living * euroKwh) : null;
  const monthlyHeating = annualHeating != null ? roundEuro(annualHeating / 12) : null;
  const monthlyCondoFee = listing.condoFeeEur != null ? roundEuro(listing.condoFeeEur) : listing.propertyType === "house" ? 0 : null;
  const monthlyGroundRent = listing.leasehold ? roundEuro(listing.groundRentEur ?? 0) : 0;
  const monthlyParts = [monthlyDebt, monthlyHeating, monthlyCondoFee, listing.leasehold ? monthlyGroundRent : 0];
  const knownMonthly = monthlyParts.filter((part): part is number => part != null);
  const monthlyPartial = knownMonthly.length ? knownMonthly.reduce((sum, part) => sum + part, 0) : null;
  const monthlyComplete = buy && monthlyParts.every((part) => part != null);
  const monthlyTotal = monthlyComplete ? (monthlyParts as number[]).reduce((sum, part) => sum + part, 0) : null;
  const grossYield = buy && price != null && price > 0 && listing.coldRentEur != null && listing.coldRentEur > 0 ? ((listing.coldRentEur * 12) / price) * 100 : null;

  const flags: Flag[] = [];
  if (!buy) {
    flags.push({ severity: "info", title: "Rental listing", detail: "Purchase costs and financing do not apply. Cold rent, area, and energy are what this row is for." });
  }
  if (listing.leasehold) {
    flags.push({
      severity: "bad",
      title: "Leasehold",
      detail: listing.groundRentEur ? `Not freehold. Ground rent is about ${listing.groundRentEur} EUR per month, on top of the loan.` : "Not freehold. The price per square meter is not comparable with freehold homes.",
    });
  }
  if (listing.monument) {
    flags.push({ severity: "warn", title: "Listed building", detail: "Tax depreciation can help. Facade, windows, and floor plan are often restricted and more expensive to change." });
  }
  if (listing.propertyType !== "land" && buy && !listing.energyClass && listing.energyKwh == null) {
    flags.push({ severity: "bad", title: "Energy certificate missing", detail: "Without a class or a figure, future heating cost is a guess. Ask for it before making an offer." });
  }
  if (listing.energyCert === "consumption") {
    flags.push({ severity: "info", title: "Consumption certificate", detail: "The figure depends on how the last occupants lived. A demand certificate says more about the building." });
  }
  const oilOrStorage = fuel === "oil" || fuel === "storage";
  const gas = fuel === "gas";
  // Both heating flags are about what a buyer will have to replace, so neither is shown on a rental.
  if (buy && oilOrStorage) {
    flags.push({ severity: "warn", title: "Oil or night-storage heating", detail: "Oil or night-storage heat often means a replacement within a few years. That belongs in the negotiation." });
  }
  if (buy && gas) {
    flags.push({
      severity: "warn",
      title: "Fossil heating may need replacing",
      detail: "The heating runs on gas. Rules under the German heating law (GEG) can force a replacement or a switch to renewable heat. Ask how old the boiler is and budget for it.",
    });
  }
  if (listing.yearBuilt != null && listing.yearBuilt < 1978 && (listing.yearRefurbished == null || listing.yearRefurbished < 2010) && listing.energyClass && ["E", "F", "G", "H"].includes(listing.energyClass)) {
    flags.push({ severity: "warn", title: "Unrenovated building", detail: `Built in ${listing.yearBuilt}, class ${listing.energyClass}, no visible renovation after 2010.` });
  }
  if (listing.floor && /souterrain|keller|untergeschoss|basement|\bug\b/i.test(listing.floor)) {
    flags.push({ severity: "warn", title: "Below-ground floor", detail: "Light, moisture, and resale are more fragile for basement flats." });
  }
  if (listing.condoFeeEur != null && living != null && living > 0 && listing.condoFeeEur / living > 4.2) {
    flags.push({ severity: "warn", title: "High condo fee", detail: `${(listing.condoFeeEur / living).toFixed(2)} EUR/m2 per month. Check the reserve and the management cost.` });
  }
  if (buy && equityCoversCosts === false) {
    flags.push({ severity: "bad", title: "Equity does not cover purchase costs", detail: "Many lenders will finance the price, but not transfer tax, the notary, or the agent." });
  }
  if (buy && listing.propertyType === "apartment" && listing.condoFeeEur == null) {
    flags.push({ severity: "info", title: "Condo fee missing", detail: "Without the condo fee the monthly cost is incomplete. It is usually in the costs section of the listing." });
  }
  if (listing.commissionPercent === 0) {
    flags.push({ severity: "good", title: "No buyer commission", detail: "The buyer commission is zero, which lowers the cash needed at closing." });
  } else if (commissionAssumed && buy) {
    flags.push({ severity: "info", title: "Commission assumed", detail: `The listing did not state one. Calculated with a ${assumptions.fallbackCommissionPercent} percent buyer share.` });
  }
  if (listing.tenantOccupied) {
    flags.push({ severity: "info", title: "Tenant occupied", detail: "Moving in depends on notice rules. For an investment, set the rent against the condo fee." });
  }
  if (benchmark && benchmarkDeltaPct != null && listing.propertyType === "apartment") {
    if (benchmarkDeltaPct <= -8) {
      flags.push({ severity: "good", title: "Below the city guide price", detail: `${Math.abs(Math.round(benchmarkDeltaPct))} percent under a rough ${benchmark.eurPerM2} EUR/m2 for existing apartments. Location and condition often explain the gap.` });
    } else if (benchmarkDeltaPct >= 18) {
      flags.push({ severity: "warn", title: "Well above the city guide price", detail: `${Math.round(benchmarkDeltaPct)} percent over a rough ${benchmark.eurPerM2} EUR/m2. A new build or a micro-location can justify that, or not.` });
    }
  }
  if (assumptions.monthlyBudgetEur && monthlyTotal != null && monthlyTotal > assumptions.monthlyBudgetEur) {
    flags.push({ severity: "warn", title: "Above the monthly budget", detail: "Loan, condo fee, heating, and ground rent together sit above the budget you set." });
  }
  if (listing.yearBuilt != null && listing.yearBuilt >= 2020) {
    flags.push({ severity: "good", title: "New build", detail: "Warranty and energy use are usually easier. Still read the condo fee and the maintenance reserve." });
  }
  if (listing.energyClass && ["A+", "A", "B"].includes(listing.energyClass)) {
    flags.push({ severity: "good", title: "Energy is not a concern", detail: `Class ${listing.energyClass}. Heating load is not the first argument against this home.` });
  }
  if (/zwangsversteigerung|foreclosure/i.test(`${listing.title} ${listing.snippet}`)) {
    flags.push({ severity: "warn", title: "Foreclosure auction", detail: "Viewing, vacancy, and the bidding process are not a normal purchase contract." });
  }
  const landFlag = landValueFlag(buy, listing, price, pricePerLivingM2, market.bodenrichtwert);
  if (landFlag) flags.push(landFlag);
  const bandFlag = districtBandFlag(buy, listing, pricePerLivingM2, market.districtSaleBand);
  if (bandFlag) flags.push(bandFlag);

  // Flags only. None of the following feeds a subscore.
  if (buy && parkingEur != null && parkingUnitEur != null && parkingSpaces != null) {
    const count = parkingSpacesAssumed ? "One space is assumed because the exposé gives no number. " : "";
    const reading =
      parkingSpaces > 1
        ? `The exposé gives one price, read here as the price per space. If it is the total for all ${parkingSpaces} spaces, the cash needed is ${figure(parkingEur - parkingUnitEur)} EUR lower. `
        : "";
    flags.push({
      severity: "info",
      title: "Parking is priced separately",
      detail: `${parkingSpaces} ${parkingSpaces === 1 ? "space" : "spaces"} at ${figure(parkingUnitEur)} EUR, ${figure(parkingEur)} EUR in all. ${count}${reading}It is added to the amount that transfer tax, notary, land register and commission are charged on, and to the cash needed. If you do not want the space, ask whether it can be left out.`,
    });
  }
  const history = market.history;
  if (buy && history && history.reductions > 0 && history.totalChangePct != null && history.totalChangePct <= -1 && history.firstKnownPriceEur != null) {
    const cutTimes = history.reductions === 1 ? "once" : `${history.reductions} times`;
    flags.push({
      severity: history.totalChangePct <= -5 ? "good" : "info",
      title: "Price has been reduced",
      detail: `Down ${figure(Math.abs(Math.round(history.totalChangeEur ?? 0)))} EUR (${figure(Math.abs(Math.round(history.totalChangePct * 10) / 10))} percent) from the first known ${figure(history.firstKnownPriceEur)} EUR, cut ${cutTimes}. A seller who has cut before may be open to a further offer.`,
    });
  }
  if (buy && history && history.startedBasis === "portal" && history.daysOnMarket >= 120) {
    flags.push({
      severity: "info",
      title: "Long on the market",
      detail: `Online on the portal for ${history.daysOnMarket} days. That can mean room to negotiate, or a reason the market has passed on it.`,
    });
  }
  if (buy && pricePerLivingM2 != null && listing.portalMarketEurPerM2 != null && listing.portalMarketEurPerM2 > 0) {
    const gap = ((pricePerLivingM2 - listing.portalMarketEurPerM2) / listing.portalMarketEurPerM2) * 100;
    if (Math.abs(gap) >= 8) {
      flags.push({
        severity: "info",
        title: gap < 0 ? "Below the portal's own estimate" : "Above the portal's own estimate",
        detail: `${figure(Math.round(Math.abs(gap)))} percent ${gap < 0 ? "under" : "over"} the portal's ${figure(Math.round(listing.portalMarketEurPerM2))} EUR/m2 for similar objects. The portal does not say which area that covers, and it is not part of the score.`,
      });
    }
  }
  const findings = market.findings ?? [];
  const levy = findings.find((finding) => finding.key === "special_levy");
  if (buy && levy) {
    flags.push({ severity: "warn", title: "Special levy mentioned", detail: `The description mentions a special levy: "${levy.snippet}" Ask the management for the minutes and the reserve.` });
  }
  const leaseText = findings.find((finding) => finding.key === "leasehold");
  if (buy && leaseText && !listing.leasehold) {
    flags.push({
      severity: "warn",
      title: "Leasehold mentioned in the text",
      detail: `The listing is not marked as leasehold, but the description says: "${leaseText.snippet}" Check the land register before you rely on the price per square meter.`,
    });
  }

  const energyApplicable = listing.propertyType !== "land" && buy;
  let energyScore = 35;
  let energyNote = "Energy certificate missing";
  if (listing.energyClass && CLASS_SCORE[listing.energyClass] != null) {
    energyScore = CLASS_SCORE[listing.energyClass];
    energyNote = `Class ${listing.energyClass}`;
    if (listing.energyKwh == null) energyNote += ", figure estimated from the class";
  } else if (listing.energyKwh != null) {
    energyScore = clamp(lerp(listing.energyKwh, [[30, 100], [50, 90], [75, 78], [100, 64], [130, 50], [160, 36], [200, 22], [250, 8]]));
    energyNote = `${Math.round(listing.energyKwh)} kWh/(m2*a)`;
  }
  // One adjustment for the heating, never a stack: the worst applicable penalty, or a bonus only when there is none.
  const nowYear = market.nowYear ?? new Date().getFullYear();
  const heatingAge = market.heatingReplacedYear != null ? nowYear - market.heatingReplacedYear : null;
  // Direct electric heat is priced at its real cost (0.32) but takes no energy adjustment, deliberately: only oil, night
  // storage and gas are penalised, as before, and the energy class already carries the electric case.
  // A stated heat pump or district heat is not made old by a boiler's age.
  const oldHeating = heatingAge != null && heatingAge >= 30 && fuel !== "heatpump" && fuel !== "district";
  if (oilOrStorage) {
    energyScore = clamp(energyScore - 12);
    energyNote += " · oil or night storage";
  } else if (gas) {
    energyScore = clamp(energyScore - 8);
    energyNote += " · gas heating";
  } else if (oldHeating) {
    energyScore = clamp(energyScore - 8);
    energyNote += ` · heating from ${market.heatingReplacedYear}`;
  } else if (fuel === "heatpump" || fuel === "district") {
    energyScore = clamp(energyScore + 5);
    energyNote += " · heat pump or district heat";
  }

  let priceScore = 58;
  let priceNote = "No target and no city guide price";
  if (listing.leasehold) {
    priceScore = Math.min(priceScore, 42);
    priceNote = "Leasehold — do not compare this price with freehold";
  }
  if (pricePerLivingM2 != null && reference != null && !listing.leasehold) {
    const ratio = pricePerLivingM2 / reference;
    priceScore = clamp(lerp(ratio, [[0.75, 100], [1, 68], [1.25, 40], [1.6, 8]]));
    priceNote = assumptions.targetEurPerM2 ? `Against your target of ${Math.round(reference)} EUR/m2` : `Against a guide of ${Math.round(reference)} EUR/m2`;
  } else if (listing.propertyType === "land" && pricePerPlotM2 != null) {
    priceNote = "Plot, no living-area comparison";
    priceScore = 55;
  }
  if (listing.leasehold && pricePerLivingM2 != null) {
    priceScore = Math.min(priceScore, 42);
    priceNote = "Leasehold — do not compare this price per square meter with freehold";
  }

  let costScore = 50;
  let costNote = "State is missing, so transfer tax is open";
  const costApplicable = Boolean(buy && price != null && extraEur != null && price > 0);
  if (costApplicable && price != null && extraEur != null) {
    const load = extraEur / (price + (parkingEur ?? 0));
    costScore = clamp(lerp(load, [[0.06, 94], [0.1, 74], [0.14, 46], [0.18, 24], [0.22, 10]]));
    costNote = `Purchase costs are ${Math.round(load * 1000) / 10} percent of the ${parkingEur != null ? "price plus parking" : "price"}`;
    if (commissionAssumed) costNote += " · commission assumed";
  }

  let budgetScore = 60;
  let budgetNote = "No monthly budget set";
  const budgetApplicable = Boolean(buy && monthlyTotal != null && assumptions.monthlyBudgetEur && assumptions.monthlyBudgetEur > 0);
  if (budgetApplicable && assumptions.monthlyBudgetEur && monthlyTotal != null) {
    const ratio = monthlyTotal / assumptions.monthlyBudgetEur;
    budgetScore = clamp(lerp(ratio, [[0.7, 100], [1, 70], [1.15, 40], [1.4, 12]]));
    budgetNote = ratio <= 1 ? "Inside the budget you set" : `${Math.round((ratio - 1) * 100)} percent over the budget`;
  }

  const dataChecks = [
    price != null,
    living != null || plot != null,
    listing.rooms != null,
    listing.city.trim().length > 0,
    state.id != null,
    listing.yearBuilt != null || listing.propertyType === "land",
    listing.propertyType === "land" || listing.energyClass != null || listing.energyKwh != null,
    listing.heating != null || listing.propertyType === "land",
  ];
  const dataScore = Math.round((dataChecks.filter(Boolean).length / dataChecks.length) * 100);
  const dataNote = `${dataChecks.filter(Boolean).length} of ${dataChecks.length} core fields are present`;
  const parts: Subscore[] = [
    { key: "price", label: "Price", score: priceScore, weight: 0.35, note: priceNote, applicable: buy && (pricePerLivingM2 != null || pricePerPlotM2 != null) },
    { key: "energy", label: "Energy", score: energyScore, weight: 0.25, note: energyNote, applicable: energyApplicable },
    { key: "costs", label: "Purchase costs", score: costScore, weight: 0.15, note: costNote, applicable: costApplicable },
    { key: "budget", label: "Affordability", score: budgetScore, weight: 0.15, note: budgetNote, applicable: budgetApplicable },
    { key: "data", label: "Data", score: dataScore, weight: 0.1, note: dataNote, applicable: true },
  ];
  const used = parts.filter((part) => part.applicable);
  const weightSum = used.reduce((sum, part) => sum + part.weight, 0) || 1;
  const normalized = parts.map((part) => ({ ...part, weight: part.applicable ? part.weight / weightSum : 0, score: Math.round(part.score) }));
  const score = buy ? Math.round(normalized.filter((part) => part.applicable).reduce((sum, part) => sum + part.score * part.weight, 0)) : null;
  const verdict = score == null ? "rent" : score >= 80 ? "workable" : score >= 65 ? "worth a look" : score >= 50 ? "mixed" : "careful";

  return {
    offer: listing.offer, stateId: state.id, stateName: stateInfo?.name ?? null, stateSource: state.source,
    pricePerLivingM2, pricePerPlotM2, pricePerRoom, rentPerM2, transferTaxPercent, transferTaxEur, notaryEur, registerEur,
    commissionPercent, commissionAssumed, commissionEur, parkingEur, parkingUnitEur, parkingSpaces, parkingSpacesAssumed,
    extraEur, cashToCloseEur, equityEur, loanEur, equityCoversCosts,
    monthlyDebt, initialRepaymentPercent, monthlyHeating, annualHeating, heatingKwh: kwh,
    heatingEuroPerKwh: listing.propertyType === "land" ? null : euroKwh, monthlyCondoFee, monthlyGroundRent, monthlyTotal,
    monthlyPartial, grossYield, benchmark, benchmarkDeltaPct, subscores: normalized, score, verdict, flags,
  };
}
