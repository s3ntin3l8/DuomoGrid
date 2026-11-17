import { useEffect, useState } from "react";
import type { AiModel, AiProvider, AiSettingsPublic, AiSettingsUpdate } from "./api";

const PRESETS: { label: string; provider: AiProvider; baseUrl: string }[] = [
  {
    label: "Ollama (local)",
    provider: "openai",
    baseUrl: "http://127.0.0.1:11434/v1",
  },
  {
    label: "LM Studio (local)",
    provider: "openai",
    baseUrl: "http://127.0.0.1:1234/v1",
  },
  {
    label: "OpenAI API",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    label: "Anthropic (Claude)",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
  },
];

function parseUrlParts(raw: string): { hostname: string; port: string } {
  try {
    const parsed = new URL(raw);
    return { hostname: parsed.hostname.toLowerCase(), port: parsed.port };
  } catch {
    return { hostname: "", port: "" };
  }
}

export function AiSettingsForm({
  initial,
  onSave,
  onTest,
  onLoadModels,
}: {
  initial: AiSettingsPublic;
  onLoadModels?: (body: AiSettingsUpdate) => Promise<{ models: AiModel[] }>;
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

  const [models, setModels] = useState<AiModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState("");
  const [reloadModels, setReloadModels] = useState(0);
  const [manualModel, setManualModel] = useState(false);

  useEffect(() => {
    let active = true;
    setModels([]);
    setModelError("");
    setLoadingModels(provider !== "none" && Boolean(onLoadModels));
    if (provider === "none" || !onLoadModels) return;
    const timer = window.setTimeout(() => {
      void onLoadModels({ provider, baseUrl, ...(clearApiKey ? { clearApiKey: true } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })
        .then((result) => {
          if (active) setModels(result.models);
        })
        .catch((reason: unknown) => {
          if (active) setModelError(reason instanceof Error ? reason.message : "Could not load models.");
        })
        .finally(() => { if (active) setLoadingModels(false); });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [provider, baseUrl, apiKey, clearApiKey, reloadModels, onLoadModels]);

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
              setModel("");
              setManualModel(false);
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
                setModel("");
                setManualModel(false);
                const current = parseUrlParts(baseUrl);
                if (next === "anthropic" && current.port === "11434") {
                  setBaseUrl("https://api.anthropic.com");
                } else if (next === "openai" && current.hostname === "api.anthropic.com") {
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
                  <small className="meta">
                    Allowed hosts: <code>127.0.0.1</code>, <code>localhost</code> (use for IPv6 loopback), <code>host.docker.internal</code>, <code>api.openai.com</code>, <code>api.anthropic.com</code>.
                  </small>
                </label>
                <label>
                  Model name
                  <select
                    aria-label="Model name"
                    value={manualModel ? "__manual__" : model}
                    onChange={(event) => {
                      if (event.target.value === "__manual__") setManualModel(true);
                      else { setManualModel(false); setModel(event.target.value); }
                    }}
                    aria-busy={loadingModels}
                  >
                    <option value="">{loadingModels ? "Loading models…" : "Select a model"}</option>
                    {model && !models.some((item) => item.id === model) ? <option value={model}>{model} (current)</option> : null}
                    {models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    <option value="__manual__">Enter model manually…</option>
                  </select>
                </label>
              </div>
              {manualModel ? <label>Custom model name<input value={model} onChange={(event) => setModel(event.target.value)} /></label> : null}
              <div className="row-actions">
                <button type="button" className="text-button" disabled={loadingModels} onClick={() => setReloadModels((value) => value + 1)}>Refresh models</button>
                <span className="meta" role="status">{loadingModels ? "Loading models…" : modelError || (models.length ? `${models.length} models available.` : "No models loaded. You can enter a model manually.")}</span>
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
                        ? initial.apiKeySource === "env" // pragma: allowlist secret
                          ? `From .env: ${initial.apiKeyPreview} (leave blank to keep)`
                          : `Stored: ${initial.apiKeyPreview} (leave blank to keep)`
                        : "Paste API key"
                  }
                />
              </label>

              {initial.encryptionEnabled === false ? (
                <p className="meta">
                  Note: <code>DB_ENCRYPTION_KEY</code> is not configured on the server, so saving an API key in the database is disabled until encryption at rest is turned on (local keyless providers like Ollama work without one).
                </p>
              ) : null}

              {initial.hasApiKey && initial.apiKeySource === "env" ? ( // pragma: allowlist secret
                <p className="meta">
                  Using <code>AI_API_KEY</code> from <code>.env</code> ({initial.apiKeyPreview}).
                </p>
              ) : null}

              {initial.hasApiKey && initial.apiKeySource !== "env" && !clearApiKey ? ( // pragma: allowlist secret
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
