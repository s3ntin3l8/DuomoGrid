import type { EncryptionService } from "../services/encryption.js";

export type AiProvider = "none" | "openai" | "anthropic";

export type AiSettings = {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  apiKeySource?: "db" | "env" | "none";
  model: string;
  autoExtractOnSave: boolean;
};

export type AiSettingsPublic = {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  autoExtractOnSave: boolean;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  apiKeySource?: "db" | "env" | "none";
  configured: boolean;
  encryptionEnabled?: boolean;
};

export type EnvAiDefaults = {
  AI_PROVIDER?: string;
  AI_BASE_URL?: string;
  AI_API_KEY?: string; // pragma: allowlist secret
  AI_MODEL?: string;
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "none",
  baseUrl: "http://127.0.0.1:11434/v1",
  apiKey: "",
  model: "",
  autoExtractOnSave: false,
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentToolDef = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type ToolCallRecord = {
  name: string;
  args: Record<string, unknown>;
  summary: string;
};

const ALLOWED_LOCAL_HOSTS = ["127.0.0.1", "localhost", "host.docker.internal"] as const;
type AllowedLocalHost = (typeof ALLOWED_LOCAL_HOSTS)[number];

type SafeAiTarget =
  | { kind: "anthropic" }
  | { kind: "openai" }
  | { kind: "local"; scheme: "http" | "https"; host: AllowedLocalHost; port: number };

function parseSafeAiTarget(
  raw: unknown,
  provider: AiProvider,
): { ok: true; target: SafeAiTarget; url: string } | { ok: false; error: string } {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const fallback =
    provider === "anthropic"
      ? "https://api.anthropic.com"
      : "http://127.0.0.1:11434/v1";
  const candidate = trimmed || fallback;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "Base URL must be a valid http:// or https:// URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Base URL must use http:// or https://." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Base URL must not contain credentials." };
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "api.anthropic.com") {
    if (parsed.protocol !== "https:" || parsed.port) {
      return { ok: false, error: "Anthropic base URL must use https://api.anthropic.com." };
    }
    return { ok: true, target: { kind: "anthropic" }, url: "https://api.anthropic.com" };
  }
  if (host === "api.openai.com") {
    if (parsed.protocol !== "https:" || parsed.port) {
      return { ok: false, error: "OpenAI base URL must use https://api.openai.com/v1." };
    }
    return { ok: true, target: { kind: "openai" }, url: "https://api.openai.com/v1" };
  }
  const localHost = ALLOWED_LOCAL_HOSTS.find((item) => item === host);
  if (!localHost) {
    return {
      ok: false,
      error:
        "Base URL host is not allowed. Use 127.0.0.1, localhost, host.docker.internal, api.openai.com, or api.anthropic.com.",
    };
  }
  const scheme = parsed.protocol === "https:" ? "https" : "http";
  const defaultPort = provider === "anthropic" ? 8000 : 11434;
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "Base URL port must be between 1 and 65535." };
  }
  const suffix = provider === "anthropic" ? "" : "/v1";
  return {
    ok: true,
    target: { kind: "local", scheme, host: localHost, port },
    url: `${scheme}://${localHost}:${port}${suffix}`,
  };
}

export function validateAiBaseUrl(
  raw: unknown,
  provider: AiProvider,
): { ok: true; url: string } | { ok: false; error: string } {
  const res = parseSafeAiTarget(raw, provider);
  if (!res.ok) return res;
  return { ok: true, url: res.url };
}

export function maskApiKey(apiKey: string): string | null {
  const trimmed = apiKey.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) return "********";
  return `***...${trimmed.slice(-4)}`;
}

export function isAiConfigured(settings: AiSettings): boolean {
  if (settings.provider === "none") return false;
  if (!settings.model.trim()) return false;
  if (settings.provider === "anthropic" && !settings.apiKey.trim()) return false;
  return true;
}

