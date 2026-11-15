import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DeskListing } from "./api";
import { eur, num, perM2Text } from "./format";
import { clustersOf, pinLook, spreadOffsets } from "./mapModel";

maplibregl.setWorkerUrl(workerUrl);

const STYLE = "https://tiles.openfreemap.org/styles/liberty";

/**
 * A DOM node, not HTML: the title is listing text as published.
 * The score band is a class name from a fixed set, never from the payload.
 */
function text(value: string, className?: string): HTMLElement {
  const node = document.createElement(className ? "span" : "div");
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

/** The pin: a badge with the score. An approximate point gets a hollow ring, not just another colour. */
function markerElement(row: DeskListing): HTMLElement {
  const { className, label } = pinLook(row);
  const element = document.createElement("button");
  element.type = "button";
  element.className = `map-pin ${className}`;
  if (row.listing.locationPrecision === "approximate") element.classList.add("approximate");
  element.setAttribute("aria-label", `${row.listing.title}. ${pinSummary(row)}`);
  element.append(text(label, "map-pin-label"));
  return element;
}

/** One line of the most important facts, used on the pin's tooltip and in its accessible name. */
function pinSummary(row: DeskListing): string {
  const buy = row.listing.offer === "buy";
  const price = eur(row.listing.priceEur);
  const perM2 = perM2Text(buy, buy ? row.analysis.pricePerLivingM2 : row.analysis.rentPerM2);
  const score = row.analysis.score == null ? (buy ? "not scored" : "rent") : `score ${row.analysis.score}`;
  return [price, perM2, score].filter(Boolean).join(" · ");
}

/** The hover preview. Short: the title, the price and the score. */
function tooltipNode(row: DeskListing): HTMLElement {
  const node = document.createElement("div");
  node.className = "map-tooltip";
  node.append(text(row.listing.title, "map-tooltip-title"));
  const buy = row.listing.offer === "buy";
  const perM2 = perM2Text(buy, buy ? row.analysis.pricePerLivingM2 : row.analysis.rentPerM2);
  node.append(text([eur(row.listing.priceEur), perM2].filter(Boolean).join(" · "), "map-tooltip-meta"));
  const score = row.analysis.score == null ? null : `Score ${row.analysis.score}`;
  if (score) node.append(text(score, "map-tooltip-score"));
  return node;
}

/**
 * The overlay on a click: the most important facts about the house, and a link to the
 * detail view. It stays on the map, so the other pins are still there to compare against.
 */
function overlayNode(row: DeskListing, onOpen: (id: string) => void, onClose: () => void): HTMLElement {
  const { listing, analysis } = row;
  const buy = listing.offer === "buy";
  const node = document.createElement("div");
  node.className = "map-card";

  const heading = document.createElement("div");
  heading.className = "map-card-heading";
  const title = text(listing.title, "map-card-title");
  heading.append(title);
  const place = [listing.district, listing.city].filter(Boolean).join(", ");
  heading.append(text([place, buy ? "Buy" : "Rent"].filter(Boolean).join(" · "), "map-card-meta"));
  // The close button sits on the title's line, so the card stays compact.
  const close = document.createElement("button");
  close.type = "button";
  close.className = "map-card-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    onClose();
  });
  heading.append(close);
  node.append(heading);

  const body = document.createElement("div");
  body.className = "map-card-body";
  if (row.coverUrl) {
    // Hotlinked from the portal CDN, like every other thumbnail in the desk.
    const photo = document.createElement("img");
    photo.className = "map-card-photo";
    photo.src = row.coverUrl;
    photo.alt = "";
    photo.loading = "lazy";
    photo.referrerPolicy = "no-referrer";
    body.append(photo);
  }
  const facts = document.createElement("div");
  facts.className = "map-card-facts";
  facts.append(text(eur(listing.priceEur), "map-card-price"));
  const perM2 = perM2Text(buy, buy ? analysis.pricePerLivingM2 : analysis.rentPerM2);
  const area = listing.livingAreaM2 != null ? `${num(listing.livingAreaM2, listing.livingAreaM2 % 1 === 0 ? 0 : 1)} m²` : null;
  const detail = [perM2, area].filter(Boolean).join(" · ");
  if (detail) facts.append(text(detail, "map-card-meta"));
  body.append(facts);
  node.append(body);

  const score = document.createElement("div");
  score.className = "map-card-score";
  if (analysis.score == null) {
    score.append(text(buy ? "Not scored" : "Rent", "map-card-verdict"));
  } else {
    const { className, label } = pinLook(row);
    const badge = document.createElement("span");
    badge.className = `map-score ${className}`;
    badge.append(text(label));
    score.append(badge);
    score.append(text(analysis.verdict, "map-card-verdict"));
  }
  node.append(score);

  if (listing.locationPrecision === "approximate") {
    node.append(text("Approximate location. Drag the pin to the building.", "map-card-note"));
  }

  const actions = document.createElement("div");
  actions.className = "map-card-actions";
  const open = document.createElement("button");
  open.type = "button";
  open.className = "primary";
  open.textContent = "Open the listing";
  open.addEventListener("click", (event) => {
    event.stopPropagation();
    onOpen(row.id);
  });
  actions.append(open);
  node.append(actions);

  // Escape closes the overlay from anywhere inside it.
  node.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  });

  return node;
}

