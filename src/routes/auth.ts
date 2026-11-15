import type { FastifyInstance } from "fastify";
import { installIngestGuard, proxyAuthEnabled } from "../auth/guard.js";

export async function authRoute(app: FastifyInstance) {
  // Unguarded on purpose. The desk asks this before it has a token. The body is
  // only the mode: no listings, no username, no header name.
  app.get("/auth/session", async () => {
    return { mode: proxyAuthEnabled(app) ? "proxy" : "token" };
  });

  // Guard this path only. A prefix of `/auth` would also lock `/auth/session`.
  // The extension stores the origin of the tab it paired from, not a host derived here.
  installIngestGuard(app, "/auth/pair");
  app.post("/auth/pair", async () => {
    return { ingestToken: app.config.INGEST_TOKEN };
  });
}
