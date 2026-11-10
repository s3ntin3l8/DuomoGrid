import type { DeskListing } from "./api";
import { eur, num } from "./format";

export function Compare({ rows }: { rows: DeskListing[] }) {
  const max = Math.max(
    ...rows.map((row) => row.analysis.pricePerLivingM2 ?? row.analysis.rentPerM2 ?? 0),
    1,
  );
  return (
    <section className="compare">
      <p className="kicker">Side by side</p>
      <h2>Compare</h2>
      <div className="bars" style={{ margin: "16px 0 20px" }}>
        {rows.map((row) => {
          const value = row.listing.offer === "buy" ? row.analysis.pricePerLivingM2 : row.analysis.rentPerM2;
          const width = value == null ? 0 : Math.max(4, (value / max) * 100);
          return (
            <div className="bar-row" key={row.id} style={{ gridTemplateColumns: "140px 1fr auto" }}>
              <span>{row.listing.city || row.listing.title}</span>
              <div className="track"><span style={{ width: `${width}%` }} /></div>
              <span>{eur(value)}</span>
            </div>
          );
        })}
      </div>
      <table>
        <thead>
          <tr>
            <th />
            {rows.map((row) => (
              <th key={row.id}>{row.listing.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Metric label="Offer" rows={rows} cell={(row) => (row.listing.offer === "buy" ? "Buy" : "Rent")} />
          <Metric label="Price" rows={rows} cell={(row) => eur(row.listing.priceEur)} />
          <Metric label="Per m²" rows={rows} cell={(row) => eur(row.listing.offer === "buy" ? row.analysis.pricePerLivingM2 : row.analysis.rentPerM2)} />
          <Metric label="Score" rows={rows} cell={(row) => (row.analysis.score == null ? "—" : String(row.analysis.score))} />
          <Metric label="Cash to close" rows={rows} cell={(row) => eur(row.analysis.cashToCloseEur)} />
          <Metric label="Monthly" rows={rows} cell={(row) => eur(row.analysis.monthlyTotal ?? row.analysis.monthlyPartial)} />
          <Metric label="Energy" rows={rows} cell={(row) => row.listing.energyClass ?? "—"} />
          <Metric label="Condo fee" rows={rows} cell={(row) => eur(row.listing.condoFeeEur)} />
          <Metric label="Yield" rows={rows} cell={(row) => (row.analysis.grossYield == null ? "—" : `${num(row.analysis.grossYield, 1)}%`)} />
        </tbody>
      </table>
    </section>
  );
}

function Metric({
  label,
  rows,
  cell,
}: {
  label: string;
  rows: DeskListing[];
  cell: (row: DeskListing) => string;
}) {
  return (
    <tr>
      <td>{label}</td>
      {rows.map((row) => (
        <td key={row.id}>{cell(row)}</td>
      ))}
    </tr>
  );
}
