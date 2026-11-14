import type { FastifyInstance } from "fastify";
import { proxyAuthEnabled } from "../auth/guard.js";

export async function authRoute(app: FastifyInstance) {
  // Unguarded on purpose. The desk asks this before it has a token. The body is
  // only the mode: no listings, no username, no header name. A data route must
  // still call installIngestGuard itself.
  app.get("/auth/session", async () => {
    return { mode: proxyAuthEnabled(app) ? "proxy" : "token" };
  });
}
