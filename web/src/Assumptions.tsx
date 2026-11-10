import { useState } from "react";
import type { Assumptions, StateOption } from "./api";

export function AssumptionsForm({
  initial,
  states,
  onSave,
}: {
  initial: Assumptions;
  states: StateOption[];
  onSave: (next: Assumptions) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  function set<K extends keyof Assumptions>(key: K, value: Assumptions[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  return (
    <form
      className="panel"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void onSave(draft).finally(() => setBusy(false));
      }}
    >
      <p className="kicker">Applies to every listing</p>
      <h2>Assumptions</h2>
      <p className="lede">Financing and fees live here, not on the listing. Change them and every score is recalculated.</p>
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
        <div className="pair">
          <Field label="Interest, percent" value={draft.interestPercent} step="0.01" onChange={(value) => value != null && set("interestPercent", value)} />
          <Field label="Term, years" value={draft.termYears} onChange={(value) => value != null && set("termYears", value)} />
          <Field label="Notary, percent" value={draft.notaryPercent} step="0.01" onChange={(value) => value != null && set("notaryPercent", value)} />
          <Field label="Land register, percent" value={draft.registerPercent} step="0.01" onChange={(value) => value != null && set("registerPercent", value)} />
          <Field label="Buyer commission if missing, percent" value={draft.fallbackCommissionPercent} step="0.01" onChange={(value) => value != null && set("fallbackCommissionPercent", value)} />
          <Field label="Monthly budget, euro" value={draft.monthlyBudgetEur} optional onChange={(value) => set("monthlyBudgetEur", value)} />
          <Field label="Your target, euro per m²" value={draft.targetEurPerM2} optional onChange={(value) => set("targetEurPerM2", value)} />
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
      </div>
      <button className="primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save assumptions"}</button>
    </form>
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
