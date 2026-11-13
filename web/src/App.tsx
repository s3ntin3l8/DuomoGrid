import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  loadAssumptions,
  loadListings,
  rememberToken,
  saveAssumptions,
  saveListing,
  storedToken,
  type Assumptions,
  type DeskListing,
  type StateOption,
} from "./api";
import { AssumptionsForm } from "./Assumptions";
import { Compare } from "./Compare";
import { Detail } from "./Detail";
import { ListingMap } from "./Map";
import { eur, statusLabel } from "./format";

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

  async function refresh(nextToken: string) {
    const [list, model] = await Promise.all([loadListings(nextToken), loadAssumptions(nextToken)]);
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

  const active = rows.find((row) => row.id === activeId) ?? visible[0] ?? null;
  const compared = picked.map((id) => rows.find((row) => row.id === id)).filter((row): row is DeskListing => Boolean(row));

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

  async function mutate(id: string, body: { notes?: string; status?: string; latitude?: number; longitude?: number; clearPoint?: boolean }) {
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
                <strong>{row.listing.title}</strong>
                <span>{row.analysis.score ?? (row.listing.offer === "rent" ? "Rent" : "—")}</span>
                <small>
                  {[row.listing.city, row.listing.offer === "buy" ? "Buy" : "Rent"].filter(Boolean).join(" · ")}
                </small>
                <small>{eur(row.listing.priceEur)}</small>
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
        ) : null}
        {mode === "detail" && active ? (
          <Detail
            row={active}
            onBack={() => setReading(false)}
            onStatus={(next) => void mutate(active.id, { status: next })}
            onNotes={(notes) => void mutate(active.id, { notes })}
            onClearPoint={() => void mutate(active.id, { clearPoint: true })}
          />
        ) : null}
        {mode === "detail" && !active ? (
          <section className="empty">
            <h2 className="mark">Nothing saved yet.</h2>
            <p className="lede">
              Open one exposé on ImmoScout24 or Immowelt and use the extension. It sends that page here. This desk does not go looking for listings.
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
