import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { settings } from "../../src/db/schema.js";

describe("routes/ai", () => {
  afterEach(() => {
    delete process.env.INGEST_TOKEN;
    delete process.env.DB_ENCRYPTION_KEY;
    vi.restoreAllMocks();
  });

  it("enforces the ingest guard on /ai routes (503 when unset, 401 when unauthorized)", async () => {
    delete process.env.INGEST_TOKEN;
    const appNoToken = await buildApp();
    const res503 = await appNoToken.inject({ method: "GET", url: "/ai/settings" });
    expect(res503.statusCode).toBe(503);
    await appNoToken.close();

    process.env.INGEST_TOKEN = "test-token";
    const app = await buildApp();
    const res401 = await app.inject({ method: "GET", url: "/ai/settings" });
    expect(res401.statusCode).toBe(401);
    await app.close();
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
