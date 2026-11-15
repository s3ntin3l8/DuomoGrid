import type { EncryptionService } from "../services/encryption.js";

export type AiProvider = "none" | "openai" | "anthropic";

export type AiSettings = {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
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
  configured: boolean;
};

export type EnvAiDefaults = {
  AI_PROVIDER?: string;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
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

const BLOCKED_HOSTS = new Set([
  "169.254.169.254",
  "100.100.100.200",
  "metadata.google.internal",
  "metadata.goog",
]);

function isLinkLocalHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(lower)) return true;
  if (lower.startsWith("169.254.")) return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fe80%")) return true;
  return false;
}

export function validateAiBaseUrl(
  raw: unknown,
  provider: AiProvider,
): { ok: true; url: string } | { ok: false; error: string } {
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
  if (isLinkLocalHost(parsed.hostname)) {
    return { ok: false, error: "Base URL host is not allowed." };
  }
  const normalized = parsed.toString().replace(/\/+$/, "");
  return { ok: true, url: normalized };
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

export function toPublicAiSettings(settings: AiSettings): AiSettingsPublic {
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    autoExtractOnSave: settings.autoExtractOnSave,
    hasApiKey: Boolean(settings.apiKey.trim()),
    apiKeyPreview: maskApiKey(settings.apiKey),
    configured: isAiConfigured(settings),
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
  const baseDefaults: AiSettings = {
    provider: envProvider,
    baseUrl: envUrlRes.ok ? envUrlRes.url : DEFAULT_AI_SETTINGS.baseUrl,
    apiKey: typeof envDefaults.AI_API_KEY === "string" ? envDefaults.AI_API_KEY.trim() : "",
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
  if (typeof record.apiKey === "string") {
    if (encryption) {
      try {
        apiKey = encryption.decryptString(record.apiKey).trim();
      } catch {
        apiKey = "";
      }
    } else {
      apiKey = record.apiKey.trim();
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
  if (body.clearApiKey === true) {
    apiKey = "";
  } else if (typeof body.apiKey === "string") {
    const trimmed = body.apiKey.trim();
    if (trimmed && !trimmed.startsWith("***")) {
      apiKey = trimmed.slice(0, 512);
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
      model,
      autoExtractOnSave,
    },
  };
}

export function serializeAiSettings(
  settings: AiSettings,
  encryption?: EncryptionService,
): string {
  const storedKey =
    settings.apiKey && encryption
      ? encryption.encryptString(settings.apiKey)
      : settings.apiKey;
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

function openAiEndpoint(baseUrl: string, path: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  if (clean.endsWith("/v1")) return `${clean}${path}`;
  return `${clean}/v1${path}`;
}

function anthropicEndpoint(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/, "");
  if (clean.endsWith("/v1/messages")) return clean;
  if (clean.endsWith("/v1")) return `${clean}/messages`;
  return `${clean}/v1/messages`;
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
    const response = await fetch(openAiEndpoint(settings.baseUrl, "/chat/completions"), {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
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

  const response = await fetch(anthropicEndpoint(settings.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": settings.apiKey.trim(),
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 2048,
      temperature: 0,
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
        temperature: 0.2,
        messages: conversation,
      };
      if (useTools) {
        payload.tools = openAiTools;
        payload.tool_choice = "auto";
      }
      const response = await fetch(
        openAiEndpoint(settings.baseUrl, "/chat/completions"),
        {
          method: "POST",
          headers,
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
    const response = await fetch(anthropicEndpoint(settings.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.apiKey.trim(),
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 2048,
        temperature: 0.2,
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