export function toPublicAiSettings(
  settings: AiSettings,
  encryption?: EncryptionService,
): AiSettingsPublic {
  const hasApiKey = Boolean(settings.apiKey.trim());
  // Hand-built AiSettings objects without apiKeySource default to "db" so they
  // follow the stored-key path (matching serializeAiSettings's encryption gate).
  const source: "db" | "env" | "none" = hasApiKey // pragma: allowlist secret
    ? (settings.apiKeySource ?? "db") // pragma: allowlist secret
    : "none"; // pragma: allowlist secret
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    autoExtractOnSave: settings.autoExtractOnSave,
    hasApiKey,
    apiKeyPreview: maskApiKey(settings.apiKey),
    apiKeySource: source,
    configured: isAiConfigured(settings),
    ...(encryption !== undefined ? { encryptionEnabled: encryption.isEnabled } : {}),
  };
}

function providerOf(value: unknown, fallback: AiProvider = "none"): AiProvider {
  if (value === "openai" || value === "anthropic" || value === "none") return value;
  return fallback;
}

export function normalizeAiSettings(
  stored: unknown,
  envDefaults: EnvAiDefaults = {},
  encryption?: EncryptionService,
): AiSettings {
  const envProvider = providerOf(envDefaults.AI_PROVIDER, "none");
  const envUrlRes = validateAiBaseUrl(envDefaults.AI_BASE_URL, envProvider);
  const envKeyRaw = envDefaults["AI_API_KEY"]; // pragma: allowlist secret
  const envKey = typeof envKeyRaw === "string" ? envKeyRaw.trim() : "";
  const baseDefaults: AiSettings = {
    provider: envProvider,
    baseUrl: envUrlRes.ok ? envUrlRes.url : DEFAULT_AI_SETTINGS.baseUrl,
    apiKey: envKey,
    apiKeySource: envKey ? "env" : "none", // pragma: allowlist secret
    model: typeof envDefaults.AI_MODEL === "string" ? envDefaults.AI_MODEL.trim().slice(0, 120) : "",
    autoExtractOnSave: false,
  };

  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return baseDefaults;
  }
  const record = stored as Record<string, unknown>;
  const provider = providerOf(record.provider, baseDefaults.provider);
  const urlRes = validateAiBaseUrl(record.baseUrl ?? baseDefaults.baseUrl, provider);
  let apiKey = baseDefaults.apiKey;
  let apiKeySource: "db" | "env" | "none" = baseDefaults.apiKeySource ?? "none"; // pragma: allowlist secret
  if (typeof record.apiKey === "string") { // pragma: allowlist secret
    const rawStoredKey = record.apiKey.trim();
    if (rawStoredKey) {
      if (encryption?.isEnabled && rawStoredKey.startsWith("enc:")) {
        try {
          const decrypted = encryption.decryptString(rawStoredKey).trim();
          apiKey = decrypted;
          apiKeySource = decrypted ? "db" : "none"; // pragma: allowlist secret
        } catch {
          apiKey = baseDefaults.apiKey;
          apiKeySource = baseDefaults.apiKeySource ?? "none"; // pragma: allowlist secret
        }
      } else {
        apiKey = baseDefaults.apiKey;
        apiKeySource = baseDefaults.apiKeySource ?? "none"; // pragma: allowlist secret
      }
    }
  }
  const model =
    typeof record.model === "string"
      ? record.model.trim().slice(0, 120)
      : baseDefaults.model;
  const autoExtractOnSave =
    typeof record.autoExtractOnSave === "boolean"
      ? record.autoExtractOnSave
      : baseDefaults.autoExtractOnSave;

  return {
    provider,
    baseUrl: urlRes.ok ? urlRes.url : baseDefaults.baseUrl,
    apiKey,
    apiKeySource,
    model,
    autoExtractOnSave,
  };
}

