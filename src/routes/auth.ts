import type { FastifyInstance, FastifyRequest } from "fastify";
import { installIngestGuard, proxyAuthEnabled } from "../auth/guard.js";

/** Public origin of this request. Trust-proxy hops supply the forwarded host. */
export function publicOrigin(request: FastifyRequest): string | null {
  const host = request.host;
  if (!host || /[\s/]/.test(host)) return null;
  const proto = request.protocol === "https" ? "https" : "http";
  return `${proto}://${host}`;
}

export async function authRoute(app: FastifyInstance) {
  // Unguarded on purpose. The desk asks this before it has a token. The body is
  // only the mode: no listings, no username, no header name.
  app.get("/auth/session", async () => {
    return { mode: proxyAuthEnabled(app) ? "proxy" : "token" };
  });

  // Guard this path only. A prefix of `/auth` would also lock `/auth/session`.
  installIngestGuard(app, "/auth/pair");
  app.post("/auth/pair", async (request, reply) => {
    const apiUrl = publicOrigin(request);
    if (!apiUrl) return reply.code(400).send({ error: "Could not determine the server address." });
    // The guard already rejected an empty token. This is the value the extension stores.
    return { apiUrl, ingestToken: app.config.INGEST_TOKEN };
  });
}
