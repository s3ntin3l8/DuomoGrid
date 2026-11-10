import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { installIngestGuard } from "../auth/guard.js";
import { normalizeAssumptions } from "../domain/assumptions.js";
import { DEFAULT_ASSUMPTIONS, STATES } from "../domain/types.js";
import { settings } from "../db/schema.js";

export async function assumptionsRoute(app: FastifyInstance) {
  installIngestGuard(app, "/assumptions");

  function current() {
    const row = app.db.select().from(settings).where(eq(settings.key, "assumptions")).all()[0];
    if (!row) return DEFAULT_ASSUMPTIONS;
    try {
      return normalizeAssumptions(JSON.parse(row.value));
    } catch {
      return DEFAULT_ASSUMPTIONS;
    }
  }

  app.get("/assumptions", async () => {
    return { assumptions: current(), states: STATES };
  });

  app.put("/assumptions", async (request) => {
    const assumptions = normalizeAssumptions(request.body);
    const value = JSON.stringify(assumptions);
    const existing = app.db.select().from(settings).where(eq(settings.key, "assumptions")).all()[0];
    if (existing) {
      app.db.update(settings).set({ value }).where(eq(settings.key, "assumptions")).run();
    } else {
      app.db.insert(settings).values({ key: "assumptions", value }).run();
    }
    return { assumptions, states: STATES };
  });
}