export function applyAiSettingsUpdate(
  current: AiSettings,
  input: unknown,
): { ok: true; settings: AiSettings } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Expected an AI settings object." };
  }
  const body = input as Record<string, unknown>;
  const provider =
    body.provider !== undefined
      ? providerOf(body.provider, current.provider)
      : current.provider;
  if (
    body.provider !== undefined &&
    body.provider !== "none" &&
    body.provider !== "openai" &&
    body.provider !== "anthropic"
  ) {
    return { ok: false, error: "Provider must be none, openai, or anthropic." };
  }

  const rawBaseUrl =
    body.baseUrl !== undefined ? body.baseUrl : current.baseUrl;
  const urlRes = validateAiBaseUrl(rawBaseUrl, provider);
  if (!urlRes.ok) return urlRes;

  const model =
    typeof body.model === "string"
      ? body.model.trim().slice(0, 120)
      : current.model;

  let apiKey = current.apiKey;
  let apiKeySource: "db" | "env" | "none" = // pragma: allowlist secret
    current.apiKeySource ?? (current.apiKey.trim() ? "db" : "none"); // pragma: allowlist secret
  if (body.clearApiKey === true) {
    if (apiKeySource === "env") { // pragma: allowlist secret
      return {
        ok: false,
        error: "The active API key comes from AI_API_KEY in .env and cannot be cleared from the database.",
      };
    }
    apiKey = "";
    apiKeySource = "none"; // pragma: allowlist secret
  } else if (typeof body.apiKey === "string") { // pragma: allowlist secret
    const trimmed = body.apiKey.trim();
    if (trimmed && !trimmed.startsWith("***")) {
      apiKey = trimmed.slice(0, 512);
      apiKeySource = "db"; // pragma: allowlist secret
    }
  }

  const autoExtractOnSave =
    typeof body.autoExtractOnSave === "boolean"
      ? body.autoExtractOnSave
      : current.autoExtractOnSave;

  return {
    ok: true,
    settings: {
      provider,
      baseUrl: urlRes.url,
      apiKey,
      apiKeySource,
      model,
      autoExtractOnSave,
    },
  };
}

export function serializeAiSettings(
  settings: AiSettings,
  encryption?: EncryptionService,
): string {
  // Never persist an environment-sourced AI_API_KEY into the SQLite settings row.
  const dbKey = settings.apiKeySource === "env" ? "" : settings.apiKey.trim();
  if (dbKey && !encryption?.isEnabled) {
    throw new Error(
      "Set DB_ENCRYPTION_KEY on the server before storing an API key in the database, or set AI_API_KEY in .env.",
    );
  }
  const storedKey =
    dbKey && encryption?.isEnabled ? encryption.encryptString(dbKey) : "";
  return JSON.stringify({
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    apiKey: storedKey,
    model: settings.model,
    autoExtractOnSave: settings.autoExtractOnSave,
  });
}

export function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("Model response did not contain valid JSON.");
  }
}

function openAiChatCompletionsUrl(baseUrl: string): URL {
  const parsed = parseSafeAiTarget(baseUrl, "openai");
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  const { target } = parsed;
  if (target.kind === "openai") {
    return new URL("https://api.openai.com/v1/chat/completions");
  }
  if (target.kind === "anthropic") {
    throw new Error("Anthropic URL cannot be used with OpenAI provider.");
  }
  const base =
    target.host === "localhost"
      ? target.scheme === "https"
        ? "https://localhost"
        : "http://localhost"
      : target.host === "host.docker.internal"
        ? target.scheme === "https"
          ? "https://host.docker.internal"
          : "http://host.docker.internal"
        : target.scheme === "https"
          ? "https://127.0.0.1"
          : "http://127.0.0.1";
  const url = new URL("/v1/chat/completions", base);
  url.port = String(target.port);
  return url;
}

function anthropicMessagesUrl(baseUrl: string): URL {
  const parsed = parseSafeAiTarget(baseUrl, "anthropic");
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  const { target } = parsed;
  if (target.kind === "anthropic") {
    return new URL("https://api.anthropic.com/v1/messages");
  }
  if (target.kind === "openai") {
    throw new Error("OpenAI URL cannot be used with Anthropic provider.");
  }
  const base =
    target.host === "localhost"
      ? target.scheme === "https"
        ? "https://localhost"
        : "http://localhost"
      : target.host === "host.docker.internal"
        ? target.scheme === "https"
          ? "https://host.docker.internal"
          : "http://host.docker.internal"
        : target.scheme === "https"
          ? "https://127.0.0.1"
          : "http://127.0.0.1";
  const url = new URL("/v1/messages", base);
  url.port = String(target.port);
  return url;
}

export type AiModel = { id: string; name: string };

