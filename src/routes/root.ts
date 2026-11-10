import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";

const indexPath = path.resolve("web/dist/index.html");

export async function rootRoute(app: FastifyInstance) {
  app.get("/", async (_request, reply) => {
    if (app.config.NODE_ENV !== "test" && fs.existsSync(indexPath)) {
      return reply.type("text/html; charset=utf-8").send(fs.readFileSync(indexPath));
    }
    return { message: "Hello World" };
  });
}
