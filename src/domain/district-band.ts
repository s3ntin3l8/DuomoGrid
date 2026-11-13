import fs from "node:fs";
import path from "node:path";
import { fold } from "./reference.js";

/** AK OGA Immobilienmarktbericht 2025. Not the value of one building. */
export const DISTRICT_BAND_FILE = path.resolve("reference/ak-oga/immobilienmarktbericht-2025.csv");

const LAND_NAME: Record<string, string> = {
  BW: "Baden-Württemberg",
  BY: "Bayern",
  BE: "Berlin",
  BB: "Brandenburg",
  HB: "Bremen",
  HH: "Hamburg",
  HE: "Hessen",
  MV: "Mecklenburg-Vorpommern",
  NI: "Niedersachsen",
  NW: "Nordrhein-Westfalen",
  RP: "Rheinland-Pfalz",
  SL: "Saarland",
  SN: "Sachsen",
  ST: "Sachsen-Anhalt",
  SH: "Schleswig-Holstein",
  TH: "Thüringen",
};

export type DistrictRow = {
  name: string;
  stateName: string;
  year: number;
  house: string | null;
  apartment: string | null;
};

export type DistrictSaleBand = {
  name: string;
  stateName: string;
  year: number;
  band: string;
  kind: "apartment" | "house";
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch ?? "";
    } else if (ch === '"') quoted = true;
    else if (ch === ";") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch ?? "";
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function bandCell(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text || text === "-" || text.toUpperCase() === "NA") return null;
  return text;
}

export function parseDistrictBands(csv: string): DistrictRow[] {
  const table = parseCsv(csv);
  const header = table[0] ?? [];
  const column = (name: string) => header.findIndex((cell) => cell.trim() === name);
  const name = column("Subkr_Name_kurz");
  const year = column("BERJ");
  const land = column("B_Land_Name");
  const house = column("Abb_4_55");
  const apartment = column("Abb_4_92");
  if (name < 0 || year < 0 || land < 0 || house < 0 || apartment < 0) return [];
  const rows: DistrictRow[] = [];
  for (const cells of table.slice(1)) {
    const parsedYear = Number(cells[year]);
    const place = (cells[name] ?? "").trim();
    if (!place || !Number.isInteger(parsedYear)) continue;
    rows.push({
      name: place,
      stateName: (cells[land] ?? "").trim(),
      year: parsedYear,
      house: bandCell(cells[house]),
      apartment: bandCell(cells[apartment]),
    });
  }
  return rows;
}

function pick(rows: DistrictRow[], label: string, state: string | null): DistrictRow | null {
  const key = fold(label);
  if (!key) return null;
  const named = rows.filter((row) => fold(row.name) === key);
  if (named.length === 0) return null;
  if (state) {
    const land = LAND_NAME[state];
    const inState = land ? named.filter((row) => row.stateName === land) : [];
    return inState.length === 1 ? inState[0] ?? null : null;
  }
  return named.length === 1 ? named[0] ?? null : null;
}

export function matchDistrictBand(
  rows: DistrictRow[],
  query: { offer: string; propertyType: string; city: string; district: string | null; state: string | null },
): DistrictSaleBand | null {
  if (query.offer !== "buy") return null;
  const kind = query.propertyType === "apartment" ? "apartment" : query.propertyType === "house" ? "house" : null;
  if (!kind) return null;
  const year = rows.reduce((max, row) => Math.max(max, row.year), 0);
  if (!year) return null;
  const current = rows.filter((row) => row.year === year);
  const hit = pick(current, query.city, query.state) ?? (query.district ? pick(current, query.district, query.state) : null);
  if (!hit) return null;
  const band = kind === "apartment" ? hit.apartment : hit.house;
  if (!band) return null;
  return { name: hit.name, stateName: hit.stateName, year: hit.year, band, kind };
}

let cached: DistrictRow[] | null = null;

export function loadDistrictBands(filePath = DISTRICT_BAND_FILE): DistrictRow[] {
  if (filePath === DISTRICT_BAND_FILE && cached) return cached;
  let rows: DistrictRow[];
  try {
    rows = parseDistrictBands(fs.readFileSync(filePath, "utf8"));
  } catch {
    rows = [];
  }
  if (filePath === DISTRICT_BAND_FILE) cached = rows;
  return rows;
}

export function districtSaleBandFor(listing: {
  offer: string;
  propertyType: string;
  city: string;
  district: string | null;
  state: string | null;
}): DistrictSaleBand | null {
  return matchDistrictBand(loadDistrictBands(), listing);
}