export async function listAiModels(settings: AiSettings): Promise<AiModel[]> {
  if (settings.provider === "none") throw new Error("Select an AI provider first.");
  if (settings.provider === "anthropic" && !settings.apiKey.trim()) {
    throw new Error("Enter an Anthropic API key to load models.");
  }
  // Reuse the completion target validation, including the host/port allowlist.
  const url = settings.provider === "anthropic"
    ? anthropicMessagesUrl(settings.baseUrl)
    : openAiChatCompletionsUrl(settings.baseUrl);
  url.pathname = "/v1/models";
  const headers: Record<string, string> = {};
  if (settings.provider === "anthropic") {
    headers["x-api-key"] = settings.apiKey.trim();
    headers["anthropic-version"] = "2023-06-01";
    url.searchParams.set("limit", "1000");
  } else if (settings.apiKey.trim()) {
    headers.authorization = `Bearer ${settings.apiKey.trim()}`;
  }
  const models = new Map<string, AiModel>();
  const cursors = new Set<string>();
  const signal = AbortSignal.timeout(15_000);
  for (let page = 0; page < 20; page += 1) {
    const response = await fetch(new URL(url), { headers, redirect: "error", signal });
    if (!response.ok) {
      // Provider error bodies can contain credentials; keep discovery errors generic.
      throw new Error(`Could not load models (${response.status}). Check the provider URL and API key.`);
    }
    const data = await response.json() as {
      data?: { id?: unknown; display_name?: unknown }[];
      has_more?: boolean;
      last_id?: unknown;
    };
    if (!Array.isArray(data.data)) throw new Error("Provider returned an invalid model list.");
    for (const item of data.data) {
      if (typeof item?.id !== "string" || !item.id.trim() || item.id.length > 120) continue;
      models.set(item.id, {
        id: item.id,
        name: typeof item.display_name === "string" ? item.display_name : item.id,
      });
    }
    if (settings.provider !== "anthropic" || !data.has_more) {
      return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    if (typeof data.last_id !== "string" || !data.last_id || cursors.has(data.last_id)) {
      throw new Error("Provider returned an invalid model pagination cursor.");
    }
    cursors.add(data.last_id);
    url.searchParams.set("after_id", data.last_id);
  }
  throw new Error("Provider returned too many model pages.");
}

export async function completeJson<T>(
  settings: AiSettings,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs = 45_000,
): Promise<T> {
  if (!isAiConfigured(settings)) {
    throw new Error("AI provider is not configured.");
  }
  if (settings.provider === "openai") {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (settings.apiKey.trim()) {
      headers.authorization = `Bearer ${settings.apiKey.trim()}`;
    }
    const response = await fetch(openAiChatCompletionsUrl(settings.baseUrl), {
      method: "POST",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: settings.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`OpenAI-compatible request failed (${response.status}): ${detail.slice(0, 240)}`);
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    return extractJsonFromText(content) as T;
  }

  const response = await fetch(anthropicMessagesUrl(settings.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.apiKey.trim(),
      "anthropic-version": "2023-06-01",
    },
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Anthropic request failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  const data = (await response.json()) as {
    content?: { type: string; text?: string }[];
  };
  const textBlock = data.content?.find((part) => part.type === "text")?.text ?? "";
  return extractJsonFromText(textBlock) as T;
}

export async function testAiProvider(
  settings: AiSettings,
  timeoutMs = 15_000,
): Promise<{ ok: boolean; model: string; latencyMs: number; error?: string }> {
  const start = Date.now();
  if (!isAiConfigured(settings)) {
    return {
      ok: false,
      model: settings.model,
      latencyMs: 0,
      error: "Configure a provider, model name, and (for Anthropic) API key first.",
    };
  }
  try {
    const res = await completeJson<{ status?: string }>(
      settings,
      'Reply only with the JSON object {"status":"ok"}.',
      "Ping",
      timeoutMs,
    );
    return {
      ok: Boolean(res && typeof res === "object"),
      model: settings.model,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      model: settings.model,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

type OpenAiChatMsg =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export async function runAgentChat(
  settings: AiSettings,
  opts: {
    system: string;
    messages: ChatMessage[];
    tools: AgentToolDef[];
    executeTool: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ result: unknown; summary: string }>;
    maxSteps?: number;
    timeoutMs?: number;
  },
): Promise<{ reply: string; toolCalls: ToolCallRecord[] }> {
  if (!isAiConfigured(settings)) {
    throw new Error("AI provider is not configured. Open the AI settings in the desk to set up Ollama, LM Studio, OpenAI, or Anthropic.");
  }
  const maxSteps = opts.maxSteps ?? 4;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const toolCalls: ToolCallRecord[] = [];

  if (settings.provider === "openai") {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (settings.apiKey.trim()) {
      headers.authorization = `Bearer ${settings.apiKey.trim()}`;
    }
    const conversation: OpenAiChatMsg[] = [
      { role: "system", content: opts.system },
      ...opts.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    ];
    const openAiTools = opts.tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));

    let useTools = openAiTools.length > 0;
    for (let step = 0; step < maxSteps; step += 1) {
      const payload: Record<string, unknown> = {
        model: settings.model,
        messages: conversation,
      };
      if (useTools) {
        payload.tools = openAiTools;
        payload.tool_choice = "auto";
      }
      const response = await fetch(
        openAiChatCompletionsUrl(settings.baseUrl),
        {
          method: "POST",
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        if (useTools && step === 0 && response.status === 400) {
          useTools = false;
          step -= 1;
          continue;
        }
        throw new Error(
          `OpenAI-compatible chat failed (${response.status}): ${errText.slice(0, 240)}`,
        );
      }
      const data = (await response.json()) as {
        choices?: {
          message?: {
            content?: string | null;
            tool_calls?: {
              id: string;
              type: "function";
              function: { name: string; arguments: string };
            }[];
          };
        }[];
      };
      const message = data.choices?.[0]?.message;
      if (!message) {
        return { reply: "No response from model.", toolCalls };
      }
      const calls = message.tool_calls ?? [];
      if (!calls.length || step === maxSteps - 1) {
        return { reply: (message.content ?? "").trim(), toolCalls };
      }
      conversation.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: calls,
      });
      for (const call of calls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          const raw = JSON.parse(call.function.arguments || "{}") as unknown;
          if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            parsedArgs = raw as Record<string, unknown>;
          }
        } catch {
          parsedArgs = {};
        }
        const executed = await opts.executeTool(call.function.name, parsedArgs);
        toolCalls.push({
          name: call.function.name,
          args: parsedArgs,
          summary: executed.summary,
        });
        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(executed.result),
        });
      }
    }
    return { reply: "Completed tool calls.", toolCalls };
  }

  // Anthropic Messages API
  type AnthropicContentBlock =
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    | { type: "tool_result"; tool_use_id: string; content: string };

  const anthropicMessages: {
    role: "user" | "assistant";
    content: string | AnthropicContentBlock[];
  }[] = opts.messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  const anthropicTools = opts.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));

  for (let step = 0; step < maxSteps; step += 1) {
    const response = await fetch(anthropicMessagesUrl(settings.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.apiKey.trim(),
        "anthropic-version": "2023-06-01",
      },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 2048,
        system: opts.system,
        tools: anthropicTools,
        messages: anthropicMessages,
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `Anthropic chat failed (${response.status}): ${errText.slice(0, 240)}`,
      );
    }
    const data = (await response.json()) as {
      stop_reason?: string;
      content?: AnthropicContentBlock[];
    };
    const blocks = data.content ?? [];
    const toolUses = blocks.filter(
      (block): block is Extract<AnthropicContentBlock, { type: "tool_use" }> =>
        block.type === "tool_use",
    );
    if (!toolUses.length || step === maxSteps - 1) {
      const text = blocks
        .filter(
          (block): block is Extract<AnthropicContentBlock, { type: "text" }> =>
            block.type === "text",
        )
        .map((block) => block.text)
        .join("\n")
        .trim();
      return { reply: text, toolCalls };
    }
    anthropicMessages.push({
      role: "assistant",
      content: blocks,
    });
    const results: AnthropicContentBlock[] = [];
    for (const use of toolUses) {
      const args =
        use.input && typeof use.input === "object" && !Array.isArray(use.input)
          ? use.input
          : {};
      const executed = await opts.executeTool(use.name, args);
      toolCalls.push({
        name: use.name,
        args,
        summary: executed.summary,
      });
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(executed.result),
      });
    }
    anthropicMessages.push({
      role: "user",
      content: results,
    });
  }
  return { reply: "Completed tool calls.", toolCalls };
}
