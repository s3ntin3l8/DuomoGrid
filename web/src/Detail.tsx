import type { DeskListing } from "./api";
import { area, eur, num, propertyLabel, statusLabel, STATUSES, when } from "./format";

export function Detail({
  row,
  onBack,
  onStatus,
  onNotes,
}: {
  row: DeskListing;
  onBack: () => void;
  onStatus: (status: string) => void;
  onNotes: (notes: string) => void;
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
    </article>
  );
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
