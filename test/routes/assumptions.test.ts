import { deflateRawSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { settings } from "../../src/db/schema.js";
import { normalizeAssumptions } from "../../src/domain/assumptions.js";

/** A Bundesbank answer with one observation. */
const BUNDESBANK_BODY = `"";BBIM1.M.DE.B.A2CC.P.R.A.2250.EUR.N;BBIM1.M.DE.B.A2CC.P.R.A.2250.EUR.N_FLAGS
"";Effektivzinssätze Banken DE / Neugeschäft / besicherte Wohnungsbaukredite / SUD161;
Dezimalstellen;2;
2026-08;3,83;
2026-09;3,91;Vorläufiger Wert
`;

/**
 * The flat file of Destatis table 61243, with the header and the columns the module reads: the
 * half-year, the area, the price kind and the consumption class, then the value.
 */
const GENESIS_HEADER =
  "statistics_code;statistics_label;time_code;time_label;time;1_variable_code;1_variable_label;1_variable_attribute_code;1_variable_attribute_label;2_variable_code;2_variable_label;2_variable_attribute_code;2_variable_attribute_label;3_variable_code;3_variable_label;3_variable_attribute_code;3_variable_attribute_label;4_variable_code;4_variable_label;4_variable_attribute_code;4_variable_attribute_label;value;value_unit;value_variable_code;value_variable_label";

const GENESIS_CSV = `${GENESIS_HEADER}
61243;x;JAHR;Jahr;2026;HALBJA;Halbjahre;HALBJH1;1. Halbjahr;DINSG;Deutschland insgesamt;DG;Deutschland;PREAT1;Preisarten;PRE-BRUTTO;Durchschnittspreise inkl. Steuern, Abgaben, Umlagen;VBRST1;Klassen;HH-STR-DC;2 500 bis unter 5 000 KWh;0,3618;EUR/kWh;PRE060;x
`;

/** A zip holding one csv, the way GENESIS answers. */
function genesisZip(): Uint8Array {
  const name = Buffer.from("table.csv");
  const data = Buffer.from(GENESIS_CSV);
  const payload = deflateRawSync(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(30 + name.length + payload.length, 16);
  return new Uint8Array(Buffer.concat([local, name, payload, central, name, eocd]));
}

/**
 * Answer every fetch with the Bundesbank body, and the GENESIS calls with a real flat file, so
 * both halves of the market read.
 */
function stubMarketFetch() {
  return vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("genesis.destatis.de")) {
        return new Response(genesisZip(), { status: 200 });
      }
      return new Response(BUNDESBANK_BODY, { status: 200 });
    }),
  );
}

