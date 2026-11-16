/**
 * @vitest-environment jsdom
 */
import { act } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssumptionsForm } from "../../web/src/Assumptions";
import { settingsKey } from "../../web/src/App";
import {
  loadAssumptions,
  refreshMarketRates,
  saveAssumptions,
  type Assumptions,
  type MarketSnapshot,
  type Suggestions,
} from "../../web/src/api";

const MARKET: MarketSnapshot = {
  rates: {
    asOf: "2026-09",
    secured10yPercent: 3.91,
    unsecured10yPercent: 4.13,
    allNewPercent: 4.09,
    floatingPercent: 4.44,
    secured10yLowPercent: 3.55,
    secured10yHighPercent: 3.91,
    secured10yRangeMonths: 12,
    history: [
      { period: "2026-09", percent: 3.91 },
      { period: "2026-08", percent: 3.83 },
    ],
    spreadPercent: 0.22,
    source: "Deutsche Bundesbank, Zinsstatistik",
    preliminary: true,
    fetchedAt: "2026-11-15T10:00:00.000Z",
  },
  energy: {
    asOf: "2026-H1",
    electricityEurPerKwh: 0.3797,
    electricityAsOf: "2026-H1",
    gasEurPerKwh: 0.1158,
    gasAsOf: "2026-H1",
    source: "Statistisches Bundesamt, Durchschnittspreise für Strom und Gas",
    fetchedAt: "2026-11-15T10:00:00.000Z",
  },
  fetchedAt: "2026-11-15T10:00:00.000Z",
  note: null,
};

const SUGGESTIONS: Suggestions = {
  interest: {
    value: 3.91,
    asOf: "2026-09",
    source: "Deutsche Bundesbank, Zinsstatistik",
    lowPercent: 3.55,
    highPercent: 3.91,
    preliminary: true,
    detail: "The average effective rate for new residential mortgages of 10 years or more, secured by a lien, was 3.91 percent in 2026-09.",
  },
  notary: {
    value: 1.5,
    asOf: "2026",
    source: "Gerichts- und Notarkostengesetz (GNotKG)",
    lowPercent: null,
    highPercent: null,
    preliminary: false,
    detail: "Notary and land register together are about 1.5 percent of the price.",
  },
  register: {
    value: 0.5,
    asOf: "2026",
    source: "Gerichts- und Notarkostengesetz (GNotKG)",
    lowPercent: null,
    highPercent: null,
    preliminary: false,
    detail: "The land register costs about 0.5 percent of the price.",
  },
  commission: {
    value: 3.57,
    asOf: "2026",
    source: "§ 656c BGB",
    lowPercent: null,
    highPercent: null,
    preliminary: false,
    detail: "Since 2020 the buyer pays at most half the commission, which is 3.57 percent including VAT.",
  },
};

const INITIAL: Assumptions = {
  equityMode: "percent",
  equityPercent: 20,
  equityEur: 100000,
  interestPercent: 3.6,
  interestProvenance: { source: "builtin", asOf: null, note: null },
  termYears: 30,
  fixedYears: 10,
  notaryPercent: 1.5,
  notaryProvenance: { source: "builtin", asOf: null, note: null },
  registerPercent: 0.5,
  registerProvenance: { source: "builtin", asOf: null, note: null },
  fallbackCommissionPercent: 3.57,
  commissionProvenance: { source: "builtin", asOf: null, note: null },
  horizonYears: 10,
  equityReturnPercent: 3,
  appreciationPercent: 1.5,
  rentGrowthPercent: 2,
  maintenanceEurPerM2Year: 10,
  propertyTaxEurYear: 450,
  insuranceEurPerM2Year: 2.5,
  monthlyBudgetEur: null,
  targetEurPerM2: null,
  defaultState: null,
};

function findButton(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
}

