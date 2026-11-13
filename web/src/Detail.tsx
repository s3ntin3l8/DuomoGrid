import { useState } from "react";
import type { DeskListing, ListingPatch, StateOption } from "./api";
import { area, eur, num, propertyLabel, statusLabel, STATUSES, when } from "./format";

export function Detail({
  row,
  states,
  onBack,
  onStatus,
  onNotes,
  onCorrect,
  onRemove,
  onClearPoint,
  landPending,
  landMiss,
}: {
  row: DeskListing;
  states: StateOption[];
  onBack: () => void;
  onStatus: (status: string) => void;
  onNotes: (notes: string) => void;
  onCorrect: (body: ListingPatch) => Promise<void>;
  onRemove: () => Promise<void>;
  onClearPoint: () => void;
  landPending: boolean;
  landMiss: boolean;
}) {
  const { listing, analysis } = row;
  const buy = listing.offer === "buy";
  const place = [listing.district, listing.city, listing.postalCode].filter(Boolean).join(", ");
  return (
    <article className="detail">
      <div className="toolbar">
        <button className="quiet back" type="button" onClick={onBack}>
          Back
        </button>
        <div className="hero-actions">
          <select aria-label="Status" value={row.status} onChange={(event) => onStatus(event.target.value)}>
            {STATUSES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          {listing.sourceUrl ? (
            <a href={listing.sourceUrl} target="_blank" rel="noreferrer">
              Open listing
            </a>
          ) : null}
        </div>
      </div>
      <p className="kicker">
        {buy ? "Buy" : "Rent"} · {propertyLabel(listing.propertyType)} · {statusLabel(row.status)}
      </p>
      <h2>{listing.title}</h2>
      <p className="meta">{place || "Place not detected"}</p>
      {listing.street || (listing.latitude != null && listing.longitude != null) ? (
        <p className="meta">
          {[
            listing.street,
            listing.latitude != null && listing.longitude != null
              ? `${listing.latitude.toFixed(5)}, ${listing.longitude.toFixed(5)}`
              : null,
          ].filter(Boolean).join(" · ")}
          {listing.latitude != null && listing.longitude != null ? (
            <button className="text-button" type="button" onClick={onClearPoint}>
              Clear point
            </button>
          ) : null}
        </p>
      ) : null}
      <div className="hero">
        <div>
          <p className="price">{eur(listing.priceEur)}</p>
          <p className="meta">
            {buy ? `${eur(analysis.pricePerLivingM2)} / m²` : `${eur(analysis.rentPerM2, 2)} / m²`}
            {listing.livingAreaM2 ? ` · ${area(listing.livingAreaM2)}` : ""}
            {listing.rooms ? ` · ${num(listing.rooms, 1)} rooms` : ""}
          </p>
        </div>
        {analysis.score != null ? (
          <div>
            <div className="score" style={{ ["--p" as string]: String(analysis.score) }}>
              <b>{analysis.score}</b>
            </div>
            <p className="verdict">{analysis.verdict}</p>
          </div>
        ) : (
          <p className="verdict">Rent is not scored against purchases.</p>
        )}
      </div>
      {analysis.flags.length > 0 ? (
        <ul className="flags">
          {analysis.flags.map((flag) => (
            <li key={flag.title} className={flag.severity}>
              <strong>{flag.title}</strong>
              <span>{flag.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <LandValue row={row} pending={landPending} miss={landMiss} />
      <DistrictBand row={row} />
      <div className="cols">
        {buy ? (
          <section className="block">
            <h3>Cash to close {analysis.stateName ? `· ${analysis.stateName}` : ""}</h3>
            <dl>
              <Line label="Price" value={eur(listing.priceEur)} />
              <Line label={`Transfer tax${analysis.transferTaxPercent != null ? ` ${num(analysis.transferTaxPercent, 1)}%` : ""}`} value={eur(analysis.transferTaxEur)} />
              <Line label="Notary" value={eur(analysis.notaryEur)} />
              <Line label="Land register" value={eur(analysis.registerEur)} />
              <Line
                label={`Commission${analysis.commissionAssumed ? " (assumed)" : ""}${analysis.commissionPercent != null ? ` ${num(analysis.commissionPercent, 2)}%` : ""}`}
                value={eur(analysis.commissionEur)}
              />
              <Line label="Extra costs" value={eur(analysis.extraEur)} />
              <Line label="Cash to close" value={eur(analysis.cashToCloseEur)} total />
              <Line label="Equity" value={eur(analysis.equityEur)} />
              <Line label="Loan" value={eur(analysis.loanEur)} />
            </dl>
          </section>
        ) : (
          <section className="block">
            <h3>Rent</h3>
            <dl>
              <Line label="Cold rent" value={eur(listing.coldRentEur ?? listing.priceEur)} />
              <Line label="Warm rent" value={eur(listing.warmRentEur)} />
              <Line label="Deposit" value={eur(listing.depositEur)} />
              <Line label="Contract" value={listing.rentContract ?? "—"} />
            </dl>
          </section>
        )}
        <section className="block">
          <h3>Each month</h3>
          <dl>
            {buy ? <Line label="Loan" value={eur(analysis.monthlyDebt)} /> : null}
            <Line label="Heating estimate" value={eur(analysis.monthlyHeating)} />
            <Line label="Condo fee" value={eur(analysis.monthlyCondoFee)} />
            {listing.leasehold ? <Line label="Ground rent" value={eur(analysis.monthlyGroundRent)} /> : null}
            <Line label={analysis.monthlyTotal != null ? "Total" : "Known so far"} value={eur(analysis.monthlyTotal ?? analysis.monthlyPartial)} total />
          </dl>
          {analysis.grossYield != null ? <p className="note">Gross yield {num(analysis.grossYield, 1)}% on the cold rent you entered.</p> : null}
          <Cohort row={row} />
        </section>
      </div>
      <section className="block">
        <h3>Energy</h3>
        <p>
          {listing.energyClass ? `Class ${listing.energyClass}` : "No class"}
          {listing.energyKwh != null ? ` · ${num(listing.energyKwh)} kWh/m²·a` : ""}
          {listing.energyCert ? ` · ${listing.energyCert} certificate` : ""}
          {listing.heating ? ` · ${listing.heating}` : ""}
          {listing.yearBuilt ? ` · built ${listing.yearBuilt}` : ""}
        </p>
        {analysis.subscores.some((part) => part.applicable) ? (
          <div className="bars">
            {analysis.subscores.filter((part) => part.applicable).map((part) => (
              <div className="bar-row" key={part.key}>
                <span>{part.label}</span>
                <div className="track"><span style={{ width: `${part.score}%` }} /></div>
                <span>{part.score}</span>
              </div>
            ))}
          </div>
        ) : null}
      </section>
      {row.observations.length > 1 ? (
        <section className="block">
          <h3>Price history</h3>
          <dl>
            {row.observations.map((point) => (
              <Line key={point.seenAt} label={when(point.seenAt)} value={eur(point.priceEur)} />
            ))}
          </dl>
        </section>
      ) : null}
      <section className="block">
        <h3>Notes</h3>
        <Notes initial={row.notes} onSave={onNotes} />
      </section>
      <section className="block">
        <h3>Correct</h3>
        <p className="meta">A later save from the exposé replaces these. Warm rent and the condo fee stay as saved.</p>
        <CorrectForm row={row} states={states} onCorrect={onCorrect} />
      </section>
      <section className="block">
        <h3>Remove</h3>
        <p className="meta">Pass keeps the listing. Remove deletes it and its price history.</p>
        <RemoveListing key={row.id} onRemove={onRemove} />
      </section>
    </article>
  );
}

function DistrictBand({ row }: { row: DeskListing }) {
  const band = row.districtSaleBand;
  if (!band) return null;
  const kind = band.kind === "house" ? "detached and semi-detached houses" : "used apartments";
  return (
    <section className="block">
      <h3>District sale band</h3>
      <p>
        {band.name} · {band.band} EUR/m² · {band.year}
      </p>
      <p className="meta">
        Published sale band for {kind} in this district. Not the value of this building, and not the asking-price guide.
      </p>
      <p className="meta">AK OGA, Immobilienmarktbericht Deutschland 2025.</p>
    </section>
  );
}

function landDigits(value: number | null): number {
  if (value == null) return 0;
  const cents = Math.round(value * 100);
  if (cents % 100 === 0) return 0;
  if (cents % 10 === 0) return 1;
  return 2;
}

function LandValue({ row, pending, miss }: { row: DeskListing; pending: boolean; miss: boolean }) {
  const land = row.bodenrichtwert;
  if (land?.status === "published" || land?.status === "unpublished") {
    return (
      <section className="block">
        <h3>Land value</h3>
        <p className="meta">
          Bodenrichtwert for this plot, in EUR per m² of land. Not the asking price per living m², and not a Kaufwert.
        </p>
        <p>
          Zone {land.zone}
          {land.status === "published" ? ` · ${eur(land.eurPerM2, landDigits(land.eurPerM2))} / m² of land` : " · value not published"}
          {land.stichtag ? ` · as of ${land.stichtag}` : ""}
        </p>
        <p className="meta">
          {land.status === "unpublished"
            ? "The committee does not publish a figure for this zone. Nothing here is stored as zero. "
            : "Published Bavarian standard land value for private viewing. "}
          Not the official paid Auskunft.
        </p>
      </section>
    );
  }
  if (pending) return <p className="meta">Looking up the Bavarian land value…</p>;
  if (miss) return <p className="meta">The land value could not be loaded. The listing itself is unchanged.</p>;
  return null;
}

function Line({ label, value, total = false }: { label: string; value: string; total?: boolean }) {
  return (
    <div className={total ? "line total" : "line"}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Cohort({ row }: { row: DeskListing }) {
  const { cohort, rentComparison, listing } = row;
  if (cohort.count < 2) {
    return <p className="note">No similar saved listing in {listing.city || "this place"} yet.</p>;
  }
  const delta = cohort.deltaPct == null ? "" : cohort.deltaPct > 0 ? `${num(cohort.deltaPct, 0)}% above` : `${num(Math.abs(cohort.deltaPct), 0)}% below`;
  return (
    <>
      <p className="note">
        {cohort.count} similar saved {listing.offer === "buy" ? "purchases" : "rentals"}. Median {eur(cohort.medianEurPerM2)} / m²
        {delta ? `, this one is ${delta}` : ""}.
      </p>
      {rentComparison && rentComparison.rentCount > 0 && rentComparison.medianColdRentEur != null ? (
        <p className="note">
          Saved rentals nearby ask about {eur(rentComparison.medianColdRentEur)} cold.
          {rentComparison.carryingMinusMedianCold != null
            ? ` Owning costs ${eur(Math.abs(rentComparison.carryingMinusMedianCold))} ${rentComparison.carryingMinusMedianCold > 0 ? "more" : "less"} per month.`
            : ""}
        </p>
      ) : null}
    </>
  );
}

function Notes({ initial, onSave }: { initial: string; onSave: (notes: string) => void }) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSave(String(data.get("notes") ?? ""));
      }}
    >
      <textarea key={initial} name="notes" defaultValue={initial} aria-label="Notes" />
      <div className="row-actions" style={{ marginTop: 8 }}>
        <button className="primary" type="submit">Save notes</button>
      </div>
    </form>
  );
}

const PROPERTY_OPTIONS = [
  ["apartment", "Apartment"],
  ["house", "House"],
  ["land", "Plot"],
  ["multi", "Multi-family"],
  ["other", "Other"],
] as const;

const ENERGY_OPTIONS = ["A+", "A", "B", "C", "D", "E", "F", "G", "H"];

function readNumber(value: FormDataEntryValue | null, label: string): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number, or empty.`);
  return parsed;
}

function CorrectForm({
  row,
  states,
  onCorrect,
}: {
  row: DeskListing;
  states: StateOption[];
  onCorrect: (body: ListingPatch) => Promise<void>;
}) {
  const listing = row.listing;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      key={`${row.id}:${row.updatedAt}`}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        let body: ListingPatch;
        try {
          body = {
            city: String(data.get("city") ?? ""),
            district: String(data.get("district") ?? ""),
            state: String(data.get("state") ?? "") || null,
            propertyType: String(data.get("propertyType") ?? ""),
            livingAreaM2: readNumber(data.get("livingAreaM2"), "Living area"),
            plotAreaM2: readNumber(data.get("plotAreaM2"), "Plot area"),
            rooms: readNumber(data.get("rooms"), "Rooms"),
            yearBuilt: readNumber(data.get("yearBuilt"), "Year built"),
            energyClass: String(data.get("energyClass") ?? "") || null,
            priceEur: readNumber(data.get("priceEur"), "Price"),
          };
        } catch (reason: unknown) {
          setError(reason instanceof Error ? reason.message : "Could not save.");
          return;
        }
        setBusy(true);
        setError("");
        void onCorrect(body)
          .catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : "Could not save.");
          })
          .finally(() => setBusy(false));
      }}
    >
      <div className="facts">
        <label>
          City
          <input name="city" defaultValue={listing.city} />
        </label>
        <label>
          District
          <input name="district" defaultValue={listing.district ?? ""} />
        </label>
        <label>
          State
          <select name="state" defaultValue={listing.state ?? ""}>
            <option value="">Unknown</option>
            {states.map((state) => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select name="propertyType" defaultValue={listing.propertyType}>
            {PROPERTY_OPTIONS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Living area, m²
          <input name="livingAreaM2" type="number" step="any" defaultValue={listing.livingAreaM2 ?? ""} />
        </label>
        <label>
          Plot area, m²
          <input name="plotAreaM2" type="number" step="any" defaultValue={listing.plotAreaM2 ?? ""} />
        </label>
        <label>
          Rooms
          <input name="rooms" type="number" step="any" defaultValue={listing.rooms ?? ""} />
        </label>
        <label>
          Year built
          <input name="yearBuilt" type="number" step="1" defaultValue={listing.yearBuilt ?? ""} />
        </label>
        <label>
          Energy class
          <select name="energyClass" defaultValue={listing.energyClass ?? ""}>
            <option value="">None</option>
            {ENERGY_OPTIONS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Price, euro
          <input name="priceEur" type="number" step="any" defaultValue={listing.priceEur ?? ""} />
        </label>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <div className="row-actions">
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save correction"}
        </button>
      </div>
    </form>
  );
}

function RemoveListing({ onRemove }: { onRemove: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirming) {
    return (
      <button className="quiet" type="button" onClick={() => setConfirming(true)}>
        Remove
      </button>
    );
  }
  return (
    <div className="row-actions">
      <button className="quiet" type="button" disabled={busy} onClick={() => setConfirming(false)}>
        Keep
      </button>
      <button
        className="primary"
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onRemove().catch(() => setBusy(false));
        }}
      >
        Remove listing
      </button>
    </div>
  );
}
