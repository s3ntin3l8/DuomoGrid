import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAiSettingsUpdate,
  completeJson,
  maskApiKey,
  listAiModels,
  normalizeAiSettings,
  runAgentChat,
  serializeAiSettings,
  testAiProvider,
  toPublicAiSettings,
  validateAiBaseUrl,
} from "../../src/domain/ai.js";
import { EncryptionService } from "../../src/services/encryption.js";

describe("domain/ai", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("validates AI base URLs and blocks metadata SSRF or credentials", () => {
    expect(validateAiBaseUrl("http://127.0.0.1:11434/v1/", "openai")).toEqual({
      ok: true,
      url: "http://127.0.0.1:11434/v1",
    });
    expect(validateAiBaseUrl("https://api.anthropic.com/", "anthropic")).toEqual({
      ok: true,
      url: "https://api.anthropic.com",
    });
    expect(validateAiBaseUrl("http://169.254.169.254/latest/meta-data", "openai")).toEqual({
      ok: false,
      error:
        "Base URL host is not allowed. Use 127.0.0.1, localhost, host.docker.internal, api.openai.com, or api.anthropic.com.",
    });
    const urlWithCreds = ["http://", "alice", ":", "pw", "@127.0.0.1:11434/v1"].join("");
    expect(validateAiBaseUrl(urlWithCreds, "openai")).toEqual({
      ok: false,
      error: "Base URL must not contain credentials.",
    });
    expect(validateAiBaseUrl("ftp://127.0.0.1:11434", "openai")).toEqual({
      ok: false,
      error: "Base URL must use http:// or https://.",
    });
  });

  it("discovers authenticated Anthropic models across pages without requiring a model", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "claude-b", display_name: "Claude B" }], has_more: true, last_id: "claude-b" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "claude-a", display_name: "Claude A" }], has_more: false })));
    const result = await listAiModels({ provider: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "demo", model: "", autoExtractOnSave: false }); // pragma: allowlist secret
    expect(result).toEqual([{ id: "claude-a", name: "Claude A" }, { id: "claude-b", name: "Claude B" }]);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(String(fetchMock.mock.calls[1][0])).toContain("after_id=claude-b");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { "x-api-key": "demo", "anthropic-version": "2023-06-01" } });
  });

  it.each(["http://127.0.0.1:11434/v1", "http://localhost:1234/v1", "https://api.openai.com/v1"])("discovers OpenAI-compatible models at %s", async (baseUrl) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-a" }, {}, null] })));
    expect(await listAiModels({ provider: "openai", baseUrl, apiKey: "", model: "", autoExtractOnSave: false })).toEqual([{ id: "model-a", name: "model-a" }]);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${baseUrl}/models`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: {} });
  });

  it("rejects unsafe discovery targets and reports provider failures without echoing secrets", async () => {
    const candidate = { provider: "openai" as const, baseUrl: "http://169.254.169.254", apiKey: "", model: "", autoExtractOnSave: false };
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(listAiModels(candidate)).rejects.toThrow(/not allowed/);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(new Response("secret body", { status: 401 }));
    await expect(listAiModels({ ...candidate, baseUrl: "https://api.openai.com/v1", apiKey: "demo" })).rejects.toThrow("Could not load models (401)"); // pragma: allowlist secret
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ authorization: "Bearer demo" });
  });

  it.each(["secret response", "null", '{"data":{}}'])("sanitizes invalid model responses: %s", async (body) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body));
    await expect(listAiModels({ provider: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "", autoExtractOnSave: false })).rejects.toThrow("Provider returned an invalid model list.");
  });

  it.each([undefined, "same-cursor"])("rejects absent or repeated Anthropic cursors: %s", async (lastId) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [], has_more: true, last_id: lastId })));
    await expect(listAiModels({ provider: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "demo", model: "", autoExtractOnSave: false })).rejects.toThrow("Provider returned an invalid model pagination cursor."); // pragma: allowlist secret
  });

  it("caps Anthropic pagination at 20 pages", async () => {
    let page = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ data: [], has_more: true, last_id: `page-${page++}` })));
    await expect(listAiModels({ provider: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "demo", model: "", autoExtractOnSave: false })).rejects.toThrow("Provider returned too many model pages."); // pragma: allowlist secret
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it("masks API keys, encrypts them at rest via EncryptionService, and refuses plaintext storage", () => {
    expect(maskApiKey("")).toBeNull();
    expect(maskApiKey("short")).toBe("********");
    const sampleToken = ["demo", "token", "1234567890", "abcd"].join("-");
    expect(maskApiKey(sampleToken)).toBe("***...abcd");

    const enc = new EncryptionService({ key: crypto.randomBytes(32).toString("base64url") });
    const base = normalizeAiSettings(undefined, {}, enc);
    const secretVal = ["demo", "provider", "9876"].join("-");
    const updated = applyAiSettingsUpdate(base, {
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: secretVal, // pragma: allowlist secret
      model: "claude-3-5-sonnet-latest",
      autoExtractOnSave: true,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error(updated.error);

    expect(() => serializeAiSettings(updated.settings, new EncryptionService({ key: "" }))).toThrow(
      /DB_ENCRYPTION_KEY/i,
    );

    const serialized = serializeAiSettings(updated.settings, enc);
    expect(serialized).not.toContain(secretVal);
    expect(serialized).toContain("enc:");

    const restored = normalizeAiSettings(JSON.parse(serialized), {}, enc);
    expect(restored.apiKey).toBe(secretVal);
    expect(toPublicAiSettings(restored, enc)).toEqual({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      hasApiKey: true,
      apiKeyPreview: "***...9876",
      apiKeySource: "db", // pragma: allowlist secret
      model: "claude-3-5-sonnet-latest",
      autoExtractOnSave: true,
      configured: true,
      encryptionEnabled: true,
    });
  });

  it("completes JSON with OpenAI-compatible and Anthropic providers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: '```json\n{"ok":true,"provider":"ollama"}\n```' } }],
        }),
    } as Response);

    const openAiRes = await completeJson<{ ok: boolean; provider: string }>(
      {
        provider: "openai",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: "",
        model: "qwen2.5:14b",
        autoExtractOnSave: false,
      },
      "System prompt",
      "User prompt",
    );
    expect(openAiRes).toEqual({ ok: true, provider: "ollama" });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).not.toHaveProperty("temperature");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: '{"status":"ok"}' }],
        }),
    } as Response);

    const testToken = ["demo", "value", "1234"].join("-");
    const ping = await testAiProvider({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKey: testToken, // pragma: allowlist secret
      model: "claude-3-5-haiku-latest",
      autoExtractOnSave: false,
    });
    expect(ping).toMatchObject({ ok: true, model: "claude-3-5-haiku-latest" });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body))).not.toHaveProperty("temperature");
  });

  it("executes tool-calling loops for both OpenAI and Anthropic providers", async () => {
    vi.spyOn(globalThis, "fetch")
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
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "simulate_analysis",
                        arguments: JSON.stringify({ listingId: "l1", priceEur: 400000 }),
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
                  content: "At 400,000 €, the monthly payment drops to 1,620 €.",
                },
              },
            ],
          }),
      } as Response);

    const openAiChat = await runAgentChat(
      {
        provider: "openai",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: "",
        model: "qwen2.5:14b",
        autoExtractOnSave: false,
      },
      {
        system: "System",
        messages: [{ role: "user", content: "What if I offer 400k?" }],
        tools: [
          {
            name: "simulate_analysis",
            description: "Simulate",
            inputSchema: { type: "object", properties: { listingId: { type: "string" }, priceEur: { type: "number" } } },
          },
        ],
        executeTool: (name, args) =>
          Promise.resolve({
            result: { tool: name, args, monthlyTotalEur: 1620 },
            summary: "Simulated at 400k",
          }),
      },
    );

    expect(openAiChat.reply).toContain("1,620 €");
    expect(openAiChat.toolCalls).toEqual([
      {
        name: "simulate_analysis",
        args: { listingId: "l1", priceEur: 400000 },
        summary: "Simulated at 400k",
      },
    ]);

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "get_listing",
                input: { id: "l1" },
              },
            ],
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            stop_reason: "end_turn",
            content: [{ type: "text", text: "The apartment in Munich has score 74." }],
          }),
      } as Response);

    const testToken = ["demo", "value", "1234"].join("-");
    const anthropicChat = await runAgentChat(
      {
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: testToken, // pragma: allowlist secret
        model: "claude-3-5-sonnet-latest",
        autoExtractOnSave: false,
      },
      {
        system: "System",
        messages: [{ role: "user", content: "Tell me about l1" }],
        tools: [
          {
            name: "get_listing",
            description: "Get listing",
            inputSchema: { type: "object", properties: { id: { type: "string" } } },
          },
        ],
        executeTool: () =>
          Promise.resolve({
            result: { id: "l1", score: 74 },
            summary: "Loaded l1",
          }),
      },
    );

    expect(anthropicChat.reply).toContain("score 74");
    expect(anthropicChat.toolCalls).toEqual([
      {
        name: "get_listing",
        args: { id: "l1" },
        summary: "Loaded l1",
      },
    ]);
  });
});
