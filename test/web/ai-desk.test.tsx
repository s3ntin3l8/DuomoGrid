/**
 * @vitest-environment jsdom
 */
import { act } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiSettingsForm } from "../../web/src/AiSettings";
import { ChatPanel } from "../../web/src/Chat";
import {
  extractListingWithAi,
  loadAiSettings,
  loadListingInquiry,
  saveAiSettings,
  sendChatMessage,
  testAiConnection,
  type AiSettingsPublic,
  type DeskListing,
} from "../../web/src/api";

describe("web AI settings, chat panel, and API helpers", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.restoreAllMocks();
  });

  it("renders AiSettingsForm, applies presets, tests connection, and saves settings", async () => {
    const initial: AiSettingsPublic = {
      provider: "openai",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:14b",
      autoExtractOnSave: false,
      hasApiKey: true,
      apiKeyPreview: "***...1234",
      configured: true,
      encryptionEnabled: false,
    };

    const onSave = vi.fn().mockResolvedValue({
      ...initial,
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-20250514",
      autoExtractOnSave: true,
    });
    const onTest = vi.fn().mockResolvedValue({
      ok: true,
      model: "claude-sonnet-4-20250514",
      latencyMs: 42,
    });

    await act(async () => {
      root.render(<AiSettingsForm initial={initial} onSave={onSave} onTest={onTest} />);
    });

    expect(host.textContent).toContain("DB_ENCRYPTION_KEY");
    expect(host.textContent).toContain("Allowed hosts:");

    // Click Anthropic preset button
    const buttons = Array.from(host.querySelectorAll("button"));
    const anthropicPreset = buttons.find((b) => b.textContent?.includes("Anthropic (Claude)"));
    await act(async () => {
      anthropicPreset?.click();
    });

    // Click Clear stored key button
    const clearBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Clear stored key"),
    );
    await act(async () => {
      clearBtn?.click();
    });

    // Click Test connection button
    const testBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Test connection"),
    );
    await act(async () => {
      testBtn?.click();
    });
    expect(onTest).toHaveBeenCalled();
    expect(host.textContent).toContain("Connected to claude-sonnet-4-20250514");

    // Toggle autoExtractOnSave checkbox and change provider select
    const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    await act(async () => {
      checkbox?.click();
    });
    const select = host.querySelector("select") as HTMLSelectElement | null;
    if (select) {
      await act(async () => {
        select.value = "openai";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }

    // Submit form
    const form = host.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        baseUrl: "http://127.0.0.1:11434/v1",
        clearApiKey: true,
        autoExtractOnSave: true,
      }),
    );
    expect(host.textContent).toContain("Saved (anthropic");
  });

  it("renders ChatPanel in unconfigured and configured states and submits prompts", async () => {
    const onOpenAi = vi.fn();
    await act(async () => {
      root.render(
        <ChatPanel token="tok" active={null} aiConfigured={false} onOpenAiSettings={onOpenAi} />,
      );
    });
    expect(host.textContent).toContain("Configure AI provider");
    const cfgBtn = host.querySelector("button");
    await act(async () => {
      cfgBtn?.click();
    });
    expect(onOpenAi).toHaveBeenCalledOnce();

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          reply: "At 400k, the monthly payment is 1,620 €.",
          model: "qwen2.5:14b",
          toolCalls: [{ name: "simulate_analysis", args: {}, summary: "Simulated at 400k" }],
        }),
    } as Response);

    const sampleActive = {
      id: "l1",
      listing: { title: "ETW Darmstadt" },
    } as unknown as DeskListing;

    await act(async () => {
      root.render(
        <ChatPanel token="tok" active={sampleActive} aiConfigured={true} onOpenAiSettings={onOpenAi} />,
      );
    });

    // Switch scope to listing, then click first suggested prompt chip
    const listingScopeBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("This listing:"),
    );
    await act(async () => {
      listingScopeBtn?.click();
    });

    const promptChip = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("What if I negotiate 10% off"),
    );
    await act(async () => {
      promptChip?.click();
    });

    expect(host.textContent).toContain("1,620 €");
    expect(host.textContent).toContain("simulate_analysis: Simulated at 400k");

    // Clear chat
    const clearChatBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Clear chat"),
    );
    await act(async () => {
      clearChatBtn?.click();
    });
    expect(host.textContent).not.toContain("1,620 €");
  });

  it("calls AI endpoints via web/src/api helpers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      } as Response),
    );

    await loadAiSettings("tok");
    await saveAiSettings("tok", { provider: "openai", model: "qwen2.5:14b" });
    await testAiConnection("tok", { provider: "openai" });
    await extractListingWithAi("tok", "id-1");
    await loadListingInquiry("tok", "id-1", true);
    await sendChatMessage("tok", { messages: [{ role: "user", content: "hi" }], listingId: "id-1" });

    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });
});
