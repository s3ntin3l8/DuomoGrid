/** Bavarian Bodenrichtwert via the official 2026 WMS. Not a Kaufwert and not an asking price. */
const ENDPOINT = "https://gdi.bayern.de/services/bodenrichtwerte/2026/vboris";
const LAYER = "bodenrichtwerte_2026";
const ABSENT = new Set(["", "-", "null", "keine angabe"]);

export type Bodenrichtwert =
  | { status: "none" }
  | { status: "published"; zone: string; eurPerM2: number; stichtag: string | null }
  | { status: "unpublished"; zone: string; stichtag: string | null };

/** EPSG:4326 on WMS 1.3 is latitude, longitude. A small box around the point is the query. */
export function featureInfoUrl(latitude: number, longitude: number): string {
  const span = 0.0004;
  const url = new URL(ENDPOINT);
  url.searchParams.set("SERVICE", "WMS");
  url.searchParams.set("VERSION", "1.3.0");
  url.searchParams.set("REQUEST", "GetFeatureInfo");
  url.searchParams.set("LAYERS", LAYER);
  url.searchParams.set("QUERY_LAYERS", LAYER);
  url.searchParams.set("INFO_FORMAT", "text/plain");
  url.searchParams.set("CRS", "EPSG:4326");
  url.searchParams.set("BBOX", [latitude - span, longitude - span, latitude + span, longitude + span].join(","));
  url.searchParams.set("WIDTH", "101");
  url.searchParams.set("HEIGHT", "101");
  url.searchParams.set("I", "50");
  url.searchParams.set("J", "50");
  url.searchParams.set("FEATURE_COUNT", "1");
  return url.toString();
}

function field(block: string, key: string): string | null {
  const prefix = `${key} = `;
  const line = block.split("\n").find((row) => row.startsWith(prefix));
  if (!line) return null;
  const value = line.slice(prefix.length).trim();
  if (ABSENT.has(value.toLowerCase())) return null;
  return value;
}

/** German thousands (`2.000`, `1.680`) and a plain integer. Anything else, including 0, is not a value. */
export function parseGermanLandValue(raw: string): number | null {
  const text = raw.trim();
  let normalized: string | null = null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) normalized = text.replaceAll(".", "").replace(",", ".");
  else if (/^\d+(,\d+)?$/.test(text)) normalized = text.replace(",", ".");
  if (normalized == null) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

export function parseBodenrichtwert(body: string): Bodenrichtwert {
  const block = body
    .split("--------------------------------------------")
    .map((part) => part.trim())
    .find((part) => part.includes("bodenrichtwert = ") || part.startsWith("bodenrichtwert ="));
  if (!block) return { status: "none" };
  const name = field(block, "bodenrichtwertszonenname");
  const number = field(block, "bodenrichtwertnummer");
  const zone = name ?? number;
  if (!zone) return { status: "none" };
  const stichtag = field(block, "stichtag");
  const eurPerM2 = parseGermanLandValue(field(block, "bodenrichtwert") ?? "");
  if (eurPerM2 == null) return { status: "unpublished", zone, stichtag };
  return { status: "published", zone, eurPerM2, stichtag };
}

export async function fetchBodenrichtwert(
  latitude: number,
  longitude: number,
  fetcher: typeof fetch = fetch,
): Promise<Bodenrichtwert> {
  const response = await fetcher(featureInfoUrl(latitude, longitude), {
    signal: AbortSignal.timeout(8000),
    headers: { accept: "text/plain" },
  });
  if (!response.ok) throw new Error(`Bodenrichtwert lookup failed (${response.status}).`);
  return parseBodenrichtwert(await response.text());
}
