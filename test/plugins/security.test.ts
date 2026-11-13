import { describe, it, expect, afterEach } from "vitest";
import { buildApp } from "../../src/app.js";

describe("security plugin", () => {
  afterEach(() => {
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.CORS_ORIGIN;
    delete process.env.TRUST_PROXY;
  });

  it("sets security headers from helmet", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBeDefined();
    const csp = String(res.headers["content-security-policy"] ?? "");
    expect(csp).toContain("https://tiles.openfreemap.org");
    expect(csp).toContain("worker-src");
    await app.close();
  });

  it("rate-limits requests beyond the configured max", async () => {
    process.env.RATE_LIMIT_MAX = "2";
    const app = await buildApp();

    const first = await app.inject({ method: "GET", url: "/health" });
    const second = await app.inject({ method: "GET", url: "/health" });
    const third = await app.inject({ method: "GET", url: "/health" });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
    await app.close();
  });

  it("reflects an allowlisted CORS origin", async () => {
    process.env.CORS_ORIGIN = "https://app.example.com";
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://app.example.com" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    await app.close();
  });

  describe("TRUST_PROXY", () => {
    const hit = (app: Awaited<ReturnType<typeof buildApp>>, xff: string) =>
      app.inject({
        method: "GET",
        url: "/health",
        remoteAddress: "10.0.0.1",
        headers: { "x-forwarded-for": xff },
      });

    it("ignores X-Forwarded-For by default so a client cannot spoof its IP", async () => {
      process.env.RATE_LIMIT_MAX = "1";
      const app = await buildApp();
      expect((await hit(app, "1.1.1.1")).statusCode).toBe(200);
      expect((await hit(app, "2.2.2.2")).statusCode).toBe(429);
      await app.close();
    });

    it("rate-limits per forwarded client IP when set", async () => {
      process.env.RATE_LIMIT_MAX = "1";
      process.env.TRUST_PROXY = "10.0.0.1";
      const app = await buildApp();
      expect((await hit(app, "1.1.1.1")).statusCode).toBe(200);
      expect((await hit(app, "2.2.2.2")).statusCode).toBe(200);
      expect((await hit(app, "1.1.1.1")).statusCode).toBe(429);
      await app.close();
    });
  });
});
