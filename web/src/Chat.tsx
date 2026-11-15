import { useState } from "react";
import {
  sendChatMessage,
  type ChatMessage,
  type DeskListing,
} from "./api";

const LISTING_PROMPTS = [
  "What if I negotiate 10% off the asking price?",
  "Summarize the main risks and missing facts for this listing.",
  "What happens to the monthly payment if interest rates are 4.2%?",
  "Draft polite German questions for the Makler covering the gaps.",
];

const PORTFOLIO_PROMPTS = [
  "Compare my top saved buy listings on monthly cost and score.",
  "Which saved listing has the best 10-year buy-vs-rent net wealth?",
  "Which open listings are missing an energy certificate or condo fee?",
];

export function ChatPanel({
  token,
  active,
  aiConfigured,
  onOpenAiSettings,
}: {
  token: string;
  active: DeskListing | null;
  aiConfigured: boolean;
  onOpenAiSettings: () => void;
}) {
  const [scope, setScope] = useState<"listing" | "portfolio">(active ? "listing" : "portfolio");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toolHistory, setToolHistory] = useState<Record<number, { name: string; summary: string }[]>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const targetListingId = scope === "listing" && active ? active.id : null;
  const prompts = targetListingId ? LISTING_PROMPTS : PORTFOLIO_PROMPTS;

  async function submitPrompt(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const res = await sendChatMessage(token, {
        messages: nextMessages,
        listingId: targetListingId,
      });
      const assistantIndex = nextMessages.length;
      setMessages([...nextMessages, { role: "assistant", content: res.reply }]);
      if (res.toolCalls.length > 0) {
        setToolHistory((current) => ({
          ...current,
          [assistantIndex]: res.toolCalls.map((tc) => ({ name: tc.name, summary: tc.summary })),
        }));
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Chat request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!aiConfigured) {
    return (
      <section className="panel">
        <p className="kicker">Agent assistant</p>
        <h2>Ask AI</h2>
        <p className="lede">
          Configure a local model (Ollama, LM Studio) or an API key (Anthropic, OpenAI) to run interactive what-if simulations and portfolio Q&amp;A.
        </p>
        <button className="primary" type="button" onClick={onOpenAiSettings}>
          Configure AI provider
        </button>
      </section>
    );
  }

  return (
    <section className="panel">
      <p className="kicker">Backed by DuomoGrid&apos;s deterministic calculator</p>
      <h2>Ask AI</h2>
      <p className="lede">
        The assistant calls DuomoGrid&apos;s analysis and comparison tools for every number instead of guessing transfer taxes, annuity payments, or scores.
      </p>

      {active ? (
        <div className="filters" role="group" aria-label="Chat scope" style={{ marginBottom: 10 }}>
          <button
            type="button"
            className="chip"
            aria-pressed={scope === "listing"}
            onClick={() => setScope("listing")}
          >
            This listing: {active.listing.title.slice(0, 36)}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={scope === "portfolio"}
            onClick={() => setScope("portfolio")}
          >
            All saved listings
          </button>
        </div>
      ) : null}

      <div className="filters" style={{ marginBottom: 12 }}>
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="chip"
            disabled={busy}
            onClick={() => void submitPrompt(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>

      {messages.length > 0 ? (
        <div className="chat-log" aria-live="polite">
          {messages.map((msg, idx) => (
            <div key={idx} className={`chat-bubble ${msg.role}`}>
              <p className="kicker" style={{ marginBottom: 4 }}>
                {msg.role === "user" ? "You" : "DuomoGrid AI"}
              </p>
              {toolHistory[idx]?.length ? (
                <div className="chat-tools">
                  {toolHistory[idx].map((tc, tIdx) => (
                    <span key={tIdx} className="badge">
                      {tc.name}: {tc.summary}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="prose" style={{ marginTop: 0 }}>{msg.content}</p>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submitPrompt(input);
        }}
      >
        <label>
          Question
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              targetListingId
                ? `Ask about "${active?.listing.title}" (e.g. "What if I offer 420,000 € and interest is 3.9%?")`
                : "Ask across your saved listings…"
            }
          />
        </label>
        <div className="row-actions" style={{ marginTop: 8 }}>
          <button className="primary" type="submit" disabled={busy || !input.trim()}>
            {busy ? "Thinking…" : "Ask"}
          </button>
          {messages.length > 0 ? (
            <button
              className="quiet"
              type="button"
              disabled={busy}
              onClick={() => {
                setMessages([]);
                setToolHistory({});
                setError("");
              }}
            >
              Clear chat
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
