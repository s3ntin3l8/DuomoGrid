import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

function authorized(header: string | undefined, expected: string): boolean {
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const left = Buffer.from(token);
  const right = Buffer.from(expected);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function installIngestGuard(app: FastifyInstance, prefix: string) {
  app.addHook("preHandler", async (request, reply) => {
    const url = request.url.split("?")[0] ?? "";
    if (!url.startsWith(prefix)) return;
    const expected = app.config.INGEST_TOKEN;
    if (!expected) {
      return reply.code(503).send({ error: "Ingest token is not configured." });
    }
    if (!authorized(request.headers.authorization, expected)) {
      return reply.code(401).send({ error: "Invalid ingest token." });
    }
  });
}
