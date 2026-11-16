/**
 * Household energy prices from Destatis GENESIS. These are the average prices private households
 * paid, including taxes and levies, published half-yearly.
 *
 * The feed needs a GENESIS account. Without one the desk shows no energy prices, and the analysis
 * falls back to its built-in rates. Nothing here is a score input on its own: the desk proposes
 * the rates, and only an accepted value reaches the analysis.
 */

/** The GENESIS tables this reads. */
const ELECTRICITY_TABLE = "61243-0001";
const GAS_TABLE = "61243-0010";

const GENESIS_BASE = "https://genesis.destatis.de/genesisWS/rest/2020/data/tablefile";
const TIMEOUT_MS = 15_000;

/**
 * The consumption class a household heating figure comes from. Destatis publishes a price per
 * class; the class that matches a home's own use is the one that should stand in for it.
 *
 * Destatis writes the thousands with a space ("2 500"), so the labels are matched on the digits
 * with the spaces removed. A literal that carries the spacing exactly would silently stop
 * matching the day the publisher changes a label.
 */
export const ELECTRICITY_CLASS = "2500 bis unter 5000 KWh";
export const GAS_CLASS = "5600 bis unter 55600 KWh";

export type EnergyPrices = {
  /** The half-year the prices belong to, as "YYYY-H1" or "YYYY-H2". */
  asOf: string;
  /** Household electricity price, euro per kWh, including taxes. */
  electricityEurPerKwh: number | null;
  /** The period the electricity price belongs to. The two tables cover different spans. */
  electricityAsOf: string;
  /** Household gas price, euro per kWh, including taxes. */
  gasEurPerKwh: number | null;
  /** The period the gas price belongs to. */
  gasAsOf: string;
  /** Where the numbers came from, for the desk to show. */
  source: string;
  /** When the snapshot was fetched, as an ISO timestamp. */
  fetchedAt: string;
};

export type GenesisCredentials = {
  /** The 32-character GENESIS personal token, or the 10-character user name. */
  username: string;
  /** The password. Omitted when a token is used. */
  password?: string;
};

function cell(text: string): string {
  return text.trim().replace(/^"(.*)"$/s, "$1").trim();
}

/**
 * Parse a GENESIS flat-file CSV into its records.
 *
 * The flat file is semicolon-delimited with a German decimal comma. Each record is one value, with
 * the variables that describe it in labelled columns.
 */
export function parseGenesisCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          current += '"';
          index += 1;
        } else quoted = false;
      } else current += char ?? "";
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ";") {
      row.push(cell(current));
      current = "";
    } else if (char === "\n") {
      row.push(cell(current));
      current = "";
      if (row.length > 1) rows.push(row);
      row = [];
    } else if (char !== "\r") {
      current += char ?? "";
    }
  }
  if (current !== "" || row.length > 0) {
    row.push(cell(current));
    if (row.length > 1) rows.push(row);
  }
  return rows;
}

/** The header row, with the column names in lower case. */
function headerOf(rows: string[][]): string[] {
  const first = rows[0] ?? [];
  return first.map((name) => name.trim().toLowerCase());
}

