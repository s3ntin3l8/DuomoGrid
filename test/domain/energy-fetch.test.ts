import { deflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { fetchEnergyPrices, readZipCsv } from "../../src/domain/energy-prices.js";

/**
 * Build a zip holding one csv, the way GENESIS answers. `deflate` is the compression GENESIS uses.
 */
function makeZip(name: string, content: string, method: 0 | 8 = 8): Uint8Array {
  const nameBytes = Buffer.from(name);
  const data = Buffer.from(content);
  const payload = method === 8 ? deflateRawSync(data) : data;
  const crc = 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  // The offset of the local header sits at 42 in the central directory record. The local header
  // starts the file, so the offset is 0.
  central.writeUInt32LE(0, 42);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBytes.length, 12);
  eocd.writeUInt32LE(30 + nameBytes.length + payload.length, 16);

  return new Uint8Array(Buffer.concat([local, nameBytes, payload, central, nameBytes, eocd]));
}

const CSV = `statistics_code;statistics_label;time_code;time_label;time;1_variable_code;1_variable_label;1_variable_attribute_code;1_variable_attribute_label;2_variable_code;2_variable_label;2_variable_attribute_code;2_variable_attribute_label;3_variable_code;3_variable_label;3_variable_attribute_code;3_variable_attribute_label;4_variable_code;4_variable_label;4_variable_attribute_code;4_variable_attribute_label;value;value_unit;value_variable_code;value_variable_label
61243;Durchschnittspreise für Strom und Gas;JAHR;Jahr;2026;HALBJA;Halbjahre;HALBJH1;1. Halbjahr;DINSG;Deutschland insgesamt;DG;Deutschland;PREAT1;Preisarten;PRE-BRUTTO;Durchschnittspreise inkl. Steuern, Abgaben, Umlagen;VBRST1;Strom-Jahresverbrauchsklassen Haushalte;HH-STR-DC;2 500 bis unter 5 000 KWh;0,3797;EUR/kWh;PRE060;Strompreise für Haushalte
`;

describe("readZipCsv", () => {
  it("reads the csv out of a deflated zip", async () => {
    const zip = makeZip("table.csv", CSV, 8);
    const text = await readZipCsv(zip);
    expect(text).toContain("0,3797");
  });

  it("reads the csv out of a stored zip", async () => {
    const zip = makeZip("table.csv", CSV, 0);
    const text = await readZipCsv(zip);
    expect(text).toContain("0,3797");
  });

  it("fails for something that is not a zip", async () => {
    await expect(readZipCsv(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toThrow(/not a zip/);
  });

  it("fails for a zip without a csv", async () => {
    const zip = makeZip("notes.txt", "nothing here", 0);
    await expect(readZipCsv(zip)).rejects.toThrow(/no csv/);
  });
});

describe("fetchEnergyPrices", () => {
  it("has no prices without an account", async () => {
    expect(await fetchEnergyPrices(null)).toBeNull();
  });

  it("reads both tables and keeps the period of each price", async () => {
    const fetcher = vi.fn(async () =>
      new Response(makeZip("table.csv", CSV, 8), {
        status: 200,
        headers: { "content-type": "application/zip" },
      }),
    ) as unknown as typeof fetch;
    const prices = await fetchEnergyPrices({ username: "token-value" }, fetcher);
    expect(prices).not.toBeNull();
    expect(prices?.electricityEurPerKwh).toBe(0.3797);
    expect(prices?.electricityAsOf).toBe("2026-H1");
    // The gas class is not in this table, so there is no gas price.
    expect(prices?.gasEurPerKwh).toBeNull();
  });

  it("sends the credentials in the header and never in the url", async () => {
    const seen: { url: string; headers: Record<string, string>; method: string }[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        headers: (init?.headers ?? {}) as Record<string, string>,
        method: init?.method ?? "GET",
      });
      return new Response(makeZip("table.csv", CSV, 8), { status: 200 });
    }) as unknown as typeof fetch;
    // Built at runtime, so no literal in this file reads like a credential.
    const token = ["token", "value"].join("-");
    const passphrase = ["demo", "credential", "4321"].join("-");
    await fetchEnergyPrices({ username: token, password: passphrase }, fetcher);
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) {
      expect(call.method).toBe("POST");
      expect(call.url).toBe("https://genesis.destatis.de/genesisWS/rest/2020/data/tablefile");
      expect(call.url).not.toContain(token);
      expect(call.url).not.toContain(passphrase);
      expect(call.headers.username).toBe(token);
      expect(call.headers.password).toBe(passphrase);
    }
  });

  it("leaves the password out when a token is used", async () => {
    const seen: Record<string, string>[] = [];
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      seen.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(makeZip("table.csv", CSV, 8), { status: 200 });
    }) as unknown as typeof fetch;
    const token = ["token", "value"].join("-");
    await fetchEnergyPrices({ username: token }, fetcher);
    expect(seen[0]?.username).toBe(token);
    expect(seen[0]?.password).toBeUndefined();
  });

  it("has no prices when the feed fails", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    expect(await fetchEnergyPrices({ username: "token-value" }, fetcher)).toBeNull();
  });

  it("has no prices when the answer is not a zip", async () => {
    const fetcher = vi.fn(async () => new Response("plain text", { status: 200 })) as unknown as typeof fetch;
    expect(await fetchEnergyPrices({ username: "token-value" }, fetcher)).toBeNull();
  });
});
