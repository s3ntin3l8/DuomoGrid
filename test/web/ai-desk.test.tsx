/**
 * @vitest-environment jsdom
 */
import { act } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiSettingsForm } from "../../web/src/AiSettings";
import { ChatPanel } from "../../web/src/Chat";
import { Detail } from "../../web/src/Detail";
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

  it("loads dropdown models, preserves the saved choice, ignores stale results and allows manual entry", async () => {
    vi.useFakeTimers();
    try {
      const initial: AiSettingsPublic = { provider: "openai", baseUrl: "http://localhost:1234/v1", model: "saved-model", autoExtractOnSave: false, hasApiKey: false, apiKeyPreview: null, configured: true };
      let finishOld: (value: { models: { id: string; name: string }[] }) => void = () => {};
      const onLoadModels = vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
        .mockResolvedValue({ models: [{ id: "claude-test", name: "Claude Test" }] });
      const onSave = vi.fn().mockResolvedValue(initial);
      await act(async () => { root.render(<AiSettingsForm initial={initial} onSave={onSave} onTest={vi.fn()} onLoadModels={onLoadModels} />); });
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });
      const dropdown = host.querySelector('[aria-label="Model name"]') as HTMLSelectElement;
      expect(dropdown.value).toBe("saved-model");
      await act(async () => { Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Anthropic (Claude)")?.click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });
      expect(onLoadModels).toHaveBeenLastCalledWith({ provider: "anthropic", baseUrl: "https://api.anthropic.com" });
      expect(dropdown.textContent).toContain("Claude Test");
      await act(async () => { finishOld({ models: [{ id: "stale", name: "Stale" }] }); });
      expect(dropdown.textContent).not.toContain("Stale");
      await act(async () => { dropdown.value = "claude-test"; dropdown.dispatchEvent(new Event("change", { bubbles: true })); });
      await act(async () => { host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-test" }));
      onLoadModels.mockRejectedValue(new Error("Provider offline"));
      await act(async () => { Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Refresh models")?.click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });
      expect(host.textContent).toContain("Provider offline");
      expect(dropdown.value).toBe("claude-test");
      await act(async () => { dropdown.value = "__manual__"; dropdown.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(host.textContent).toContain("Custom model name");
    } finally { vi.useRealTimers(); }
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

  it("renders Detail with AI extraction, Makler inquiry, and clipboard copy", async () => {
    const sampleRow: DeskListing = {
      id: "l-detail-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      status: "open",
      notes: "",
      coverUrl: null,
      listing: {
        source: "immobilienscout24",
        sourceUrl: "https://www.immobilienscout24.de/expose/1",
        externalId: "1",
        title: "Altbauwohnung Darmstadt",
        offer: "buy",
        priceEur: 450000,
        livingAreaM2: 90,
        plotAreaM2: null,
        rooms: 3,
        city: "Darmstadt",
        district: "Mitte",
        postalCode: "64283",
        state: "HE",
        street: null,
        latitude: null,
        longitude: null,
        locationPrecision: null,
        propertyType: "apartment",
        yearBuilt: 1980,
        yearRefurbished: 2020,
        energyClass: "C",
        energyKwh: 95,
        energyCert: "Verbrauchsausweis",
        heating: "Gas",
        condoFeeEur: 290,
        coldRentEur: null,
        warmRentEur: null,
        depositEur: null,
        rentContract: null,
        commissionPercent: 3.57,
        commissionText: null,
        condition: "Moderne Ausstattung",
        floor: "2",
        features: ["Balkon"],
        snippet: "",
        leasehold: false,
        groundRentEur: null,
        monument: false,
        tenantOccupied: false,
        heatingSystem: "Zentralheizung",
        energySource: "Gas",
        parkingSpaces: 1,
        parkingType: "Tiefgarage",
        parkingPriceEur: null,
        bathrooms: 1,
        bedrooms: 2,
        availableFrom: "sofort",
        listedAt: null,
        portalPreviousPriceEur: null,
        portalMarketEurPerM2: null,
        portalMarketLowEurPerM2: null,
        portalMarketHighEurPerM2: null,
        description: {
          object: "2020 modernisiert. Hausgeld 290 EUR.",
          furnishing: null,
          location: null,
          other: null,
        },
        details: [{ label: "Hausgeld", value: "290 €" }],
        images: [],
      },
      analysis: {
        stateCode: "HE",
        stateName: "Hesse",
        stateFromPostal: false,
        pricePerLivingM2: 5000,
        rentPerM2: null,
        parkingPriceEur: null,
        parkingSpaces: 1,
        parkingSpacesAssumed: false,
        parkingTotalEur: null,
        transferTaxRate: 0.06,
        transferTaxEur: 27000,
        notaryEur: 9000,
        registerEur: 2250,
        commissionPercent: 3.57,
        commissionAssumed: false,
        commissionEur: 16065,
        extraEur: 54315,
        extraPercent: 12.07,
        equityEur: 90000,
        cashToCloseEur: 144315,
        loanEur: 360000,
        monthlyInterest: 1050,
        monthlyPrincipal: 600,
        monthlyDebt: 1650,
        monthlyHeating: 108,
        monthlyCondoFee: 290,
        monthlyGroundRent: 0,
        monthlyMaintenance: null,
        monthlyPropertyTax: null,
        monthlyInsurance: null,
        monthlyTotal: 2048,
        monthlyPartial: 2048,
        monthlyTotalComplete: true,
        fixedYears: 10,
        remainingDebtEur: 275000,
        refinanceMonthlyPlus1Eur: 1850,
        refinanceMonthlyPlus2Eur: 2050,
        grossYield: null,
        benchmarkEurPerM2: 4600,
        benchmarkCity: "Darmstadt",
        subscores: [],
        score: 72,
        verdict: "worth_a_look",
        flags: [],
      },
      cohort: { count: 1, medianEurPerM2: 5000, deltaPct: 0 },
      rentComparison: null,
      maxOffer: { budgetPriceEur: 430000, scorePriceEur: 460000, scoreTarget: 65 },
      bodenrichtwert: null,
      districtSaleBand: null,
      descriptionFindings: {
        items: [{ key: "renovated", label: "Renovated 2020", snippet: "2020 modernisiert", year: 2020 }],
        renovatedYear: 2020,
        heatingReplacedYear: null,
        source: "llm",
        model: "qwen2.5:14b",
        filledFields: ["condoFeeEur", "yearRefurbished"],
      },
      observations: [],
      priceHistory: {
        points: [],
        firstSeenAt: null,
        lastSeenAt: null,
        lastChangeAt: null,
        firstPriceEur: 450000,
        currentPriceEur: 450000,
        minPriceEur: 450000,
        maxPriceEur: 450000,
        totalChangeEur: 0,
        totalChangePct: 0,
        reductions: 0,
        increases: 0,
        daysOnMarket: 5,
        startedAt: "2026-01-01T00:00:00.000Z",
        startedBasis: "saved",
      },
    };

    const onExtractAi = vi.fn().mockResolvedValue(undefined);
    const onLoadInquiry = vi.fn().mockResolvedValue({
      checklist: [
        {
          key: "weg_minutes",
          category: "legal",
          priority: "high",
          title: "WEG minutes",
          whyEnglish: "Check recent resolutions.",
          questionGerman: "Könnten Sie mir die letzten drei Protokolle zusenden?",
        },
      ],
      messageGerman: "Guten Tag,\nvielen Dank für das Exposé.",
      source: "llm",
      model: "qwen2.5:14b",
    });

    await act(async () => {
      root.render(
        <Detail
          row={sampleRow}
          states={[{ id: "HE", name: "Hesse", transferTaxPercent: 6 }]}
          onBack={vi.fn()}
          onStatus={vi.fn()}
          onNotes={vi.fn()}
          onCorrect={vi.fn().mockResolvedValue(undefined)}
          onRemove={vi.fn().mockResolvedValue(undefined)}
          onClearPoint={vi.fn()}
          landPending={false}
          landMiss={false}
          aiConfigured={true}
          onExtractAi={onExtractAi}
          onLoadInquiry={onLoadInquiry}
        />,
      );
    });

    expect(host.textContent).toContain("Filled missing fields from the description: condoFeeEur, yearRefurbished");

    const extractBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Re-extract with AI"),
    );
    await act(async () => {
      extractBtn?.click();
    });
    expect(onExtractAi).toHaveBeenCalledOnce();

    const draftBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Draft questions"),
    );
    await act(async () => {
      draftBtn?.click();
    });
    expect(onLoadInquiry).toHaveBeenCalledWith(false);
    expect(host.textContent).toContain("WEG minutes");

    const tailorBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Tailor with AI"),
    );
    await act(async () => {
      tailorBtn?.click();
    });
    expect(onLoadInquiry).toHaveBeenCalledWith(true);

    const copyBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Copy German text"),
    );
    await act(async () => {
      copyBtn?.click();
    });
  });
});
