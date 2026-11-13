import fp from "fastify-plugin";
import env from "@fastify/env";
import { isIP } from "node:net";

const schema = {
  type: "object",
  required: [],
  properties: {
    NODE_ENV: {
      type: "string",
      default: "development",
      enum: ["development", "production", "test"],
    },
    PORT: {
      type: "number",
      default: 3000,
    },
    LOG_LEVEL: {
      type: "string",
      default: "info",
      enum: ["fatal", "error", "warn", "info", "debug", "trace"],
    },
    DATABASE_URL: {
      type: "string",
      default: "file:./data/app.db",
    },
    DB_ENCRYPTION_KEY: {
      type: "string",
      default: "",
    },
    CORS_ORIGIN: {
      type: "string",
      default: "",
    },
    RATE_LIMIT_MAX: {
      type: "number",
      default: 100,
    },
    RATE_LIMIT_WINDOW: {
      type: "string",
      default: "1 minute",
    },
    INGEST_TOKEN: {
      type: "string",
      default: "",
    },
  },
};

type TrustProxyFunction = (address: string, hop: number) => boolean;

/**
 * Parse TRUST_PROXY for Fastify's `trustProxy` option. Unset/empty/"false" means
 * don't trust X-Forwarded-* (the safe default: a client can't spoof its IP).
 * "true" trusts every hop, an integer trusts that many proxy hops, anything else
 * is a comma-separated list of proxy IPs/CIDRs (or proxy-addr keywords such as
 * "loopback"). Invalid values throw at boot, naming TRUST_PROXY.
 *
 * Fastify fixes this at construction, before the env plugin runs, so buildApp
 * reads it from process.env (like LOG_LEVEL) and it is deliberately not part of
 * the env schema.
 */
export function parseTrustProxy(
  raw: string | undefined,
): boolean | string[] | TrustProxyFunction {
  const value = (raw ?? "").trim();
  if (value === "" || value.toLowerCase() === "false") return false;
  if (value.toLowerCase() === "true") return true;
  // Fastify 5 treats a bare number as "trust nothing", so express the hop count
  // as a function: hop 0 is the socket peer, and hops below n are proxies.
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return (_address, hop) => hop < hops;
  }
  const entries = value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  for (const entry of entries) {
    if (!isValidProxyEntry(entry)) {
      throw new Error(
        `Invalid TRUST_PROXY entry "${entry}": expected true, a hop count, or a comma-separated list of IPs/CIDRs`,
      );
    }
  }
  return entries;
}

const PROXY_KEYWORDS = new Set(["loopback", "linklocal", "uniquelocal"]);

function isValidProxyEntry(entry: string): boolean {
  if (PROXY_KEYWORDS.has(entry)) return true;
  const [addr, mask, ...rest] = entry.split("/");
  const family = isIP(addr);
  if (family === 0 || rest.length > 0) return false;
  if (mask === undefined) return true;
  if (!/^\d+$/.test(mask)) return false;
  return Number(mask) <= (family === 4 ? 32 : 128);
}

export const envPlugin = fp(async (app) => {
  await app.register(env, {
    schema: schema,
    dotenv: true,
  });
});

declare module "fastify" {
  interface FastifyInstance {
    config: {
      NODE_ENV: "development" | "production" | "test";
      PORT: number;
      LOG_LEVEL: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
      DATABASE_URL: string;
      DB_ENCRYPTION_KEY: string;
      CORS_ORIGIN: string;
      RATE_LIMIT_MAX: number;
      RATE_LIMIT_WINDOW: string;
      INGEST_TOKEN: string;
    };
  }
}