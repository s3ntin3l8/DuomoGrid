import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { settings } from "../../src/db/schema.js";

describe("routes/ai", () => {
  afterEach(() => {
    delete process.env.INGEST_TOKEN;
    delete process.env.DB_ENCRYPTION_KEY;
    delete process.env.AI_PROVIDER;
    delete process.env.AI_API_KEY;
    delete process.env.AI_MODEL;
    vi.restoreAllMocks();
  });

  it("enforces the ingest guard on /ai routes (503 when unset, 401 when unauthorized)", async () => {
    delete process.env.INGEST_TOKEN;
    const appNoToken = await buildApp();
    const res503 = await appNoToken.inject({ method: "GET", url: "/ai/settings" });
    expect(res503.statusCode).toBe(503);
    expect((await appNoToken.inject({ method: "POST", url: "/ai/models", payload: {} })).statusCode).toBe(503);
    await appNoToken.close();

    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const res401 = await app.inject({ method: "GET", url: "/ai/settings" });
    expect(res401.statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/ai/models", payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/ai/models", headers: { authorization: "Bearer test-token" }, payload: { provider: "anthropic", baseUrl: "https://api.anthropic.com" } })).statusCode).toBe(400);
    await app.close();
  });

  it("discovers models with draft settings and an env key without persisting the draft", async () => {
    process.env.INGEST_TOKEN = "test-token";
    process.env.AI_API_KEY = "demo"; // pragma: allowlist secret
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "claude-test", display_name: "Claude Test" }] })));
    const app = await buildApp();
    try {
      const headers = { authorization: "Bearer test-token" };
      expect((await app.inject({ method: "POST", url: "/ai/models", headers, payload: {} })).statusCode).toBe(400);
      const response = await app.inject({ method: "POST", url: "/ai/models", headers, payload: { provider: "anthropic", baseUrl: "https://api.anthropic.com", model: "" } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ models: [{ id: "claude-test", name: "Claude Test" }] });
      expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": "demo" });
      expect(app.db.select().from(settings).where(eq(settings.key, "ai")).get()).toBeUndefined();
      const invalid = await app.inject({ method: "POST", url: "/ai/models", headers, payload: { baseUrl: "http://169.254.169.254" } });
      expect(invalid.statusCode).toBe(400);
      fetchMock.mockResolvedValue(new Response("failure", { status: 500 }));
      const failed = await app.inject({ method: "POST", url: "/ai/models", headers, payload: { provider: "openai" } });
      expect(failed.statusCode).toBe(502);
    } finally { await app.close(); }
  });

  it("refuses storing an API key without DB_ENCRYPTION_KEY, and encrypts it at rest when enabled", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const headers = { authorization: "Bearer test-token" };
    const sampleSecret = ["demo", "credential", "4321"].join("-");

    // Without DB_ENCRYPTION_KEY, saving an API key is refused
    const appUnencrypted = await buildApp();
    const refused = await appUnencrypted.inject({
      method: "PUT",
      url: "/ai/settings",
      headers,
      payload: {
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: sampleSecret, // pragma: allowlist secret
        model: "claude-3-5-sonnet-latest",
      },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toMatch(/DB_ENCRYPTION_KEY/);
    await appUnencrypted.close();

    // With DB_ENCRYPTION_KEY, saving succeeds and encrypts at rest
    process.env.DB_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64url");
    const app = await buildApp();

    const initial = await app.inject({ method: "GET", url: "/ai/settings", headers });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().configured).toBe(false);
    expect(initial.json().encryptionEnabled).toBe(true);

    const updated = await app.inject({
      method: "PUT",
      url: "/ai/settings",
      headers,
      payload: {
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: sampleSecret, // pragma: allowlist secret
        model: "claude-3-5-sonnet-latest",
        autoExtractOnSave: true,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      hasApiKey: true,
      apiKeyPreview: "***...4321",
      apiKeySource: "db", // pragma: allowlist secret
      model: "claude-3-5-sonnet-latest",
      autoExtractOnSave: true,
      configured: true,
      encryptionEnabled: true,
    });

    const row = app.db.select().from(settings).where(eq(settings.key, "ai")).get();
    expect(row).toBeDefined();
    expect(row?.value).not.toContain(sampleSecret);
    expect(row?.value).toContain("enc:");

    await app.close();
  });

  it("allows PUT /ai/settings on an .env-configured deployment without DB_ENCRYPTION_KEY and keeps env keys out of the DB", async () => {
    process.env.INGEST_TOKEN = "test-token";
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_API_KEY = ["env", "token", "7788"].join("-"); // pragma: allowlist secret
    process.env.AI_MODEL = "claude-sonnet-4-20250514";
    const headers = { authorization: "Bearer test-token" };

    // 1. Without DB_ENCRYPTION_KEY, changing model/autoExtractOnSave succeeds without 400
    const appNoEnc = await buildApp();
    const getBefore = await appNoEnc.inject({ method: "GET", url: "/ai/settings", headers });
    expect(getBefore.statusCode).toBe(200);
    expect(getBefore.json()).toMatchObject({
      provider: "anthropic",
      hasApiKey: true,
      apiKeyPreview: "***...7788",
      apiKeySource: "env", // pragma: allowlist secret
      configured: true,
      encryptionEnabled: false,
    });

    const putRes = await appNoEnc.inject({
      method: "PUT",
      url: "/ai/settings",
      headers,
      payload: {
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-3-5-haiku-latest",
        autoExtractOnSave: true,
      },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json()).toMatchObject({
      provider: "anthropic",
      model: "claude-3-5-haiku-latest",
      autoExtractOnSave: true,
      hasApiKey: true,
      apiKeyPreview: "***...7788",
      apiKeySource: "env", // pragma: allowlist secret
      configured: true,
      encryptionEnabled: false,
    });

    // Sending clearApiKey: true on an env-only key returns 400 explaining the key comes from AI_API_KEY
    const clearEnvRes = await appNoEnc.inject({
      method: "PUT",
      url: "/ai/settings",
      headers,
      payload: {
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-3-5-haiku-latest",
        clearApiKey: true,
      },
    });
    expect(clearEnvRes.statusCode).toBe(400);
    expect(clearEnvRes.json().error).toMatch(/AI_API_KEY/);

    const rowNoEnc = appNoEnc.db.select().from(settings).where(eq(settings.key, "ai")).get();
    expect(JSON.parse(rowNoEnc?.value ?? "{}").apiKey).toBe("");
    await appNoEnc.close();

    // 2. Even with DB_ENCRYPTION_KEY enabled, an env-sourced key is not copied into the settings row,
    // and clearing a DB override key restores the .env key
    process.env.DB_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64url");
    const appWithEnc = await buildApp();
    const putEncRes = await appWithEnc.inject({
      method: "PUT",
      url: "/ai/settings",
      headers,
      payload: {
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-20250514",
        autoExtractOnSave: true,
      },
    });
    expect(putEncRes.statusCode).toBe(200);
    const rowWithEnc = appWithEnc.db.select().from(settings).where(eq(settings.key, "ai")).get();
    expect(JSON.parse(rowWithEnc?.value ?? "{}").apiKey).toBe("");

    // Override with a DB key, then clear it -> falls back to .env key
    const dbOverrideKey = ["db", "override", "9900"].join("-");
    const overrideRes = await appWithEnc.inject({
      method: "PUT",
      url: "/ai/settings",
      headers,
      payload: {
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: dbOverrideKey, // pragma: allowlist secret
        model: "claude-sonnet-4-20250514",
      },
    });
    expect(overrideRes.json()).toMatchObject({
      hasApiKey: true,
      apiKeyPreview: "***...9900",
      apiKeySource: "db", // pragma: allowlist secret
    });

    const clearedOverrideRes = await appWithEnc.inject({
      method: "PUT",
      url: "/ai/settings",
      headers,
      payload: {
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        clearApiKey: true,
        model: "claude-sonnet-4-20250514",
      },
    });
    expect(clearedOverrideRes.json()).toMatchObject({
      hasApiKey: true,
      apiKeyPreview: "***...7788",
      apiKeySource: "env", // pragma: allowlist secret
    });
    await appWithEnc.close();
  });

  it("runs LLM extraction, caches it on the listing, and fills missing analysis fields without overwriting portal fields", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };

    await app.inject({
      method: "PUT",
      url: "/ai/settings",
      headers,
      payload: {
        provider: "openai",
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "qwen2.5:14b",
        autoExtractOnSave: false,
      },
    });

    const created = await app.inject({
      method: "POST",
      url: "/listings",
      headers,
      payload: {
        source: "immobilienscout24",
        sourceUrl: "https://www.immobilienscout24.de/expose/999",
        externalId: "999",
        title: "Eigentumswohnung mit Potenzial",
        offer: "buy",
        priceEur: 420000,
        livingAreaM2: 80,
        city: "Darmstadt",
        postalCode: "64283",
        state: "HE",
        propertyType: "apartment",
        yearBuilt: 1975,
        energySource: "Gas",
        description: {
          object: "Die Wohnung wurde 2020 umfassend modernisiert. Das monatliche Hausgeld liegt bei 310 EUR. Instandhaltungsrücklage 55.000 EUR.",
          furnishing: null,
          location: null,
          other: null,
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json().listing.condoFeeEur).toBeNull();

    const detailBefore = await app.inject({
      method: "GET",
      url: `/listings/${id}`,
      headers,
    });
    expect(detailBefore.json().descriptionFindings.source).toBe("regex");

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    { key: "renovated", label: "Renovated 2020", snippet: "2020 umfassend modernisiert", year: 2020 },
                    { key: "maintenance_reserve", label: "Maintenance reserve 55,000 €", snippet: "Instandhaltungsrücklage 55.000 EUR", amountEur: 55000 },
                  ],
                  facts: {
                    yearRefurbished: 2020,
                    condoFeeEur: 310,
                    energySource: "Wärmepumpe", // should NOT overwrite stored "Gas"
                  },
                }),
              },
            },
          ],
        }),
    } as Response);

    const extracted = await app.inject({
      method: "POST",
      url: `/ai/extract/${id}`,
      headers,
    });
    expect(extracted.statusCode).toBe(200);
    const body = extracted.json();
    expect(body.descriptionFindings.source).toBe("llm");
    expect(body.descriptionFindings.model).toBe("qwen2.5:14b");
    expect(body.descriptionFindings.filledFields).toEqual(expect.arrayContaining(["condoFeeEur", "yearRefurbished"]));
    expect(body.descriptionFindings.filledFields).not.toContain("energySource");
    expect(body.analysis.monthlyCondoFee).toBe(310);

    // Also test inquiry endpoint on the same listing
    const inquiryDet = await app.inject({
      method: "POST",
      url: `/ai/inquiry/${id}`,
      headers,
      payload: { useLlm: false },
    });
    expect(inquiryDet.statusCode).toBe(200);
    expect(inquiryDet.json().source).toBe("deterministic");
    expect(inquiryDet.json().messageGerman).toContain("Eigentumswohnung mit Potenzial");

    await app.close();
  });

  it("supports in-desk chat with deterministic simulation tools and blocks write tools", async () => {
    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const headers = { authorization: "Bearer test-token" };

    await app.inject({
      method: "PUT",
      url: "/ai/settings",
      headers,
      payload: {
        provider: "openai",
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "qwen2.5:14b",
        autoExtractOnSave: false,
      },
    });

    const created = await app.inject({
      method: "POST",
      url: "/listings",
      headers,
      payload: {
        source: "immobilienscout24",
        sourceUrl: "https://www.immobilienscout24.de/expose/555",
        externalId: "555",
        title: "Altbau Frankfurt",
        offer: "buy",
        priceEur: 500000,
        livingAreaM2: 85,
        city: "Frankfurt am Main",
        postalCode: "60311",
        state: "HE",
        propertyType: "apartment",
        condoFeeEur: 300,
      },
    });
    const listingId = created.json().id as string;

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_sim",
                      type: "function",
                      function: {
                        name: "simulate_analysis",
                        arguments: JSON.stringify({ id: listingId, priceEur: 450000, interestPercent: 3.1 }),
                      },
                    },
                    {
                      id: "call_write",
                      type: "function",
                      function: {
                        name: "update_listing",
                        arguments: JSON.stringify({ id: listingId, status: "pass", notes: "injected" }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: "With a 450,000 € purchase price at 3.1% interest, the score improves.",
                },
              },
            ],
          }),
      } as Response);

    const chatRes = await app.inject({
      method: "POST",
      url: "/ai/chat",
      headers,
      payload: {
        listingId,
        messages: [{ role: "user", content: "What if I negotiate down to 450,000 € at 3.1% interest?" }],
      },
    });
    expect(chatRes.statusCode).toBe(200);
    expect(chatRes.json().toolCalls).toHaveLength(2);
    expect(chatRes.json().toolCalls[0].name).toBe("simulate_analysis");
    expect(chatRes.json().toolCalls[1]).toMatchObject({
      name: "update_listing",
      summary: "Blocked write tool update_listing",
    });
    expect(chatRes.json().reply).toContain("450,000 €");
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Ensure the listing was NOT modified by the blocked tool call
    const unchanged = await app.inject({ method: "GET", url: `/listings/${listingId}`, headers });
    expect(unchanged.json().status).toBe("open");
    expect(unchanged.json().notes).toBe("");

    await app.close();
  });
});
