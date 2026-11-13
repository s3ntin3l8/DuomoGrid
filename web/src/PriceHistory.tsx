import type { DeskListing } from "./api";
import { eur, moveLabel, when } from "./format";

type History = DeskListing["priceHistory"];
type Point = History["points"][number];

const WIDTH = 560;
const HEIGHT = 120;
const PAD = 10;
const PORTAL_GUTTER = 44;

/** A step line: a price holds until the next one is seen. Dated points sit on a time axis, the portal's undated one at the left. */
function StepChart({ history, label }: { history: History; label: string }) {
  const points = history.points;
  const prices = points.map((point) => point.priceEur);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const span = high - low || 1;
  // With one price throughout the line sits in the middle, not on the bottom edge.
  const y = (value: number) => (high === low ? HEIGHT / 2 : PAD + (1 - (value - low) / span) * (HEIGHT - 2 * PAD));
  const dated = points.filter((point): point is Point & { at: string } => point.at != null);
  const hasPortal = points.some((point) => point.at == null);
  const left = hasPortal ? PORTAL_GUTTER : PAD;
  const start = dated.length ? Date.parse(dated[0].at) : 0;
  const end = Math.max(Date.now(), dated.length ? Date.parse(dated[dated.length - 1].at) : 0);
  const range = end - start || 1;
  const x = (point: Point) => (point.at == null ? PAD : left + ((Date.parse(point.at) - start) / range) * (WIDTH - left - PAD));
  let path = "";
  points.forEach((point, index) => {
    path += index === 0 ? `M${x(point)},${y(point.priceEur)}` : `H${x(point)}V${y(point.priceEur)}`;
  });
  path += `H${WIDTH - PAD}`;
  return (
    <svg className="chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} preserveAspectRatio="none">
      <path d={path} />
      {/* A zero-length round-capped stroke stays a circle however the chart is stretched. */}
      {points.map((point, index) => (
        <g key={`${point.at ?? "portal"}-${index}`}>
          <path className="dot" d={`M${x(point)},${y(point.priceEur)}h0`} />
          {point.at == null ? <path className="dot hollow" d={`M${x(point)},${y(point.priceEur)}h0`} /> : null}
        </g>
      ))}
    </svg>
  );
}

export function PriceHistoryBlock({ row }: { row: DeskListing }) {
  const history = row.priceHistory;
  const rent = row.listing.offer === "rent";
  if (history.points.length === 0) return null;
  const noun = rent ? "Cold rent" : "Asking price";
  const cut = history.reductions;
  const summary: string[] = [];
  summary.push(
    history.startedBasis === "portal"
      ? `On the portal for ${history.daysOnMarket} ${history.daysOnMarket === 1 ? "day" : "days"}, since ${when(history.startedAt)}.`
      : `In your list for ${history.daysOnMarket} ${history.daysOnMarket === 1 ? "day" : "days"}. The portal gave no listing date.`,
  );
  if (history.points.length < 2) summary.push(`${noun} unchanged since it was first seen.`);
  else if (history.totalChangeEur != null && history.firstKnownPriceEur != null) {
    const change = moveLabel(history.totalChangePct);
    const direction = history.totalChangeEur < 0 ? "down" : history.totalChangeEur > 0 ? "up" : "the same";
    summary.push(
      `${noun} is ${direction === "the same" ? "the same as" : `${direction} ${eur(Math.abs(history.totalChangeEur))}${change ? ` (${change})` : ""} from`} the first known ${eur(history.firstKnownPriceEur)}.`,
    );
  }
  if (cut > 0) summary.push(`Cut ${cut} ${cut === 1 ? "time" : "times"}.`);
  if (history.increases > 0) summary.push(`Raised ${history.increases} ${history.increases === 1 ? "time" : "times"}.`);
  const chartLabel = `${noun} over time: ${history.points.map((point) => eur(point.priceEur)).join(", then ")}.`;
  return (
    <section className="block">
      <h3>Price history</h3>
      <p>{summary.join(" ")}</p>
      {history.points.length >= 2 ? <StepChart history={history} label={chartLabel} /> : null}
      <dl>
        {history.points.map((point, index) => {
          const previous = index > 0 ? history.points[index - 1].priceEur : null;
          const step = previous != null ? point.priceEur - previous : 0;
          const delta = previous != null && step !== 0 ? ` (${step < 0 ? "−" : "+"}${eur(Math.abs(step))})` : "";
          return (
            <div className="line" key={`${point.at ?? "portal"}-${index}`}>
              <dt>{point.at ? when(point.at) : "Earlier, per the portal"}</dt>
              <dd>
                {eur(point.priceEur)}
                {delta}
              </dd>
            </div>
          );
        })}
      </dl>
      {history.points.some((point) => point.at == null) ? (
        <p className="meta">The portal shows an earlier price without a date, so it comes first. Everything after it is what this desk saw, and when.</p>
      ) : null}
      {history.points.length > 1 ? <p className="meta">Only prices you saved are dated. A cut made between two saves shows on the day of the later one.</p> : null}
    </section>
  );
}
