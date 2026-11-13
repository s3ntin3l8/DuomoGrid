import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import fastifyStatic from "@fastify/static";
import { envPlugin, parseTrustProxy } from "./plugins/env.js";
import { loggingPlugin } from "./plugins/logging.js";
import { securityPlugin } from "./plugins/security.js";
import { dbPlugin } from "./plugins/db.js";
import { rootRoute } from "./routes/root.js";
import { healthRoute } from "./routes/health.js";
import { usersRoute } from "./routes/users.js";
import { listingsRoute } from "./routes/listings.js";
import { assumptionsRoute } from "./routes/assumptions.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
    // Fastify fixes this at construction, before the env plugin runs, so it is
    // read from process.env like LOG_LEVEL. Set it in the container environment.
    // A hop count is supported at runtime but missing from Fastify's type.
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY) as boolean | string[],
  });

  await app.register(envPlugin);
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

  return app;
}
