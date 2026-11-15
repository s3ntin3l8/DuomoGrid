import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { installIngestGuard } from "../auth/guard.js";
import { normalizeAssumptions } from "../domain/assumptions.js";
import { applySuggestion, pinField, readMarketSnapshot, refreshAssumptions, suggestionsFor, type MarketSnapshot, type Suggestions } from "../domain/suggestions.js";
import { DEFAULT_ASSUMPTIONS, STATES, type Assumptions } from "../domain/types.js";
import { settings } from "../db/schema.js";

/** How long a market snapshot is reused before it is fetched again. */
const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export async function assumptionsRoute(app: FastifyInstance) {
  installIngestGuard(app, "/assumptions");

  function readSetting(key: string): string | null {
    const row = app.db.select().from(settings).where(eq(settings.key, key)).all()[0];
    return row?.value ?? null;
  }

  function writeSetting(key: string, value: string) {
    const existing = app.db.select().from(settings).where(eq(settings.key, key)).all()[0];
    if (existing) {
      app.db.update(settings).set({ value }).where(eq(settings.key, key)).run();
    } else {
      app.db.insert(settings).values({ key, value }).run();
    }
  }

  function current(): Assumptions {
    const raw = readSetting("assumptions");
    if (!raw) return DEFAULT_ASSUMPTIONS;
    try {
      return normalizeAssumptions(JSON.parse(raw));
    } catch {
      return DEFAULT_ASSUMPTIONS;
    }
  }

  function save(assumptions: Assumptions) {
    writeSetting("assumptions", JSON.stringify(assumptions));
  }

  /**
   * The market snapshot is cached, so opening the settings does not ask the Bundesbank on every
   * load. A snapshot that cannot be read keeps the last one, so a network problem never empties
   * the desk.
   */
  let cached: { snapshot: MarketSnapshot; at: number } | null = null;

  /**
   * A snapshot with nothing usable in it is not worth showing.
   *
   * A published rate of zero is a figure, not a missing one, so this compares against null rather
   * than testing truthiness.
   */
  function isEmpty(snapshot: MarketSnapshot): boolean {
    const hasRates = snapshot.rates?.secured10yPercent != null;
    const hasEnergy = snapshot.energy?.electricityEurPerKwh != null || snapshot.energy?.gasEurPerKwh != null;
    return !hasRates && !hasEnergy;
  }

  /** The snapshot we already have, from memory or from the stored row. */
  function knownSnapshot(): MarketSnapshot | null {
    const stored = readSetting("market:snapshot");
    const previous = stored ? (parseSnapshot(stored) ?? null) : null;
    return cached?.snapshot ?? previous ?? null;
  }

  /**
   * Read the market and store the result.
   *
   * A feed that cannot be read keeps the last snapshot: a network problem never empties the desk
   * and never turns a figure into zero.
   */
  async function readSnapshot(): Promise<MarketSnapshot> {
    const fresh = await readMarketSnapshot(genesisCredentials()).catch(() => null);
    if (fresh && !isEmpty(fresh)) {
      cached = { snapshot: fresh, at: Date.now() };
      writeSetting("market:snapshot", JSON.stringify(fresh));
      return fresh;
    }
    const fallback = knownSnapshot();
    if (fallback) {
      return {
        ...fallback,
        note: "The market data could not be read. The last known values are still in use.",
      };
    }
    return { rates: null, energy: null, fetchedAt: new Date().toISOString(), note: "The market data could not be read." };
  }

  /**
   * The snapshot the desk gets.
   *
   * The market is read in the background, so opening the desk never waits on the network. The
   * figures on screen are the last ones read, which is what the desk needs anyway. When there is
   * nothing to show yet, the read is awaited, because there is nothing else to put on screen.
   */
  async function snapshot(force: boolean): Promise<MarketSnapshot> {
    const now = Date.now();
    const stale = !cached || now - cached.at >= SNAPSHOT_MAX_AGE_MS;
    const known = knownSnapshot();
    if (force) return readSnapshot();
    if (!stale && known) return known;
    if (!known) return readSnapshot();
    // There is a snapshot to show, so the read happens in the background and the desk goes on.
    void readSnapshot().catch(() => undefined);
    return known;
  }

  function genesisCredentials() {
    const token = app.config.DESTATIS_API_TOKEN.trim();
    if (token) return { username: token };
    const user = app.config.DESTATIS_API_USER.trim();
    const password = app.config.DESTATIS_API_PASSWORD.trim();
    if (user && password) return { username: user, password };
    return null;
  }

  /**
   * Read a stored snapshot back.
   *
   * The row is checked field by field, because a row that is not shaped like a snapshot must not
   * reach the desk: the desk calls `toFixed` on these figures, and a string where a number belongs
   * would take the whole route down.
   */
  function parseSnapshot(raw: string): MarketSnapshot | null {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!body || typeof body !== "object") return null;
    const row = body as Record<string, unknown>;
    const rates = row.rates && typeof row.rates === "object" ? (row.rates as Record<string, unknown>) : null;
    const energy = row.energy && typeof row.energy === "object" ? (row.energy as Record<string, unknown>) : null;
    const numberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
    const text = (value: unknown): string => (typeof value === "string" ? value : "");
    const history = Array.isArray(rates?.history)
      ? rates.history.flatMap((point) => {
          const item = point && typeof point === "object" ? (point as Record<string, unknown>) : null;
          const percent = numberOrNull(item?.percent);
          return percent == null ? [] : [{ period: text(item?.period), percent }];
        })
      : [];
    return {
      rates: rates
        ? {
            asOf: text(rates.asOf),
            secured10yPercent: numberOrNull(rates.secured10yPercent),
            unsecured10yPercent: numberOrNull(rates.unsecured10yPercent),
            allNewPercent: numberOrNull(rates.allNewPercent),
            floatingPercent: numberOrNull(rates.floatingPercent),
            secured10yLowPercent: numberOrNull(rates.secured10yLowPercent),
            secured10yHighPercent: numberOrNull(rates.secured10yHighPercent),
            secured10yRangeMonths: typeof rates.secured10yRangeMonths === "number" ? rates.secured10yRangeMonths : 0,
            history,
            spreadPercent: numberOrNull(rates.spreadPercent),
            source: text(rates.source),
            preliminary: rates.preliminary === true,
            fetchedAt: text(rates.fetchedAt),
          }
        : null,
      energy: energy
        ? {
            asOf: text(energy.asOf),
            electricityEurPerKwh: numberOrNull(energy.electricityEurPerKwh),
            electricityAsOf: text(energy.electricityAsOf),
            gasEurPerKwh: numberOrNull(energy.gasEurPerKwh),
            gasAsOf: text(energy.gasAsOf),
            source: text(energy.source),
            fetchedAt: text(energy.fetchedAt),
          }
        : null,
      fetchedAt: text(row.fetchedAt),
      note: typeof row.note === "string" ? row.note : null,
    };
  }

  app.get("/assumptions", async () => {
    const assumptions = current();
    const market = await snapshot(false);
    return { assumptions, states: STATES, market, suggestions: suggestionsFor(market) };
  });

  /**
   * Read the market again and move the values that follow it. A value the owner typed, and a
   * value that is still the shipped default, stay where they are.
   */
  app.post("/assumptions/refresh", async () => {
    const assumptions = current();
    const market = await snapshot(true);
    const suggestions = suggestionsFor(market);
    const refreshed = refreshAssumptions(assumptions, suggestions);
    save(refreshed);
    return { assumptions: refreshed, states: STATES, market, suggestions };
  });

  app.put("/assumptions", async (request) => {
    const body = request.body && typeof request.body === "object" ? (request.body as Record<string, unknown>) : {};
    const assumptions = normalizeAssumptions(body);
    // A field the owner names in `accept` takes the market figure, and only that field moves.
    const market = await snapshot(false);
    const suggestions = suggestionsFor(market);
    let next = assumptions;
    for (const field of ["interest", "notary", "register", "commission"]) {
      if (!Array.isArray(body.accept) || !body.accept.includes(field)) continue;
      next = applySuggestion(next, field as "interest" | "notary" | "register" | "commission", suggestions[field as keyof Suggestions] ?? null);
    }
    for (const field of ["interest", "notary", "register", "commission"]) {
      if (!Array.isArray(body.pin) || !body.pin.includes(field)) continue;
      next = pinField(next, field as "interest" | "notary" | "register" | "commission");
    }
    save(next);
    return { assumptions: next, states: STATES, market, suggestions };
  });
}