describe("web settings screen", () => {
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

  it("shows the market rates, the energy prices and where they come from", async () => {
    await act(async () => {
      root.render(
        <AssumptionsForm
          initial={INITIAL}
          states={[{ id: "HE", name: "Hesse", tax: 6 }]}
          market={MARKET}
          suggestions={SUGGESTIONS}
          onSave={vi.fn().mockResolvedValue(undefined)}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
        />,
      );
    });

    expect(host.textContent).toContain("3.91 %");
    expect(host.textContent).toContain("4.13 %");
    expect(host.textContent).toContain("0.22 %");
    expect(host.textContent).toContain("Deutsche Bundesbank, Zinsstatistik");
    expect(host.textContent).toContain("Power 38.0 ct/kWh");
    expect(host.textContent).toContain("gas 11.6 ct/kWh");
    expect(host.textContent).toContain("Statistisches Bundesamt");
    // The origin of every value is shown.
    expect(host.textContent).toContain("builtin");
  });

  it("accepts a market figure and saves it as the market value", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <AssumptionsForm
          initial={INITIAL}
          states={[]}
          market={MARKET}
          suggestions={SUGGESTIONS}
          onSave={onSave}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
        />,
      );
    });

    const interestField = Array.from(host.querySelectorAll(".market-field")).find((field) =>
      field.textContent?.includes("Interest rate"),
    );
    const use = Array.from(interestField?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent?.includes("Use 3.91 %"),
    );
    await act(async () => {
      use?.click();
    });
    expect(host.textContent).toContain("Will be used on save.");

    const form = host.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSave).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accept: ["interest"] }),
    );
  });

  it("takes a value back into the owner's hands", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <AssumptionsForm
          initial={INITIAL}
          states={[]}
          market={MARKET}
          suggestions={SUGGESTIONS}
          onSave={onSave}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
        />,
      );
    });

    // The "Keep mine" button of the interest field, not the one of the fees above it.
    const interestField = Array.from(host.querySelectorAll(".market-field")).find((field) =>
      field.textContent?.includes("Interest rate"),
    );
    const keep = Array.from(interestField?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent?.includes("Keep mine"),
    );
    await act(async () => {
      keep?.click();
    });
    expect(host.textContent).toContain("Will be marked as yours on save.");

    const form = host.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onSave).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pin: ["interest"] }),
    );
  });

  it("makes a typed value the owner's own", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <AssumptionsForm
          initial={INITIAL}
          states={[]}
          market={MARKET}
          suggestions={SUGGESTIONS}
          onSave={onSave}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
        />,
      );
    });

    const input = host.querySelector('input[value="3.6"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "2.9");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = host.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const saved = onSave.mock.calls[0]?.[0] as Assumptions;
    expect(saved.interestPercent).toBe(2.9);
    expect(saved.interestProvenance.source).toBe("user");
  });

  it("reads the market again and drops a pending choice", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      root.render(
        <AssumptionsForm
          initial={INITIAL}
          states={[]}
          market={MARKET}
          suggestions={SUGGESTIONS}
          onSave={vi.fn().mockResolvedValue(undefined)}
          onRefresh={onRefresh}
        />,
      );
    });

    await act(async () => {
      const interestField = Array.from(host.querySelectorAll(".market-field")).find((field) =>
        field.textContent?.includes("Interest rate"),
      );
      const use = Array.from(interestField?.querySelectorAll("button") ?? []).find((b) =>
        b.textContent?.includes("Use 3.91 %"),
      );
      use?.click();
    });
    expect(host.textContent).toContain("Will be used on save.");

    await act(async () => {
      findButton(host, "Read the market again")?.click();
    });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(host.textContent).not.toContain("Will be used on save.");
    expect(host.textContent).toContain("The market data was read again.");
  });

  it("keeps the form mounted when a refresh moves no value", async () => {
    // The desk mounts the form under a key built from the values. A refresh that moves nothing
    // must leave the key alone, or the owner loses the draft and the notice.
    const before = settingsKey(INITIAL);
    const after = settingsKey({ ...INITIAL, interestProvenance: { source: "market", asOf: "2026-09", note: "Bundesbank" } });
    expect(after).toBe(before);
    // A refresh that does move a value changes the key, so the form remounts with the new figure.
    expect(settingsKey({ ...INITIAL, interestPercent: 3.91 })).not.toBe(before);
  });

  it("derives the form key, so a new assumption is never left out of it", () => {
    // The key lists the values, not the provenance. A field that is added later is picked up
    // without the list having to be written out again.
    const withNewField = { ...INITIAL, aBrandNewAssumption: 42 } as unknown as Assumptions;
    expect(settingsKey(withNewField)).not.toBe(settingsKey(INITIAL));
    // A provenance field on its own changes nothing.
    const withProvenance = {
      ...INITIAL,
      aBrandNewProvenance: { source: "user", asOf: null, note: null },
    } as unknown as Assumptions;
    expect(settingsKey(withProvenance)).toBe(settingsKey(INITIAL));
  });

  it("says so when the market cannot be read", async () => {
    await act(async () => {
      root.render(
        <AssumptionsForm
          initial={INITIAL}
          states={[]}
          market={{ rates: null, energy: null, fetchedAt: "x", note: "The market data could not be read." }}
          suggestions={{ interest: null, notary: SUGGESTIONS.notary, register: SUGGESTIONS.register, commission: SUGGESTIONS.commission }}
          onSave={vi.fn().mockResolvedValue(undefined)}
          onRefresh={vi.fn().mockResolvedValue(undefined)}
        />,
      );
    });
    expect(host.textContent).toContain("The market data could not be read.");
    // The fees that follow the law are still offered.
    expect(host.textContent).toContain("Gerichts- und Notarkostengesetz");
  });

  it("saves the settings through the api helpers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ assumptions: INITIAL, states: [], market: MARKET, suggestions: SUGGESTIONS }),
      } as Response),
    );

    await loadAssumptions("tok");
    await saveAssumptions("tok", INITIAL, { accept: ["interest"] });
    await refreshMarketRates("tok");

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const urls = fetchSpy.mock.calls.map((call) => String(call[0]));
    const bodies = fetchSpy.mock.calls.map((call) => String(call[1]?.body ?? ""));
    expect(urls.some((url) => url.includes("/assumptions/refresh"))).toBe(true);
    expect(bodies.some((body) => body.includes('"accept":["interest"]'))).toBe(true);
  });
});
