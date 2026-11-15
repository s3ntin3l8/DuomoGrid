import readline from "node:readline";
import { closeDb, ensureDb, getDb } from "../db/client.js";
import { EncryptionService } from "../services/encryption.js";
import { handleMcpRequest, type JsonRpcRequest } from "./server.js";

const dbUrl = process.env.DATABASE_URL || "file:./data/app.db";
ensureDb(dbUrl);
const db = getDb(dbUrl);
const encryption = new EncryptionService({
  key: process.env.DB_ENCRYPTION_KEY || "",
});
const deps = {
  db,
  encryption,
  envConfig: {
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
  },
};

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  void (async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error." },
        })}\n`,
      );
      return;
    }
    const response = await handleMcpRequest(deps, parsed as JsonRpcRequest);
    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  })();
});

rl.on("close", () => {
  closeDb();
});
