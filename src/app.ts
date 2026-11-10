import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import sensible from "@fastify/sensible";
import fastifyStatic from "@fastify/static";
import { envPlugin } from "./plugins/env.js";
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
