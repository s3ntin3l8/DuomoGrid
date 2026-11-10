import { annuityMonthly, lookupBenchmark, resolveState, roundEuro, stateById } from "./reference.js";
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

function heatingEuroPerKwh(heating: string | null): number {
  const text = (heating ?? "").toLowerCase();
  if (text.includes("wärme") && text.includes("pump")) return 0.28;
  if (text.includes("warme") && text.includes("pump")) return 0.28;
  if (text.includes("heat") && text.includes("pump")) return 0.28;
  if (text.includes("strom") || text.includes("nacht") || text.includes("electric")) return 0.32;
  if (text.includes("fern") || text.includes("district")) return 0.16;
  if (text.includes("öl") || text.includes("oel") || text.includes("oil")) return 0.1;
  if (text.includes("pellet") || text.includes("holz") || text.includes("wood")) return 0.08;
  if (text.includes("gas")) return 0.11;
  return 0.12;
}

function isOilOrStorage(heating: string | null): boolean {
  const text = (heating ?? "").toLowerCase();
  return text.includes("öl") || text.includes("oel") || text.includes("oil") || text.includes("nacht") || text.includes("night-storage") || text.includes("storage heater");
}

export function analyze(listing: ListingInput, assumptions: Assumptions): Analysis {
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
  let extraEur: number | null = null;
  let cashToCloseEur: number | null = null;
  let equityEur: number | null = null;
  let loanEur: number | null = null;
  let equityCoversCosts: boolean | null = null;
  let monthlyDebt: number | null = null;
  let initialRepaymentPercent: number | null = null;

  if (buy && price != null && price > 0) {
    const priceRounded = roundEuro(price);
    if (stateInfo) {
      transferTaxPercent = stateInfo.tax;
      transferTaxEur = roundEuro((priceRounded * stateInfo.tax) / 100);
    }
    notaryEur = roundEuro((priceRounded * assumptions.notaryPercent) / 100);
    registerEur = roundEuro((priceRounded * assumptions.registerPercent) / 100);
    if (listing.commissionPercent != null) commissionPercent = listing.commissionPercent;
    else {
      commissionPercent = assumptions.fallbackCommissionPercent;
      commissionAssumed = true;
    }
    commissionEur = roundEuro((priceRounded * (commissionPercent ?? 0)) / 100);
    const tax = transferTaxEur ?? 0;
    extraEur = tax + notaryEur + registerEur + commissionEur;
    if (transferTaxEur == null) extraEur = null;
    cashToCloseEur = extraEur == null ? null : priceRounded + extraEur;
    const equityRaw = assumptions.equityMode === "percent" ? (priceRounded * assumptions.equityPercent) / 100 : assumptions.equityEur;
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
  const euroKwh = heatingEuroPerKwh(listing.heating);
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
  if (isOilOrStorage(listing.heating)) {
    flags.push({ severity: "warn", title: "Oil or night-storage heating", detail: "Oil or night-storage heat often means a replacement within a few years. That belongs in the negotiation." });
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
  if (isOilOrStorage(listing.heating)) {
    energyScore = clamp(energyScore - 12);
    energyNote += " · oil or night storage";
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
    const load = extraEur / price;
    costScore = clamp(lerp(load, [[0.06, 94], [0.1, 74], [0.14, 46], [0.18, 24], [0.22, 10]]));
    costNote = `Purchase costs are ${Math.round(load * 1000) / 10} percent of the price`;
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
    commissionPercent, commissionAssumed, commissionEur, extraEur, cashToCloseEur, equityEur, loanEur, equityCoversCosts,
    monthlyDebt, initialRepaymentPercent, monthlyHeating, annualHeating, heatingKwh: kwh,
    heatingEuroPerKwh: listing.propertyType === "land" ? null : euroKwh, monthlyCondoFee, monthlyGroundRent, monthlyTotal,
    monthlyPartial, grossYield, benchmark, benchmarkDeltaPct, subscores: normalized, score, verdict, flags,
  };
}
