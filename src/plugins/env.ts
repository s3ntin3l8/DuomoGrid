import fp from "fastify-plugin";
import env from "@fastify/env";

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
    TRUST_PROXY: {
      type: "string",
      default: "",
    },
  },
};

/**
 * Parse TRUST_PROXY for Fastify's `trustProxy` option. Unset/empty/"false" means
 * don't trust X-Forwarded-* (the safe default: a client can't spoof its IP).
 * "true" trusts every hop, an integer trusts that many hops, anything else is a
 * comma-separated list of proxy IPs/CIDRs.
 */
export function parseTrustProxy(raw: string | undefined): boolean | number | string[] {
  const value = (raw ?? "").trim();
  if (value === "" || value.toLowerCase() === "false") return false;
  if (value.toLowerCase() === "true") return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
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
      TRUST_PROXY: string;
    };
  }
}