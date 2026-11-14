import { timingSafeEqual } from "node:crypto";
import proxyAddr from "@fastify/proxy-addr";
import type { FastifyInstance, FastifyRequest } from "fastify";

// A client must not be able to point the trusted header at the bearer header,
// a cookie, or a forwarding header and skip the token compare.
const DENIED_HEADERS = new Set(["authorization", "cookie", "host", "forwarded"]);
const HEADER_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

let warnedBadHeader = false;

function authorized(header: string, expected: string): boolean {
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const left = Buffer.from(token);
  const right = Buffer.from(expected);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Lowercased header name, or "" when the setting is empty or not safe to trust. */
function acceptedIdentityHeader(raw: string | undefined): string {
  const name = (raw ?? "").trim().toLowerCase();
  if (!name || DENIED_HEADERS.has(name) || name.startsWith("x-forwarded-")) return "";
  if (!HEADER_TOKEN.test(name)) return "";
  return name;
}

function identityHeaderName(app: FastifyInstance): string {
  const raw = app.config.TRUSTED_AUTH_HEADER;
  const name = acceptedIdentityHeader(raw);
  if (!name && raw.trim() && !warnedBadHeader) {
    warnedBadHeader = true;
    app.log.warn("TRUSTED_AUTH_HEADER is not a usable header name; proxy auth stays off");
  }
  return name;
}

function peerTrusted(app: FastifyInstance, remote: string | undefined): boolean {
  const addresses = app.proxyAddresses;
  if (!addresses || addresses.length === 0 || !remote) return false;
  try {
    // compile() is the same matcher Fastify uses, so ::ffff: mapping agrees.
    return proxyAddr.compile([...addresses])(remote, 0);
  } catch {
    return false;
  }
}

/**
 * One non-empty value, and only one. Node joins a duplicated header into a
 * single comma-separated string before `request.headers`, so the count has to
 * come from `rawHeaders`. An array (some servers keep one) is also a reject.
 */
export function singleIdentityHeader(
  rawHeaders: readonly string[],
  parsed: string | string[] | undefined,
  name: string,
): boolean {
  let seen = 0;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i]?.toLowerCase() === name) seen += 1;
  }
  if (seen !== 1 || typeof parsed !== "string") return false;
  return parsed.trim().length > 0;
}

function identityPresent(request: FastifyRequest, name: string): boolean {
  return singleIdentityHeader(request.raw.rawHeaders, request.headers[name], name);
}

/**
 * Proxy auth is on only when the header name is usable and TRUST_PROXY is an
 * address list. `true` and a hop count stay off, so a direct caller cannot
 * forge the header. The session route reports this; it does not check the peer.
 */
export function proxyAuthEnabled(app: FastifyInstance): boolean {
  return identityHeaderName(app).length > 0 && (app.proxyAddresses?.length ?? 0) > 0;
}

export function installIngestGuard(app: FastifyInstance, prefix: string) {
  app.addHook("preHandler", async (request, reply) => {
    const url = request.url.split("?")[0] ?? "";
    if (!url.startsWith(prefix)) return;
    const expected = app.config.INGEST_TOKEN;
    // Proxy auth does not waive this. The extension still needs a configured token.
    if (!expected) {
      return reply.code(503).send({ error: "Ingest token is not configured." });
    }
    // Any Authorization header, including an empty bearer, is the token path.
    // A bogus bearer must not fall through to a forged identity header.
    const authorization = request.headers.authorization;
    if (authorization !== undefined) {
      if (typeof authorization !== "string" || !authorized(authorization, expected)) {
        return reply.code(401).send({ error: "Invalid ingest token." });
      }
      return;
    }
    const name = identityHeaderName(app);
    const remote = request.socket.remoteAddress;
    if (name && peerTrusted(app, remote) && identityPresent(request, name)) return;
    return reply.code(401).send({ error: "Invalid ingest token." });
  });
}
