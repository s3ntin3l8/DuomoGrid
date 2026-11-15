import type { FastifyInstance } from "fastify";
import { installIngestGuard } from "../auth/guard.js";
import {
  handleMcpRequest,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../mcp/server.js";

export async function mcpRoute(app: FastifyInstance) {
  installIngestGuard(app, "/mcp");

  app.post("/mcp", async (request, reply) => {
    const deps = {
      db: app.db,
      encryption: app.encryption,
      envConfig: app.config,
    };
    const body = request.body;
    if (Array.isArray(body)) {
      const responses: JsonRpcResponse[] = [];
      for (const item of body) {
        const res = await handleMcpRequest(deps, item as JsonRpcRequest);
        if (res) responses.push(res);
      }
      if (responses.length === 0) return reply.code(202).send();
      return responses;
    }

    const res = await handleMcpRequest(deps, body as JsonRpcRequest);
    if (!res) return reply.code(202).send();
    return res;
  });
}