/** A German decimal comma, or a plain number. A figure that is not a number is not a value. */
function genesisNumber(raw: string): number | null {
  const text = raw.trim();
  if (!text || text === "-" || text === "..." || text === "x" || text === "/") return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

/**
 * Compare a class label from the table with the one this module wants.
 *
 * Destatis writes the thousands with a space ("2 500 bis unter 5 000 KWh"), and the spacing is
 * not part of the class. Both sides are compared without spaces, so a label that is written
 * differently still matches.
 */
function sameClass(label: string, wanted: string): boolean {
  return label.replace(/\s+/g, "").toLowerCase() === wanted.replace(/\s+/g, "").toLowerCase();
}

/**
 * Find the column that carries a variable's label. A flat file has both a code column and a label
 * column for each variable; the label is the readable one.
 */
function variableColumn(header: string[], position: string): number {
  const label = header.findIndex((name) => name.includes(position) && name.endsWith("label"));
  if (label >= 0) return label;
  return header.findIndex((name) => name.includes(position));
}

/**
 * The columns this module reads.
 *
 * The flat file of table 61243-0001 carries four variables before the value: the half-year, the
 * area, the price kind and the consumption class. The price kind is the **third** variable
 * ("Durchschnittspreise inkl. Steuern, Abgaben, Umlagen") and the consumption class the
 * **fourth** ("2 500 bis unter 5 000 KWh"). The second variable is the area ("Deutschland
 * insgesamt"), which says nothing about the price.
 */
const KIND_COLUMN = "3_variable_attribute";
const CLASS_COLUMN = "4_variable_attribute";

/** A price and the period it belongs to. */
export type GenesisPrice = {
  value: number;
  /** The period as "YYYY-H1" or "YYYY-H2". Empty when the table does not name one. */
  period: string;
};

/**
 * The period of one record: the year in the `time` column and the half-year in the first variable.
 */
function recordPeriod(row: string[], timeIndex: number, halfIndex: number): string {
  const year = timeIndex >= 0 ? (row[timeIndex] ?? "").trim() : "";
  if (!/^\d{4}$/.test(year)) return "";
  if (halfIndex < 0) return year;
  const half = (row[halfIndex] ?? "").trim();
  if (/^1\.\s*Halbjahr$/.test(half)) return `${year}-H1`;
  if (/^2\.\s*Halbjahr$/.test(half)) return `${year}-H2`;
  return year;
}

/**
 * Find the price of one consumption class in a GENESIS table.
 *
 * The flat file carries one value per record, with the variables in labelled columns: the year in
 * `time`, the half-year in the first variable, the price kind in the third and the consumption
 * class in the fourth. Only the price including taxes and levies is the one a household pays, so
 * only that one is read.
 *
 * The period comes from the record the price was taken from, not from the table's last row: the
 * newest half-year is published with `...` for the price until Destatis fills it in, and the two
 * tables cover different spans.
 */
export function findGenesisPrice(rows: string[][], consumptionClass: string): GenesisPrice | null {
  const header = headerOf(rows);
  const classIndex = variableColumn(header, CLASS_COLUMN);
  const priceIndex = header.findIndex((name) => name === "value");
  const kindIndex = variableColumn(header, KIND_COLUMN);
  const timeIndex = header.findIndex((name) => name === "time");
  const halfIndex = variableColumn(header, "1_variable_attribute");
  if (priceIndex < 0) return null;
  // Without the class column the table is not the one this expects, so there is no price.
  if (classIndex < 0) return null;
  let best: GenesisPrice | null = null;
  for (const row of rows.slice(1)) {
    if (!sameClass(row[classIndex] ?? "", consumptionClass)) continue;
    const kind = kindIndex >= 0 ? (row[kindIndex] ?? "") : "";
    // Only the price including taxes, levies and surcharges is what a household pays.
    if (kind && !kind.includes("inkl")) continue;
    const value = genesisNumber(row[priceIndex] ?? "");
    if (value == null) continue;
    const period = recordPeriod(row, timeIndex, halfIndex);
    // The newest period wins, so the table's own order does not decide what is current.
    if (!best || period >= best.period) best = { value, period };
  }
  return best;
}

/**
 * The period a table's newest record belongs to. The year is in the `time` column and the
 * half-year in the first variable.
 */
export function findGenesisPeriod(rows: string[][]): string {
  const header = headerOf(rows);
  const halfIndex = variableColumn(header, "1_variable_attribute");
  const timeIndex = header.findIndex((name) => name === "time");
  let best = "";
  for (const row of rows.slice(1)) {
    const period = recordPeriod(row, timeIndex, halfIndex);
    if (period >= best) best = period;
  }
  return best;
}

async function fetchTable(
  table: string,
  credentials: GenesisCredentials,
  fetcher: typeof fetch,
): Promise<string[][]> {
  const body = new URLSearchParams({
    name: table,
    area: "all",
    format: "ffcsv",
    language: "de",
    compress: "false",
    transpose: "false",
    contents: "",
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    username: credentials.username,
  };
  // A token needs no password. Sending an empty one is harmless, but leaving it out is clearer.
  if (credentials.password) headers.password = credentials.password;
  const response = await fetcher(GENESIS_BASE, {
    method: "POST",
    body: body.toString(),
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GENESIS lookup failed (${response.status}).`);
  const buffer = await response.arrayBuffer();
  // The answer is a zip holding one csv.
  const text = await readZipCsv(new Uint8Array(buffer));
  return parseGenesisCsv(text);
}

/**
 * Read the single csv out of a zip. Only stored (uncompressed) and deflated entries are handled,
 * which is what GENESIS returns.
 */
export async function readZipCsv(bytes: Uint8Array): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record sits in the last 22 bytes, plus a comment length.
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("The GENESIS answer is not a zip file.");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("The GENESIS zip is malformed.");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name.toLowerCase().endsWith(".csv")) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = bytes.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return new TextDecoder().decode(data);
      if (method === 8) return new TextDecoder().decode(await inflate(data));
      throw new Error(`The GENESIS zip uses an unsupported compression (${method}).`);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("The GENESIS answer holds no csv file.");
}

/** Inflate a raw deflate stream. Node's zlib is the only way to do this without a dependency. */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const { inflateRaw } = await import("node:zlib");
  const { promisify } = await import("node:util");
  const run = promisify(inflateRaw);
  const result = (await run(data)) as Buffer;
  return new Uint8Array(result);
}

/**
 * Fetch the household energy prices. A table that cannot be read leaves its price null rather
 * than zero, and the other table is still returned.
 */
export async function fetchEnergyPrices(
  credentials: GenesisCredentials | null,
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<EnergyPrices | null> {
  if (!credentials || !credentials.username) return null;
  const [electricity, gas] = await Promise.all([
    fetchTable(ELECTRICITY_TABLE, credentials, fetcher).catch(() => null),
    fetchTable(GAS_TABLE, credentials, fetcher).catch(() => null),
  ]);
  const electricityPrice = electricity ? findGenesisPrice(electricity, ELECTRICITY_CLASS) : null;
  const gasPrice = gas ? findGenesisPrice(gas, GAS_CLASS) : null;
  if (electricityPrice == null && gasPrice == null) return null;
  return {
    // The two tables cover different spans, so each price carries its own period.
    asOf: gasPrice?.period || electricityPrice?.period || "",
    electricityEurPerKwh: electricityPrice?.value ?? null,
    electricityAsOf: electricityPrice?.period ?? "",
    gasEurPerKwh: gasPrice?.value ?? null,
    gasAsOf: gasPrice?.period ?? "",
    source: "Statistisches Bundesamt, Durchschnittspreise für Strom und Gas",
    fetchedAt: now.toISOString(),
  };
}

/**
 * The energy prices are shown in the settings and are not fed into the analysis.
 *
 * The heating rate per fuel lives in `FUEL_RATE` in `src/domain/analyze.ts`. Wiring the published
 * prices into it needs an accepted value per fuel, the way the interest rate has one, and that is
 * tracked as its own issue. Until then the published prices are a readout, and the built-in rates
 * stay in use.
 */
export type EnergyRates = {
  /** The household electricity price, euro per kWh. */
  electric: number | null;
  /** The household gas price, euro per kWh. */
  gas: number | null;
  /** The period each price belongs to. */
  electricAsOf: string;
  gasAsOf: string;
};

export function energyRatesFrom(prices: EnergyPrices | null): EnergyRates | null {
  if (!prices) return null;
  if (prices.electricityEurPerKwh == null && prices.gasEurPerKwh == null) return null;
  return {
    electric: prices.electricityEurPerKwh,
    gas: prices.gasEurPerKwh,
    electricAsOf: prices.electricityAsOf,
    gasAsOf: prices.gasAsOf,
  };
}
