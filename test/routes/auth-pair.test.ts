import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

afterEach(() => {
  delete process.env.INGEST_TOKEN;
  delete process.env.TRUST_PROXY;
  delete process.env.TRUSTED_AUTH_HEADER;
});

describe("POST /auth/pair", () => {
  it("stays closed without a token and does not guard the session probe", async () => {
    const app = await buildApp();
    const denied = await app.inject({ method: "POST", url: "/auth/pair" });
    const session = await app.inject({ method: "GET", url: "/auth/session" });
    expect(denied.statusCode).toBe(503);
    expect(session.statusCode).toBe(200);
    await app.close();
  });

  it("rejects a missing or invalid bearer token", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const missing = await app.inject({ method: "POST", url: "/auth/pair" });
    const bogus = await app.inject({
      method: "POST",
      url: "/auth/pair",
      headers: { authorization: "Bearer nope" },
    });
    expect(missing.statusCode).toBe(401);
    expect(bogus.statusCode).toBe(401);
    await app.close();
  });

  it("returns the public origin and the ingest token to a bearer caller", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/pair",
      headers: { authorization: "Bearer test-token", host: "127.0.0.1:3000" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ingestToken: "test-token" });
    await app.close();
  });

  it("accepts the identity header from a trusted peer and does not require a bearer token", async () => {
    process.env.INGEST_TOKEN = "test-token";
    process.env.TRUST_PROXY = "10.0.0.0/8";
    process.env.TRUSTED_AUTH_HEADER = "X-Authentik-Username";
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/pair",
      remoteAddress: "10.0.0.5",
      headers: { "x-authentik-username": "ada" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ingestToken: "test-token" });
    await app.close();
  });
});
