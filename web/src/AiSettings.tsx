import { useState } from "react";
import type { AiProvider, AiSettingsPublic, AiSettingsUpdate } from "./api";

const PRESETS: { label: string; provider: AiProvider; baseUrl: string; modelHint: string }[] = [
  {
    label: "Ollama (local)",
    provider: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
    modelHint: "qwen2.5:14b",
  },
  {
    label: "LM Studio (local)",
    provider: "openai",
    baseUrl: "http://127.0.0.1:1234/v1",
    modelHint: "local-model",
  },
  {
    label: "OpenAI API",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    modelHint: "gpt-4o-mini",
  },
  {
    label: "Anthropic (Claude)",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    modelHint: "claude-sonnet-4-20250514",
  },
];

export function AiSettingsForm({
  initial,
  onSave,
  onTest,
}: {
  initial: AiSettingsPublic;
  onSave: (body: AiSettingsUpdate) => Promise<AiSettingsPublic>;
  onTest: (body: AiSettingsUpdate) => Promise<{ ok: boolean; model: string; latencyMs: number; error?: string }>;
}) {
  const [provider, setProvider] = useState<AiProvider>(initial.provider);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [autoExtractOnSave, setAutoExtractOnSave] = useState(initial.autoExtractOnSave);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");

  function currentPayload(): AiSettingsUpdate {
    return {
      provider,
      baseUrl,
      model,
      autoExtractOnSave,
      ...(clearApiKey ? { clearApiKey: true } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    };
  }

  return (
    <div className="panel">
      <p className="kicker">Agent-native extraction, chat & MCP</p>
      <h2>AI & Agents</h2>
      <p className="lede">
        Connect a local model (Ollama, LM Studio) or a cloud API (OpenAI, Anthropic) to extract facts from German descriptions, draft Makler inquiries, and chat with DuomoGrid&apos;s calculator. When disabled, deterministic regex extraction runs on its own.
      </p>

      <div className="filters" style={{ marginBottom: 12 }}>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="chip"
            onClick={() => {
              setProvider(preset.provider);
              setBaseUrl(preset.baseUrl);
              if (!model) setModel(preset.modelHint);
              setStatusMsg("");
              setError("");
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setStatusMsg("");
          void onSave(currentPayload())
            .then((saved) => {
              setApiKey("");
              setClearApiKey(false);
              setStatusMsg(saved.configured ? `Saved (${saved.provider} · ${saved.model}).` : "Saved (AI disabled or incomplete).");
            })
            .catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : "Could not save AI settings.");
            })
            .finally(() => setBusy(false));
        }}
      >
        <div className="fields">
          <label>
            Provider
            <select
              value={provider}
              onChange={(event) => {
                const next = event.target.value as AiProvider;
                setProvider(next);
                if (next === "anthropic" && baseUrl.includes("11434")) {
                  setBaseUrl("https://api.anthropic.com");
                } else if (next === "openai" && baseUrl.includes("anthropic.com")) {
                  setBaseUrl("http://127.0.0.1:11434/v1");
                }
              }}
            >
              <option value="none">Disabled (Regex only)</option>
              <option value="openai">OpenAI-compatible (Ollama, LM Studio, OpenAI)</option>
              <option value="anthropic">Anthropic (Claude Console API)</option>
            </select>
          </label>

          {provider !== "none" ? (
            <>
              <div className="pair">
                <label>
                  Base URL
                  <input
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder={provider === "anthropic" ? "https://api.anthropic.com" : "http://127.0.0.1:11434/v1"}
                  />
                </label>
                <label>
                  Model name
                  <input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder={provider === "anthropic" ? "claude-sonnet-4-20250514" : "qwen2.5:14b or gpt-4o-mini"}
                  />
                </label>
              </div>

              <label>
                API key {provider === "openai" ? "(optional for local Ollama / LM Studio)" : "(required for Anthropic)"}
                <input
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    if (event.target.value) setClearApiKey(false);
                  }}
                  placeholder={
                    clearApiKey
                      ? "Key will be cleared on save"
                      : initial.apiKeyPreview
                        ? `Stored: ${initial.apiKeyPreview} (leave blank to keep)`
                        : "Paste API key"
                  }
                />
              </label>

              {initial.hasApiKey && !clearApiKey ? (
                <div className="row-actions">
                  <span className="meta">Stored key: {initial.apiKeyPreview}</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setClearApiKey(true);
                      setApiKey("");
                    }}
                  >
                    Clear stored key
                  </button>
                </div>
              ) : null}

              <div className="choice">
                <label>
                  <input
                    type="checkbox"
                    checked={autoExtractOnSave}
                    onChange={(event) => setAutoExtractOnSave(event.target.checked)}
                  />
                  Automatically extract description findings with AI when saving a new listing
                </label>
              </div>
            </>
          ) : null}
        </div>

        {error ? <p className="error">{error}</p> : null}
        {statusMsg ? <p className="note">{statusMsg}</p> : null}

        <div className="row-actions" style={{ marginTop: 14 }}>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save AI settings"}
          </button>
          {provider !== "none" ? (
            <button
              className="quiet"
              type="button"
              disabled={testing}
              onClick={() => {
                setTesting(true);
                setError("");
                setStatusMsg("");
                void onTest(currentPayload())
                  .then((res) => {
                    if (res.ok) {
                      setStatusMsg(`Connected to ${res.model} (${res.latencyMs} ms).`);
                    } else {
                      setError(res.error ?? "Connection test failed.");
                    }
                  })
                  .catch((reason: unknown) => {
                    setError(reason instanceof Error ? reason.message : "Connection test failed.");
                  })
                  .finally(() => setTesting(false));
              }}
            >
              {testing ? "Testing…" : "Test connection"}
            </button>
          ) : null}
        </div>
      </form>

      <section className="block" style={{ marginTop: 22 }}>
        <h3>Model Context Protocol (MCP)</h3>
        <p className="meta">
          External agents (Claude Desktop, Claude Code, Cursor, OpenCode) can query your saved listings, run what-if financing simulations, and generate Makler inquiries via MCP.
        </p>
        <p className="note">
          <strong>1. Local stdio server</strong> (reads SQLite directly):
        </p>
        <pre className="code-box">{`{
  "mcpServers": {
    "duomogrid": {
      "command": "npm",
      "args": ["run", "--silent", "mcp"]
    }
  }
}`}</pre>
        <p className="note">
          <strong>2. Streamable HTTP endpoint</strong> (guarded by your bearer ingest token):
        </p>
        <pre className="code-box">{`POST /mcp
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json`}</pre>
      </section>
    </div>
  );
}
