import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import fastifyStatic from "@fastify/static";
import proxyAddr from "@fastify/proxy-addr";
import { assertTrustedAuthHeader } from "./auth/guard.js";
import { envPlugin, parseTrustProxy, proxyAddressList } from "./plugins/env.js";
import { loggingPlugin } from "./plugins/logging.js";
import { securityPlugin } from "./plugins/security.js";
import { dbPlugin } from "./plugins/db.js";
import { rootRoute } from "./routes/root.js";
import { healthRoute } from "./routes/health.js";
import { usersRoute } from "./routes/users.js";
import { listingsRoute } from "./routes/listings.js";
import { assumptionsRoute } from "./routes/assumptions.js";
import { authRoute } from "./routes/auth.js";

export async function buildApp() {
  // Fastify fixes trustProxy at construction, before the env plugin runs, so it
  // is read from process.env like LOG_LEVEL. Set it in the container environment.
  // The same value is decorated for the guard: identity-header auth must not
  // re-parse the env and disagree with what Fastify actually trusted.
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  const addresses = proxyAddressList(trustProxy);
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
    trustProxy,
  });
  app.decorate("proxyAddresses", addresses);
  // Same matcher Fastify uses, compiled once. ::ffff: mapping stays in agreement.
  app.decorate("trustedPeer", addresses && addresses.length > 0 ? proxyAddr.compile([...addresses]) : null);

  await app.register(envPlugin);
  try {
    assertTrustedAuthHeader(app.config.TRUSTED_AUTH_HEADER);
  } catch (err) {
    await app.close();
    throw err;
  }
  await app.register(loggingPlugin);
  await app.register(sensible);
  await app.register(securityPlugin);
  await app.register(dbPlugin);

  const assetsPath = path.resolve("web/dist/assets");
  if (fs.existsSync(assetsPath)) {
    await app.register(fastifyStatic, {
      root: assetsPath,
      prefix: "/assets/",
      decorateReply: false,
    });
  }
  const favicon = path.resolve("web/dist/favicon.svg");
  if (fs.existsSync(favicon)) {
    app.get("/favicon.svg", async (_request, reply) => {
      return reply.type("image/svg+xml").send(fs.readFileSync(favicon));
    });
  }

  await app.register(rootRoute);
  await app.register(healthRoute);
  await app.register(usersRoute);
  await app.register(listingsRoute);
  await app.register(assumptionsRoute);
  await app.register(authRoute);

  return app;
}
