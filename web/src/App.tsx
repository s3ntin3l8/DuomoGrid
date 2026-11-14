import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  loadAssumptions,
  loadListing,
  loadListings,
  rememberToken,
  removeListing,
  saveAssumptions,
  saveListing,
  storedToken,
  type Assumptions,
  type DeskListing,
  type ListingPatch,
  type StateOption,
} from "./api";
import { AssumptionsForm } from "./Assumptions";
import { Compare } from "./Compare";
import { Detail } from "./Detail";
import { eur, historyText, historyTone, perM2Text, statusLabel } from "./format";

const ListingMap = lazy(() => import("./Map").then((mod) => ({ default: mod.ListingMap })));

function PriceMove({ row }: { row: DeskListing }) {
  const buy = row.listing.offer === "buy";
  const figure = perM2Text(buy, buy ? row.analysis.pricePerLivingM2 : row.analysis.rentPerM2);
  const text = [figure, historyText(row.priceHistory)].filter(Boolean).join(" · ");
  if (!text) return null;
  const tone = historyTone(row.priceHistory);
  return <small className={tone ? `per ${tone}` : "per"}>{text}</small>;
}

type OfferFilter = "all" | "buy" | "rent";
type Mode = "detail" | "compare" | "assumptions" | "map";

export function App() {
  const [token, setToken] = useState(storedToken);
  const [authed, setAuthed] = useState(Boolean(storedToken()));
  const [rows, setRows] = useState<DeskListing[]>([]);
  const [assumptions, setAssumptions] = useState<Assumptions | null>(null);
  const [states, setStates] = useState<StateOption[]>([]);
  const [error, setError] = useState("");
  const [offer, setOffer] = useState<OfferFilter>("all");
  const [status, setStatus] = useState("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("detail");
  const [reading, setReading] = useState(false);
  const [landPendingId, setLandPendingId] = useState<string | null>(null);
  const [landMissId, setLandMissId] = useState<string | null>(null);

  async function refresh(nextToken: string) {
    const [list, model] = await Promise.all([loadListings(nextToken), loadAssumptions(nextToken)]);
    // The list is light again, so rows must ask for their detail again.
    asked.current.clear();
    setRows(list);
    setAssumptions(model.assumptions);
    setStates(model.states);
    setActiveId((current) => current ?? list[0]?.id ?? null);
  }

  useEffect(() => {
    if (!authed || !token) return;
    let cancelled = false;
    void refresh(token).catch((reason: unknown) => {
      if (cancelled) return;
      if (reason instanceof ApiError && (reason.status === 401 || reason.status === 503)) {
        rememberToken("");
        setAuthed(false);
        setError(reason.message);
        return;
      }
      setError(reason instanceof Error ? reason.message : "Could not load the desk.");
    });
    return () => {
      cancelled = true;
    };
  }, [authed, token]);

  const visible = useMemo(() => {
    return rows
      .filter((row) => (offer === "all" ? true : row.listing.offer === offer))
      .filter((row) => (status === "all" ? true : row.status === status))
      .slice()
      .sort((left, right) => (right.analysis.score ?? -1) - (left.analysis.score ?? -1));
  }, [rows, offer, status]);

  const active = activeId === "" ? null : rows.find((row) => row.id === activeId) ?? visible[0] ?? null;
  const compared = picked.map((id) => rows.find((row) => row.id === id)).filter((row): row is DeskListing => Boolean(row));

  // The list leaves out the long text, and the land value is looked up on demand. Both come from the detail route,
  // so the row on show loads it once. That covers the first row shown without a click as well.
  const asked = useRef(new Set<string>());
  const shownId = mode === "detail" ? (active?.id ?? null) : null;
  const shownNeedsFull = active?.descriptionFindings == null;
  const shownNeedsLand = active?.bodenrichtwert?.status === "unknown";
  const shownStamp = active?.updatedAt ?? "";
  useEffect(() => {
    if (!shownId || !authed || (!shownNeedsFull && !shownNeedsLand)) return;
    const key = `${shownId}:${shownStamp}`;
    if (asked.current.has(key)) return;
    asked.current.add(key);
    if (shownNeedsLand) {
      setLandPendingId(shownId);
      setLandMissId((current) => (current === shownId ? null : current));
    }
    void loadListing(token, shownId)
      .then((fresh) => {
        setRows((current) => current.map((item) => (item.id === shownId ? fresh : item)));
        if (!shownNeedsLand) return;
        setLandPendingId((current) => (current === shownId ? null : current));
        if (fresh.bodenrichtwert?.status === "unknown") setLandMissId(shownId);
      })
      .catch(() => {
        asked.current.delete(key);
        if (!shownNeedsLand) return;
        setLandPendingId((current) => (current === shownId ? null : current));
        setLandMissId(shownId);
      });
  }, [shownId, shownStamp, shownNeedsFull, shownNeedsLand, authed, token]);

  function open(id: string) {
    setActiveId(id);
    setMode("detail");
    setReading(true);
  }

  function togglePick(id: string) {
    setPicked((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 3) return current;
      return [...current, id];
    });
  }

  async function mutate(id: string, body: ListingPatch) {
    const updated = await saveListing(token, id, body);
    setRows((current) => current.map((row) => (row.id === id ? updated : row)));
  }

  if (!authed) {
    return (
      <main className="gate">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const next = String(data.get("token") ?? "").trim();
            if (!next) return;
            rememberToken(next);
            setToken(next);
            setError("");
            setAuthed(true);
          }}
        >
          <p className="mark">DuomoGrid</p>
          <h1>The desk</h1>
          <p className="lede">Paste the ingest token from the server. Listings stay on that machine.</p>
          <label>
            Ingest token
            <input name="token" type="password" autoComplete="current-password" />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <div className="row-actions" style={{ marginTop: 14 }}>
            <button className="primary" type="submit">Open</button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <div className={reading ? "shell reading" : "shell"}>
      <aside className="rail">
        <div className="brand">
          <h1 className="mark">DuomoGrid</h1>
          <button
            type="button"
            onClick={() => {
              rememberToken("");
              setToken("");
              setAuthed(false);
            }}
          >
            Lock
          </button>
        </div>
        <div className="filters" role="group" aria-label="Offer">
          {(["all", "buy", "rent"] as const).map((item) => (
            <button key={item} className="chip" type="button" aria-pressed={offer === item} onClick={() => setOffer(item)}>
              {item === "all" ? "All" : item === "buy" ? "Buy" : "Rent"}
            </button>
          ))}
        </div>
        <div className="filters">
          {["all", "open", "visit", "offer", "pass"].map((item) => (
            <button key={item} className="chip" type="button" aria-pressed={status === item} onClick={() => setStatus(item)}>
              {item === "all" ? "Any status" : statusLabel(item)}
            </button>
          ))}
        </div>
        <div className="list">
          {visible.length === 0 ? <p className="meta">Nothing in this filter.</p> : null}
          {visible.map((row) => (
            <div className="pick" key={row.id}>
              <input
                type="checkbox"
                aria-label={`Compare ${row.listing.title}`}
                checked={picked.includes(row.id)}
                onChange={() => togglePick(row.id)}
              />
              <button type="button" className={row.id === active?.id ? "item on" : "item"} onClick={() => open(row.id)}>
                {row.coverUrl ? <img className="thumb" src={row.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                <strong>{row.listing.title}</strong>
                <span>{row.analysis.score ?? (row.listing.offer === "rent" ? "Rent" : "—")}</span>
                <small>
                  {[row.listing.city, row.listing.offer === "buy" ? "Buy" : "Rent"].filter(Boolean).join(" · ")}
                </small>
                <small>{eur(row.listing.priceEur)}</small>
                <PriceMove row={row} />
              </button>
            </div>
          ))}
        </div>
      </aside>
      <main className="main">
        <div className="toolbar">
          <p className="meta">{rows.length === 0 ? "No saved listings" : `${rows.length} saved`}</p>
          <div className="hero-actions">
            <button className="quiet" type="button" aria-pressed={mode === "map"} onClick={() => { setMode("map"); setReading(true); }}>
              Map
            </button>
            <button className="quiet" type="button" onClick={() => { setMode("assumptions"); setReading(true); }}>
              Assumptions
            </button>
            <button
              className="primary"
              type="button"
              disabled={compared.length < 2}
              onClick={() => { setMode("compare"); setReading(true); }}
            >
              Compare {compared.length > 0 ? compared.length : ""}
            </button>
          </div>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {mode === "assumptions" && assumptions ? (
          <AssumptionsForm
            key={JSON.stringify(assumptions)}
            initial={assumptions}
            states={states}
            onSave={async (next) => {
              const saved = await saveAssumptions(token, next);
              setAssumptions(saved.assumptions);
              await refresh(token);
              setMode("detail");
            }}
          />
        ) : null}
        {mode === "compare" && compared.length >= 2 ? <Compare rows={compared} /> : null}
        {mode === "map" ? (
          <Suspense fallback={<p className="meta">Loading the map…</p>}>
            <ListingMap
              rows={visible}
              onOpen={open}
              onMove={async (id, latitude, longitude) => {
                try {
                  await mutate(id, { latitude, longitude });
                } catch (reason: unknown) {
                  setError(reason instanceof Error ? reason.message : "Could not move the pin.");
                  throw reason;
                }
              }}
            />
          </Suspense>
        ) : null}
        {mode === "detail" && active ? (
          <Detail
            key={active.id}
            row={active}
            states={states}
            onBack={() => setReading(false)}
            onStatus={(next) => void mutate(active.id, { status: next })}
            onNotes={(notes) => void mutate(active.id, { notes })}
            onCorrect={async (correction) => {
              try {
                await mutate(active.id, correction);
                setError("");
              } catch (reason: unknown) {
                setError(reason instanceof Error ? reason.message : "Could not save the correction.");
                throw reason;
              }
            }}
            onRemove={async () => {
              const id = active.id;
              try {
                await removeListing(token, id);
                setRows((current) => current.filter((row) => row.id !== id));
                setPicked((current) => current.filter((item) => item !== id));
                setActiveId("");
                setReading(false);
                setError("");
              } catch (reason: unknown) {
                setError(reason instanceof Error ? reason.message : "Could not remove the listing.");
                throw reason;
              }
            }}
            onClearPoint={() => void mutate(active.id, { clearPoint: true })}
            landPending={landPendingId === active.id && active.bodenrichtwert?.status === "unknown"}
            landMiss={landMissId === active.id && active.bodenrichtwert?.status === "unknown"}
          />
        ) : null}
        {mode === "detail" && !active ? (
          rows.length === 0 ? (
            <section className="empty">
              <h2 className="mark">Nothing saved yet.</h2>
              <p className="lede">
                Open one exposé on ImmoScout24 or Immowelt and use the extension. It sends that page here. This desk does not go looking for listings.
              </p>
            </section>
          ) : (
            <section className="empty">
              <h2 className="mark">Listing removed.</h2>
              <p className="lede">Pick another one from the list. Pass still only changes the status.</p>
            </section>
          )
        ) : null}
      </main>
    </div>
  );
}