describe("routes/assumptions", () => {
  beforeEach(async () => {
    // The test file shares one database. Each test starts with no saved assumptions.
    const app = await buildApp();
    app.db.delete(settings).where(eq(settings.key, "assumptions")).run();
    app.db.delete(settings).where(eq(settings.key, "market:snapshot")).run();
    await app.close();
  });

  afterEach(() => {
    delete process.env.INGEST_TOKEN;
    delete process.env.DESTATIS_API_TOKEN;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("enforces the ingest guard (503 when unset, 401 when unauthorized)", async () => {
    delete process.env.INGEST_TOKEN;
    const appNoToken = await buildApp();
    const res503 = await appNoToken.inject({ method: "GET", url: "/assumptions" });
    expect(res503.statusCode).toBe(503);
    await appNoToken.close();

    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const res401 = await app.inject({ method: "GET", url: "/assumptions" });
    expect(res401.statusCode).toBe(401);
    await app.close();
  });

  it("guards the refresh route too, because the prefix covers it", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/assumptions/refresh" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns the market snapshot and the suggestions", async () => {
    stubMarketFetch();
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/assumptions", headers: { authorization: "Bearer test-token" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.market.rates.secured10yPercent).toBe(3.91);
    expect(body.market.rates.asOf).toBe("2026-09");
    expect(body.suggestions.interest.value).toBe(3.91);
    expect(body.suggestions.notary.value).toBe(1.5);
    await app.close();
  });

  it("reads the market in the background and answers with the last known figures", async () => {
    stubMarketFetch();
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    // The first read has nothing to show, so it is awaited.
    const first = await app.inject({ method: "GET", url: "/assumptions", headers });
    expect(first.json().market.rates.secured10yPercent).toBe(3.91);
    // The next one has a snapshot, so it answers straight away while the read runs behind it.
    const second = await app.inject({ method: "GET", url: "/assumptions", headers });
    expect(second.json().market.rates.secured10yPercent).toBe(3.91);
    await app.close();
  });

  it("accepts a market figure and marks it as one", async () => {
    stubMarketFetch();
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const res = await app.inject({
      method: "PUT",
      url: "/assumptions",
      headers,
      payload: { interestPercent: 3.91, accept: ["interest"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().assumptions.interestPercent).toBe(3.91);
    expect(res.json().assumptions.interestProvenance.source).toBe("market");
    expect(res.json().assumptions.interestProvenance.asOf).toBe("2026-09");
    await app.close();
  });

  it("keeps a value the owner typed when the market moves", async () => {
    stubMarketFetch();
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    await app.inject({
      method: "PUT",
      url: "/assumptions",
      headers,
      payload: { interestPercent: 2.5, accept: ["interest"] },
    });
    // The owner takes the figure back into their own hands.
    await app.inject({
      method: "PUT",
      url: "/assumptions",
      headers,
      payload: { interestPercent: 2.5, pin: ["interest"] },
    });
    const refreshed = await app.inject({ method: "POST", url: "/assumptions/refresh", headers });
    expect(refreshed.json().assumptions.interestPercent).toBe(2.5);
    expect(refreshed.json().assumptions.interestProvenance.source).toBe("user");
    await app.close();
  });

  it("does not move a value that is still the default when the market is read again", async () => {
    stubMarketFetch();
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const refreshed = await app.inject({ method: "POST", url: "/assumptions/refresh", headers });
    expect(refreshed.json().assumptions.interestPercent).toBe(3.6);
    expect(refreshed.json().assumptions.interestProvenance.source).toBe("builtin");
    await app.close();
  });

  it("keeps the last known rates when the market cannot be read", async () => {
    stubMarketFetch();
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const first = await app.inject({ method: "GET", url: "/assumptions", headers });
    expect(first.json().market.rates.secured10yPercent).toBe(3.91);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const second = await app.inject({ method: "POST", url: "/assumptions/refresh", headers });
    expect(second.statusCode).toBe(200);
    expect(second.json().market.rates.secured10yPercent).toBe(3.91);
    await app.close();
  });

  it("keeps the stored rates when the market cannot be read and nothing is cached", async () => {
    stubMarketFetch();
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    await app.inject({ method: "GET", url: "/assumptions", headers });
    await app.close();

    // A fresh process has no in-memory cache, so only the stored row can answer.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const restarted = await buildApp();
    const res = await restarted.inject({ method: "GET", url: "/assumptions", headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().market.rates.secured10yPercent).toBe(3.91);
    await restarted.close();
  });

  it("answers with a note and no rates when the market cannot be read and nothing was stored", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const res = await app.inject({ method: "GET", url: "/assumptions", headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().market.rates).toBeNull();
    expect(res.json().market.note).toBeTruthy();
    expect(res.json().suggestions.interest).toBeNull();
    await app.close();
  });

  it("keeps a published rate of zero, which is a figure and not a missing value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes("genesis.destatis.de")) return new Response("{}", { status: 404 });
        return new Response('"";name;\n2026-09;0,00;\n', { status: 200 });
      }),
    );
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/assumptions", headers: { authorization: "Bearer test-token" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().market.rates.secured10yPercent).toBe(0);
    expect(res.json().suggestions.interest.value).toBe(0);
    await app.close();
  });

  it("survives a stored snapshot that is not shaped like one", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    app.db
      .insert(settings)
      .values({ key: "market:snapshot", value: JSON.stringify({ rates: { secured10yPercent: "three" }, energy: null, fetchedAt: "x", note: null }) })
      .run();
    const res = await app.inject({ method: "GET", url: "/assumptions", headers: { authorization: "Bearer test-token" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().market.rates.secured10yPercent).toBeNull();
    await app.close();
  });

  it("does not ask the market again straight away after a failed read", async () => {
    const failing = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", failing);
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    await app.inject({ method: "GET", url: "/assumptions", headers });
    const callsAfterFirst = failing.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    // The failure is remembered, so the next request does not pay the timeout again.
    await app.inject({ method: "GET", url: "/assumptions", headers });
    expect(failing.mock.calls.length).toBe(callsAfterFirst);
    await app.close();
  });

  it("tries the market again after the retry window, not six hours later", async () => {
    stubMarketFetch();
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    await app.inject({ method: "GET", url: "/assumptions", headers });

    const failing = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", failing);
    const failed = await app.inject({ method: "POST", url: "/assumptions/refresh", headers });
    expect(failed.json().market.note).toMatch(/last known values/);
    const callsAfterFailure = failing.mock.calls.length;
    expect(callsAfterFailure).toBeGreaterThan(0);

    // Inside the window nothing is tried again.
    await app.inject({ method: "GET", url: "/assumptions", headers });
    expect(failing.mock.calls.length).toBe(callsAfterFailure);

    // Past the window the market is tried again, even though the last good snapshot is younger
    // than the freshness window. A failure must not push the next attempt out to six hours.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 10 * 60 * 1000);
    await app.inject({ method: "GET", url: "/assumptions", headers });
    expect(failing.mock.calls.length).toBeGreaterThan(callsAfterFailure);
    vi.restoreAllMocks();
    await app.close();
  });

  it("keeps the stale marker while the retry runs, until a new read lands", async () => {
    stubMarketFetch();
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    await app.inject({ method: "GET", url: "/assumptions", headers });

    const failing = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", failing);
    await app.inject({ method: "POST", url: "/assumptions/refresh", headers });

    // Past the window the market is tried again, but the figures on screen are still the last
    // known ones and say so until the new read lands.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 10 * 60 * 1000);
    const retried = await app.inject({ method: "GET", url: "/assumptions", headers });
    expect(retried.json().market.note).toMatch(/last known values/);
    expect(retried.json().market.rates.secured10yPercent).toBe(3.91);
    vi.restoreAllMocks();
    await app.close();
  });

  it("says the figures are the last known ones on every request after a failed read", async () => {
    stubMarketFetch();
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    await app.inject({ method: "GET", url: "/assumptions", headers });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    const first = await app.inject({ method: "POST", url: "/assumptions/refresh", headers });
    expect(first.json().market.note).toMatch(/last known values/);
    // The next request serves the cached snapshot, and it still says the figures are stale.
    const second = await app.inject({ method: "GET", url: "/assumptions", headers });
    expect(second.json().market.note).toMatch(/last known values/);
    expect(second.json().market.rates.secured10yPercent).toBe(3.91);
    await app.close();
  });

  it("accepts a published heating rate and marks it as a market value", async () => {
    stubMarketFetch();
    process.env.INGEST_TOKEN = "test-token";
    // The energy prices need a GENESIS account; without one they are never read. The env plugin
    // reads it once, when the app is built, so it is set here and put back straight away: the
    // environment is shared with the other test files.
    const previous = process.env.DESTATIS_API_TOKEN;
    process.env.DESTATIS_API_TOKEN = "test-token";
    const app = await buildApp();
    if (previous === undefined) delete process.env.DESTATIS_API_TOKEN;
    else process.env.DESTATIS_API_TOKEN = previous;
    const headers = { authorization: "Bearer test-token" };
    const res = await app.inject({
      method: "PUT",
      url: "/assumptions",
      headers,
      payload: { accept: ["electric"] },
    });
    expect(res.statusCode).toBe(200);
    const assumptions = res.json().assumptions;
    expect(assumptions.energyRates.electricProvenance.source).toBe("market");
    expect(assumptions.energyRates.electric).toBeCloseTo(0.3618, 4);
    await app.close();
  });

  it("keeps a heating rate the owner pinned when the market is read again", async () => {
    stubMarketFetch();
    process.env.INGEST_TOKEN = "test-token";
    // The energy prices need a GENESIS account; without one they are never read, and the refresh
    // would have nothing to move the rate with.
    const previous = process.env.DESTATIS_API_TOKEN;
    process.env.DESTATIS_API_TOKEN = "test-token";
    const app = await buildApp();
    if (previous === undefined) delete process.env.DESTATIS_API_TOKEN;
    else process.env.DESTATIS_API_TOKEN = previous;
    const headers = { authorization: "Bearer test-token" };
    // The rate follows the market.
    await app.inject({ method: "PUT", url: "/assumptions", headers, payload: { accept: ["electric"] } });
    const accepted = await app.inject({ method: "GET", url: "/assumptions", headers });
    expect(accepted.json().assumptions.energyRates.electricProvenance.source).toBe("market");
    // The owner takes it back into their own hands.
    await app.inject({
      method: "PUT",
      url: "/assumptions",
      headers,
      payload: { energyRates: { electric: 0.4, electricProvenance: { source: "user", asOf: null, note: null } } },
    });
    const refreshed = await app.inject({ method: "POST", url: "/assumptions/refresh", headers });
    expect(refreshed.json().assumptions.energyRates.electric).toBe(0.4);
    expect(refreshed.json().assumptions.energyRates.electricProvenance.source).toBe("user");
    await app.close();
  });

  it("marks a value the owner pinned as theirs even when a figure was accepted first", async () => {
    stubMarketFetch();
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    await app.inject({ method: "PUT", url: "/assumptions", headers, payload: { interestPercent: 3.91, accept: ["interest"] } });
    const pinned = await app.inject({
      method: "PUT",
      url: "/assumptions",
      headers,
      payload: { interestPercent: 3.91, accept: ["interest"], pin: ["interest"] },
    });
    expect(pinned.json().assumptions.interestProvenance.source).toBe("user");
    const refreshed = await app.inject({ method: "POST", url: "/assumptions/refresh", headers });
    expect(refreshed.json().assumptions.interestPercent).toBe(3.91);
    expect(refreshed.json().assumptions.interestProvenance.source).toBe("user");
    await app.close();
  });

  it("round-trips an old row without a provenance through the same shape", async () => {
    stubMarketFetch();
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };
    const res = await app.inject({ method: "PUT", url: "/assumptions", headers, payload: { interestPercent: 4 } });
    const saved = res.json().assumptions;
    expect(saved.interestProvenance.source).toBe("builtin");
    expect(normalizeAssumptions(saved).interestPercent).toBe(4);
    await app.close();
  });
});
