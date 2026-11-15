import { afterEach, describe, expect, it } from "vitest";
import { singleIdentityHeader } from "../../src/auth/guard.js";
import { buildApp } from "../../src/app.js";

const IDENTITY = "x-authentik-username";

afterEach(() => {
  delete process.env.INGEST_TOKEN;
  delete process.env.TRUST_PROXY;
  delete process.env.TRUSTED_AUTH_HEADER;
});

async function appWith(env: { token?: string; trust?: string; header?: string }) {
  if (env.token === undefined) delete process.env.INGEST_TOKEN;
  else process.env.INGEST_TOKEN = env.token;
  if (env.trust === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = env.trust;
  if (env.header === undefined) delete process.env.TRUSTED_AUTH_HEADER;
  else process.env.TRUSTED_AUTH_HEADER = env.header;
  return buildApp();
}

describe("ingest guard", () => {
  it("stays on the bearer token when the identity header is unset", async () => {
    const app = await appWith({ token: "test-token" });
    const missing = await app.inject({ method: "GET", url: "/listings" });
    const bogus = await app.inject({
      method: "GET",
      url: "/listings",
      headers: { authorization: "Bearer nope" },
    });
    expect(missing.statusCode).toBe(401);
    expect(bogus.statusCode).toBe(401);
    await app.close();
  });

  it("accepts the identity header from a trusted peer and rejects the same header from outside the CIDR", async () => {
    const app = await appWith({
      token: "test-token",
      trust: "10.0.0.0/8",
      header: "X-Authentik-Username",
    });
    for (const url of ["/listings", "/assumptions"]) {
      const allowed = await app.inject({
        method: "GET",
        url,
        remoteAddress: "10.0.0.5",
        headers: { [IDENTITY]: "ada" },
      });
      const outside = await app.inject({
        method: "GET",
        url,
        remoteAddress: "192.168.1.9",
        headers: { [IDENTITY]: "ada" },
      });
      const bare = await app.inject({
        method: "GET",
        url,
        remoteAddress: "10.0.0.5",
      });
      expect(allowed.statusCode).toBe(200);
      expect(outside.statusCode).toBe(401);
      expect(bare.statusCode).toBe(401);
    }
    await app.close();
  });

  it("treats an IPv4-mapped peer as inside the CIDR", async () => {
    const app = await appWith({
      token: "test-token",
      trust: "10.0.0.0/8",
      header: IDENTITY,
    });
    const response = await app.inject({
      method: "GET",
      url: "/listings",
      remoteAddress: "::ffff:10.0.0.5",
      headers: { [IDENTITY]: "ada" },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a blank or whitespace identity header", async () => {
    const app = await appWith({
      token: "test-token",
      trust: "10.0.0.1",
      header: IDENTITY,
    });
    for (const value of ["", "   "]) {
      const response = await app.inject({
        method: "GET",
        url: "/listings",
        remoteAddress: "10.0.0.1",
        headers: { [IDENTITY]: value },
      });
      expect(response.statusCode).toBe(401);
    }
    await app.close();
  });

  it("rejects a duplicated identity header, which Node would otherwise join", () => {
    // light-my-request stringifies an array header, so inject cannot represent
    // the two raw header lines a proxy append produces.
    expect(singleIdentityHeader(["x-authentik-username", "ada", "x-authentik-username", "bob"], "ada, bob", IDENTITY)).toBe(false);
    expect(singleIdentityHeader(["x-authentik-username", "ada"], ["ada", "bob"], IDENTITY)).toBe(false);
    expect(singleIdentityHeader(["X-Authentik-Username", "ada"], "ada", IDENTITY)).toBe(true);
    expect(singleIdentityHeader(["x-authentik-username", "  "], "  ", IDENTITY)).toBe(false);
  });

  it("does not let a bogus Authorization header fall through to the identity header", async () => {
    const app = await appWith({
      token: "test-token",
      trust: "10.0.0.0/8",
      header: IDENTITY,
    });
    const bogus = await app.inject({
      method: "GET",
      url: "/listings",
      remoteAddress: "10.0.0.5",
      headers: { authorization: "Bearer nope", [IDENTITY]: "ada" },
    });
    const emptyBearer = await app.inject({
      method: "GET",
      url: "/listings",
      remoteAddress: "10.0.0.5",
      headers: { authorization: "Bearer ", [IDENTITY]: "ada" },
    });
    const valid = await app.inject({
      method: "GET",
      url: "/listings",
      remoteAddress: "192.168.1.9",
      headers: { authorization: "Bearer test-token" },
    });
    expect(bogus.statusCode).toBe(401);
    expect(emptyBearer.statusCode).toBe(401);
    expect(valid.statusCode).toBe(200);
    await app.close();
  });

  it("ignores the identity header when TRUST_PROXY is unset, true, or a hop count", async () => {
    for (const trust of [undefined, "true", "1"]) {
      const app = await appWith({
        token: "test-token",
        trust,
        header: IDENTITY,
      });
      const response = await app.inject({
        method: "GET",
        url: "/listings",
        remoteAddress: "10.0.0.5",
        headers: { [IDENTITY]: "ada" },
      });
      expect(response.statusCode).toBe(401);
      await app.close();
    }
  });

  it("still fails closed when the token is unset, even from a trusted peer", async () => {
    const app = await appWith({ trust: "10.0.0.0/8", header: IDENTITY });
    const response = await app.inject({
      method: "GET",
      url: "/assumptions",
      remoteAddress: "10.0.0.5",
      headers: { [IDENTITY]: "ada" },
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it("refuses to boot when the trusted header is not a usable name", async () => {
    for (const header of ["Authorization", "X-Forwarded-For", "cookie", "not a header"]) {
      await expect(
        appWith({ token: "test-token", trust: "10.0.0.0/8", header }),
      ).rejects.toThrow(/TRUSTED_AUTH_HEADER/);
    }
  });
});

describe("auth session", () => {
  it("reports token unless the header name and an address list are both set", async () => {
    const plain = await appWith({ token: "test-token" });
    expect((await plain.inject({ method: "GET", url: "/auth/session" })).json()).toEqual({ mode: "token" });
    await plain.close();

    const hop = await appWith({ token: "test-token", trust: "true", header: IDENTITY });
    expect((await hop.inject({ method: "GET", url: "/auth/session" })).json()).toEqual({ mode: "token" });
    await hop.close();

    const proxy = await appWith({ token: "test-token", trust: "172.18.0.0/16", header: IDENTITY });
    const response = await proxy.inject({ method: "GET", url: "/auth/session" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ mode: "proxy" });
    await proxy.close();
  });

  it("does not require a token and does not 503 when the token is unset", async () => {
    const app = await appWith({});
    const response = await app.inject({ method: "GET", url: "/auth/session" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ mode: "token" });
    await app.close();
  });
});