function placed(rows: DeskListing[]) {
  return rows.filter((row) => row.listing.latitude != null && row.listing.longitude != null);
}

/** The point a listing is stored at, for a pin that is moved back after a failed save. */
function previousPoint(rows: DeskListing[], id: string): [number, number] | null {
  const row = rows.find((item) => item.id === id);
  if (row?.listing.longitude == null || row.listing.latitude == null) return null;
  return [row.listing.longitude, row.listing.latitude];
}

export function ListingMap({
  rows,
  onOpen,
  onMove,
}: {
  rows: DeskListing[];
  onOpen: (id: string) => void;
  onMove: (id: string, latitude: number, longitude: number) => Promise<void>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const tooltips = useRef(new Map<string, maplibregl.Popup>());
  const signatures = useRef(new Map<string, string>());
  /** The listing's own point, which a spread pin does not change. */
  const truth = useRef(new Map<string, [number, number]>());
  const fitted = useRef("");
  const onOpenRef = useRef(onOpen);
  const onMoveRef = useRef(onMove);
  const rowsRef = useRef(rows);
  const [unavailable, setUnavailable] = useState("");
  onOpenRef.current = onOpen;
  onMoveRef.current = onMove;
  rowsRef.current = rows;

  /**
   * Pins that sit on top of each other hide their scores. This pushes the ones that
   * overlap apart on the screen. It moves the drawn pin only, through the marker's own
   * offset, so the point it stands for is unchanged and a drag still ends on the
   * coordinates the user dropped it on.
   */
  const spread = useCallback((map: maplibregl.Map) => {
    const live = [...markers.current.entries()].map(([id, marker]) => {
      const at = truth.current.get(id);
      if (!at) return null;
      const point = map.project(at);
      return { id, marker, x: point.x, y: point.y };
    });
    const entries = live.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (entries.length === 0) return;
    for (const cluster of clustersOf(entries)) {
      // A pin on its own goes back to its point. A zoom that pulls a group apart
      // must not leave the old spread in place.
      const offsets = cluster.length < 2 ? [{ dx: 0, dy: 0 }] : spreadOffsets(cluster.length);
      cluster.forEach((entry, index) => {
        const { dx, dy } = offsets[index] ?? { dx: 0, dy: 0 };
        // The overlay is anchored on the true point, so it has to move with the drawn pin.
        entry.marker.setOffset([dx, dy]);
        entry.marker.getPopup()?.setOffset([dx + 18, dy]);
      });
    }
  }, []);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const map = new maplibregl.Map({
      container,
      style: STYLE,
      center: [11.4, 48.7],
      zoom: 6,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    let gone = false;
    map.on("error", (event) => {
      if (gone || ("sourceId" in event && event.sourceId)) return;
      const message = event.error instanceof Error ? event.error.message : "The map could not load.";
      setUnavailable(message);
    });
    mapRef.current = map;
    return () => {
      gone = true;
      markers.current.forEach((marker) => marker.remove());
      markers.current.clear();
      tooltips.current.forEach((tooltip) => tooltip.remove());
      tooltips.current.clear();
      signatures.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sync = () => {
      const pins = placed(rows);
      const ids = new Set(pins.map((row) => row.id));
      for (const [id, marker] of markers.current) {
        if (!ids.has(id)) {
          tooltips.current.get(id)?.remove();
          tooltips.current.delete(id);
          marker.remove();
          markers.current.delete(id);
          signatures.current.delete(id);
          truth.current.delete(id);
        }
      }
      for (const row of pins) {
        const latitude = row.listing.latitude;
        const longitude = row.listing.longitude;
        if (latitude == null || longitude == null) continue;
        const next: [number, number] = [longitude, latitude];
        const approximate = row.listing.locationPrecision === "approximate";
        const { className, label } = pinLook(row);
        // The pin's look is baked into its element, so a pin whose score band moved is replaced.
        const signature = `${className}:${label}:${approximate}`;
        let marker = markers.current.get(row.id);
        if (marker && signatures.current.get(row.id) !== signature) {
          tooltips.current.get(row.id)?.remove();
          tooltips.current.delete(row.id);
          marker.remove();
          markers.current.delete(row.id);
          marker = undefined;
        }
        if (!marker) {
          const id = row.id;
          signatures.current.set(id, signature);
          truth.current.set(id, next);
          // The overlay and the tooltip read the row as it is now, not as it was when
          // the pin was made, so a changed price shows right away.
          const currentRow = () => rowsRef.current.find((item) => item.id === id) ?? row;
          marker = new maplibregl.Marker({ draggable: true, element: markerElement(row), anchor: "bottom" })
            .setLngLat(next)
            .setPopup(
              // The overlay opens beside the pin, so the pin and the other pins stay
              // visible while it is open.
              new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: 18, anchor: "left", maxWidth: "300px" }).setDOMContent(
                overlayNode(
                  currentRow(),
                  (openId) => onOpenRef.current(openId),
                  () => marker?.getPopup()?.remove(),
                ),
              ),
            )
            .addTo(map);
          const element = marker.getElement();
          const hideTooltip = () => {
            tooltips.current.get(id)?.remove();
            tooltips.current.delete(id);
          };
          // The pin is a button, so it is reachable by keyboard. The map opens the
          // popup on a click that lands on the marker, so there is no click handler
          // that also toggles: a second one would leave the overlay closed.
          element.addEventListener("mouseenter", () => {
            if (marker?.getPopup()?.isOpen()) return;
            hideTooltip();
            const at = marker?.getLngLat();
            if (!at) return;
            const shift = marker?.getOffset();
            const tooltip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: [shift?.x ?? 0, (shift?.y ?? 0) - 28], className: "map-tooltip-popup" })
              .setLngLat(at)
              .setDOMContent(tooltipNode(currentRow()));
            tooltip.addTo(map);
            tooltips.current.set(id, tooltip);
          });
          element.addEventListener("mouseleave", hideTooltip);
          // The overlay takes the pin's place, so the hover preview goes away with it.
          // A keyboard activation synthesises a click (detail 0). keydown already toggled
          // the overlay, so that click must not reach the map's second toggle.
          element.addEventListener("click", (event) => {
            hideTooltip();
            if (event.detail === 0) event.stopPropagation();
          });
          const savePoint = () => {
            const at = marker?.getLngLat();
            if (!at) return;
            const previous = previousPoint(rowsRef.current, id);
            if (previous && Math.abs(previous[0] - at.lng) < 1e-8 && Math.abs(previous[1] - at.lat) < 1e-8) return;
            void onMoveRef.current(id, at.lat, at.lng).catch(() => {
              if (!previous) return;
              marker?.setLngLat(previous);
              truth.current.set(id, previous);
            });
          };
          element.addEventListener("keydown", (event) => {
            // Enter and Space: preventDefault stops the button's synthetic click and the
            // marker's own keypress toggle, so the overlay opens once instead of twice.
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              hideTooltip();
              marker?.togglePopup();
              return;
            }
            // Escape closes the overlay. The focus stays on the pin, so the map's own
            // handling does not see the key.
            if (event.key === "Escape") {
              event.stopPropagation();
              if (!marker?.getPopup()?.isOpen()) return;
              marker.getPopup()?.remove();
              return;
            }
            // A pin with its own element cannot be dragged with the arrow keys, so the
            // keyboard moves it here. One press is one screen pixel; shift makes it ten.
            // stopPropagation keeps the map from panning (and Shift+Arrow from rotating).
            // The save waits for the key to be released, so holding the key does not
            // write a point on every repeat.
            const pixels = event.shiftKey ? 10 : 1;
            const deltas: Record<string, [number, number]> = {
              ArrowUp: [0, -pixels],
              ArrowDown: [0, pixels],
              ArrowLeft: [-pixels, 0],
              ArrowRight: [pixels, 0],
            };
            const delta = deltas[event.key];
            if (!delta || !marker) return;
            event.preventDefault();
            event.stopPropagation();
            const at = marker.getLngLat();
            const point = map.project(at);
            const moved = map.unproject([point.x + delta[0], point.y + delta[1]]);
            const nextPoint: [number, number] = [moved.lng, moved.lat];
            marker.setLngLat(nextPoint);
            truth.current.set(id, nextPoint);
          });
          element.addEventListener("keyup", (event) => {
            if (!event.key.startsWith("Arrow")) return;
            event.stopPropagation();
            savePoint();
          });
          element.addEventListener("blur", savePoint);
          marker.on("dragend", () => {
            const at = marker?.getLngLat();
            if (!at) return;
            const previous = previousPoint(rowsRef.current, id);
            void onMoveRef.current(id, at.lat, at.lng).catch(() => {
              if (!previous) return;
              marker?.setLngLat(previous);
              truth.current.set(id, previous);
            });
          });
          markers.current.set(row.id, marker);
        } else {
          // The stored point moved, so the pin's own point moves with it.
          truth.current.set(row.id, next);
          const at = marker.getLngLat();
          if (Math.abs(at.lat - latitude) > 1e-8 || Math.abs(at.lng - longitude) > 1e-8) marker.setLngLat(next);
          // The overlay shows the listing as it is now, so a changed price shows right away.
          const popup = marker.getPopup();
          if (popup?.isOpen()) {
            popup.setDOMContent(
              overlayNode(
                row,
                (openId) => onOpenRef.current(openId),
                () => marker?.getPopup()?.remove(),
              ),
            );
          }
        }
      }
      spread(map);
      const key = pins.map((row) => row.id).sort().join(",");
      if (key !== fitted.current && pins.length > 0) {
        fitted.current = key;
        if (pins.length === 1 && pins[0]?.listing.longitude != null && pins[0]?.listing.latitude != null) {
          map.jumpTo({ center: [pins[0].listing.longitude, pins[0].listing.latitude], zoom: 13 });
        } else {
          const bounds = new maplibregl.LngLatBounds();
          for (const row of pins) {
            if (row.listing.longitude != null && row.listing.latitude != null) {
              bounds.extend([row.listing.longitude, row.listing.latitude]);
            }
          }
          map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
        }
        // The fit changed the zoom, so the pins have to be spread again.
        map.once("moveend", () => spread(map));
      }
    };
    if (map.loaded()) sync();
    else map.once("load", sync);
    const onMoveEnd = () => spread(map);
    map.on("moveend", onMoveEnd);
    return () => {
      map.off("load", sync);
      map.off("moveend", onMoveEnd);
    };
  }, [rows, spread]);

  const missing = rows.length - placed(rows).length;
  return (
    <section className="map-panel">
      <p className="meta">
        Click a pin for the price, the area and the score, then open the listing from there. Drag a pin to correct the building.
        A hollow pin is approximate: the portal does not publish the address. Only stored points are shown.
      </p>
      <p className="meta">Basemap tiles are requested from OpenFreeMap for the area in view. The listings themselves stay on this machine.</p>
      {unavailable ? <p className="error">Map unavailable. {unavailable}</p> : null}
      <div ref={host} className="map-canvas" />
      {missing > 0 ? (
        <p className="meta">
          {missing} in this filter {missing === 1 ? "has" : "have"} no point, so {missing === 1 ? "it is" : "they are"} not on the map.
        </p>
      ) : null}
    </section>
  );
}
