import { useState } from "react";
import type { Assumptions, MarketSnapshot, Provenance, StateOption, Suggestion, Suggestions } from "./api";

/** The fields that can follow the market. */
type MarketField = "interest" | "notary" | "register" | "commission";

const FIELD_LABELS: Record<MarketField, string> = {
  interest: "Interest rate",
  notary: "Notary",
  register: "Land register",
  commission: "Buyer commission if missing",
};

export function AssumptionsForm({
  initial,
  states,
  market,
  suggestions,
  onSave,
  onRefresh,
}: {
  initial: Assumptions;
  states: StateOption[];
  market: MarketSnapshot;
  suggestions: Suggestions;
  onSave: (next: Assumptions, options?: { accept?: MarketField[]; pin?: MarketField[] }) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [accepted, setAccepted] = useState<MarketField[]>([]);
  const [pinned, setPinned] = useState<MarketField[]>([]);
  const [notice, setNotice] = useState("");

  function set<K extends keyof Assumptions>(key: K, value: Assumptions[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  /**
   * Set a market-ish value.
   *
   * Typing a number makes it the owner's own. Without this a value that had been accepted from
   * the market would keep its `market` origin, and the next refresh would silently overwrite what
   * the owner just typed.
   */
  function setValueOf(field: MarketField, value: number) {
    const own: Provenance = { source: "user", asOf: null, note: null };
    if (field === "interest") {
      set("interestPercent", value);
      set("interestProvenance", own);
    } else if (field === "notary") {
      set("notaryPercent", value);
      set("notaryProvenance", own);
    } else if (field === "register") {
      set("registerPercent", value);
      set("registerProvenance", own);
    } else {
      set("fallbackCommissionPercent", value);
      set("commissionProvenance", own);
    }
  }

  async function save() {
    setBusy(true);
    setNotice("");
    try {
      await onSave(draft, {
        accept: accepted.length ? accepted : undefined,
        pin: pinned.length ? pinned : undefined,
      });
      setAccepted([]);
      setPinned([]);
      setNotice("Saved. Every score was recalculated.");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    setNotice("");
    try {
      await onRefresh();
      // A pending "use this figure" was chosen against the old numbers, so it does not carry over.
      setAccepted([]);
      setPinned([]);
      setNotice("The market data was read again.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <form
      className="panel"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="kicker">Applies to every listing</p>
      <h2>Settings</h2>
      <p className="lede">
        Financing and fees live here, not on the listing. Market figures are suggestions until you accept them, so a score only
        changes when you say so.
      </p>

      <section className="block">
        <h3>Market</h3>
        <RatesPanel market={market} />
        <div className="row-actions" style={{ marginTop: 10 }}>
          <button
            className="quiet"
            type="button"
            disabled={refreshing}
            onClick={() => {
              void refresh();
            }}
          >
            {refreshing ? "Reading…" : "Read the market again"}
          </button>
        </div>
      </section>

      <section className="block">
        <h3>Your money</h3>
        <div className="fields">
          <div className="choice">
            <label><input type="radio" name="equityMode" checked={draft.equityMode === "percent"} onChange={() => set("equityMode", "percent")} /> Percent of price</label>
            <label><input type="radio" name="equityMode" checked={draft.equityMode === "eur"} onChange={() => set("equityMode", "eur")} /> Fixed amount</label>
          </div>
          {draft.equityMode === "percent" ? (
            <Field label="Equity, percent" value={draft.equityPercent} onChange={(value) => value != null && set("equityPercent", value)} />
          ) : (
            <Field label="Equity, euro" value={draft.equityEur} onChange={(value) => value != null && set("equityEur", value)} />
          )}
          <Field label="Fixed-rate period, years" value={draft.fixedYears} onChange={(value) => value != null && set("fixedYears", value)} />
          <div className="pair">
            <Field label="Term, years" value={draft.termYears} onChange={(value) => value != null && set("termYears", value)} />
            <Field label="Monthly budget, euro" value={draft.monthlyBudgetEur} optional onChange={(value) => set("monthlyBudgetEur", value)} />
            <Field label="Your target, euro per m²" value={draft.targetEurPerM2} optional onChange={(value) => set("targetEurPerM2", value)} />
          </div>
        </div>
      </section>

      <section className="block">
        <h3>Buying costs</h3>
        <p className="meta">The fees a purchase brings with it. They follow the law, not the market, so there is nothing to refresh.</p>
        <div className="fields">
          <MarketFieldRow
            field="notary"
            label={FIELD_LABELS.notary}
            value={draft.notaryPercent}
            provenance={draft.notaryProvenance}
            suggestion={suggestions.notary}
            onChange={(value) => setValueOf("notary", value)}
            onAccept={() => setAccepted((current) => (current.includes("notary") ? current : [...current, "notary"]))}
            onPin={() => setPinned((current) => (current.includes("notary") ? current : [...current, "notary"]))}
            accepted={accepted.includes("notary")}
            pinned={pinned.includes("notary")}
          />
          <MarketFieldRow
            field="register"
            label={FIELD_LABELS.register}
            value={draft.registerPercent}
            provenance={draft.registerProvenance}
            suggestion={suggestions.register}
            onChange={(value) => setValueOf("register", value)}
            onAccept={() => setAccepted((current) => (current.includes("register") ? current : [...current, "register"]))}
            onPin={() => setPinned((current) => (current.includes("register") ? current : [...current, "register"]))}
            accepted={accepted.includes("register")}
            pinned={pinned.includes("register")}
          />
          <MarketFieldRow
            field="commission"
            label={FIELD_LABELS.commission}
            value={draft.fallbackCommissionPercent}
            provenance={draft.commissionProvenance}
            suggestion={suggestions.commission}
            onChange={(value) => setValueOf("commission", value)}
            onAccept={() => setAccepted((current) => (current.includes("commission") ? current : [...current, "commission"]))}
            onPin={() => setPinned((current) => (current.includes("commission") ? current : [...current, "commission"]))}
            accepted={accepted.includes("commission")}
            pinned={pinned.includes("commission")}
          />
        </div>
      </section>

      <section className="block">
        <h3>Financing</h3>
        <div className="fields">
          <MarketFieldRow
            field="interest"
            label={FIELD_LABELS.interest}
            value={draft.interestPercent}
            provenance={draft.interestProvenance}
            suggestion={suggestions.interest}
            onChange={(value) => setValueOf("interest", value)}
            onAccept={() => setAccepted((current) => (current.includes("interest") ? current : [...current, "interest"]))}
            onPin={() => setPinned((current) => (current.includes("interest") ? current : [...current, "interest"]))}
            accepted={accepted.includes("interest")}
            pinned={pinned.includes("interest")}
          />
        </div>
      </section>

      <section className="block">
        <h3>Owning and renting</h3>
        <div className="fields">
          <div className="pair">
            <Field label="House upkeep, euro per m² and year" value={draft.maintenanceEurPerM2Year} step="0.5" onChange={(value) => value != null && set("maintenanceEurPerM2Year", value)} />
            <Field label="House property tax, euro per year" value={draft.propertyTaxEurYear} step="10" onChange={(value) => value != null && set("propertyTaxEurYear", value)} />
            <Field label="House insurance, euro per m² and year" value={draft.insuranceEurPerM2Year} step="0.1" onChange={(value) => value != null && set("insuranceEurPerM2Year", value)} />
            <Field label="Rent or buy: years you would stay" value={draft.horizonYears} onChange={(value) => value != null && set("horizonYears", value)} />
            <Field label="Return on money kept out of the home, percent a year" value={draft.equityReturnPercent} step="0.1" onChange={(value) => value != null && set("equityReturnPercent", value)} />
            <Field label="Home price change, percent a year" value={draft.appreciationPercent} step="0.1" onChange={(value) => value != null && set("appreciationPercent", value)} />
            <Field label="Rent increase, percent a year" value={draft.rentGrowthPercent} step="0.1" onChange={(value) => value != null && set("rentGrowthPercent", value)} />
          </div>
        </div>
      </section>

      <section className="block">
        <h3>Your context</h3>
        <div className="fields">
          <label>
            Default state
            <select value={draft.defaultState ?? ""} onChange={(event) => set("defaultState", event.target.value || null)}>
              <option value="">None</option>
              {states.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name} · {state.tax}%
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {notice ? <p className="note">{notice}</p> : null}

      <div className="row-actions" style={{ marginTop: 16 }}>
        <button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
      </div>
    </form>
  );
}

/** The rates panel: what the market is doing, and where the numbers come from. */
function RatesPanel({ market }: { market: MarketSnapshot }) {
  const rates = market.rates;
  if (!rates) {
    return <p className="meta">{market.note ?? "The market data is not available right now."}</p>;
  }
  return (
    <div className="fields">
      <div className="pair">
        <Readout label="Secured, 10 years or more" value={rates.secured10yPercent != null ? `${rates.secured10yPercent.toFixed(2)} %` : "—"} />
        <Readout label="Unsecured, 10 years or more" value={rates.unsecured10yPercent != null ? `${rates.unsecured10yPercent.toFixed(2)} %` : "—"} />
        <Readout label="All new business" value={rates.allNewPercent != null ? `${rates.allNewPercent.toFixed(2)} %` : "—"} />
        <Readout label="Existing, up to one year" value={rates.floatingPercent != null ? `${rates.floatingPercent.toFixed(2)} %` : "—"} />
        <Readout label="Risk spread" value={rates.spreadPercent != null ? `${rates.spreadPercent.toFixed(2)} %` : "—"} />
        <Readout
          label="Energy prices"
          value={
            market.energy
              ? [
                  market.energy.electricityEurPerKwh != null
                    ? `Power ${(market.energy.electricityEurPerKwh * 100).toFixed(1)} ct/kWh`
                    : null,
                  market.energy.gasEurPerKwh != null ? `gas ${(market.energy.gasEurPerKwh * 100).toFixed(1)} ct/kWh` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "none published"
              : "not configured"
          }
        />
      </div>
      {market.energy ? (
        <p className="meta">
          Household prices from {market.energy.source}
          {market.energy.electricityAsOf ? `, electricity ${market.energy.electricityAsOf}` : ""}
          {market.energy.gasAsOf ? `, gas ${market.energy.gasAsOf}` : ""}. They are shown for reference and do not
          change the heating cost yet.
        </p>
      ) : null}
      {rates.history.length > 1 ? (
        <p className="meta">
          Recent: {rates.history.map((point) => `${point.period} ${point.percent.toFixed(2)} %`).join(" · ")}
        </p>
      ) : null}
      <p className="meta">
        {rates.source}
        {rates.asOf ? `, ${rates.asOf}` : ""}
        {rates.preliminary ? " (provisional, will be revised)" : ""}. {market.note ?? ""}
      </p>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="readout">
      <span className="meta">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * A field that can follow the market. The value, where it came from, and the figure on offer.
 */
function MarketFieldRow({
  field,
  label,
  value,
  provenance,
  suggestion,
  onChange,
  onAccept,
  onPin,
  accepted,
  pinned,
}: {
  field: MarketField;
  label: string;
  value: number;
  provenance: Assumptions["interestProvenance"];
  suggestion: Suggestion | null;
  onChange: (value: number) => void;
  onAccept: () => void;
  onPin: () => void;
  accepted: boolean;
  pinned: boolean;
}) {
  const source = provenance.source;
  const differs = suggestion != null && Math.abs(suggestion.value - value) > 0.005;
  return (
    <div className="market-field">
      <div className="market-field-head">
        <label>
          {label}
          <input
            inputMode="decimal"
            step="0.01"
            value={value}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              if (Number.isFinite(parsed)) onChange(parsed);
            }}
          />
        </label>
        <span className={`badge ${source}`}>{source}</span>
      </div>
      {provenance.asOf ? <p className="meta">From {provenance.note ?? "the market"}, {provenance.asOf}.</p> : null}
      {suggestion ? (
        <div className="market-field-market">
          <p className="meta">{suggestion.detail}</p>
          <div className="row-actions">
            {differs ? (
              <button type="button" className="quiet" onClick={onAccept}>
                Use {suggestion.value.toFixed(2)} %
              </button>
            ) : null}
            {provenance.source !== "user" ? (
              <button type="button" className="quiet" onClick={onPin}>
                Keep mine
              </button>
            ) : null}
          </div>
          {accepted ? <p className="note">Will be used on save.</p> : null}
          {pinned ? <p className="note">Will be marked as yours on save.</p> : null}
        </div>
      ) : null}
      {provenance.source === "market" && !differs ? <p className="note">Following the market.</p> : null}
      {field === "interest" ? null : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  step = "0.1",
  optional = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  step?: string;
  optional?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        inputMode="decimal"
        step={step}
        value={value ?? ""}
        onChange={(event) => {
          if (event.target.value === "") {
            onChange(optional ? null : value);
            return;
          }
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
      />
    </label>
  );
}
