import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { DeskListing } from "./api";

maplibregl.setWorkerUrl(workerUrl);

const STYLE = "https://tiles.openfreemap.org/styles/liberty";

const EXACT_COLOR = "#9c4228";
const APPROXIMATE_COLOR = "#8b8b8b";

/** A DOM node, not HTML: the title is listing text as published. */
function popupNode(title: string, approximate: boolean): HTMLElement {
  const node = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = title;
  node.append(heading);
  if (approximate) {
    const note = document.createElement("div");
    note.textContent = "Approximate location. Drag the pin to the building.";
    node.append(note);
  }
  return node;
}

function placed(rows: DeskListing[]) {
  return rows.filter((row) => row.listing.latitude != null && row.listing.longitude != null);
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
  const precisions = useRef(new Map<string, boolean>());
  const fitted = useRef("");
  const onOpenRef = useRef(onOpen);
  const onMoveRef = useRef(onMove);
  const rowsRef = useRef(rows);
  const [unavailable, setUnavailable] = useState("");
  onOpenRef.current = onOpen;
  onMoveRef.current = onMove;
  rowsRef.current = rows;

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
      precisions.current.clear();
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
          marker.remove();
          markers.current.delete(id);
          precisions.current.delete(id);
        }
      }
      for (const row of pins) {
        const latitude = row.listing.latitude;
        const longitude = row.listing.longitude;
        if (latitude == null || longitude == null) continue;
        const next: [number, number] = [longitude, latitude];
        const approximate = row.listing.locationPrecision === "approximate";
        let marker = markers.current.get(row.id);
        // The colour is fixed when a marker is made, so a pin that became exact is replaced.
        if (marker && precisions.current.get(row.id) !== approximate) {
          marker.remove();
          markers.current.delete(row.id);
          marker = undefined;
        }
        if (!marker) {
          const id = row.id;
          precisions.current.set(id, approximate);
          marker = new maplibregl.Marker({ draggable: true, color: approximate ? APPROXIMATE_COLOR : EXACT_COLOR })
            .setLngLat(next)
            .setPopup(new maplibregl.Popup({ closeButton: false, offset: 24 }).setDOMContent(popupNode(row.listing.title, approximate)))
            .addTo(map);
          marker.getElement().addEventListener("click", () => onOpenRef.current(id));
          marker.on("dragend", () => {
            const at = marker?.getLngLat();
            if (!at) return;
            const current = rowsRef.current.find((item) => item.id === id);
            const previous: [number, number] | null =
              current?.listing.longitude != null && current.listing.latitude != null
                ? [current.listing.longitude, current.listing.latitude]
                : null;
            void onMoveRef.current(id, at.lat, at.lng).catch(() => {
              if (previous) marker?.setLngLat(previous);
            });
          });
          markers.current.set(id, marker);
        } else {
          const at = marker.getLngLat();
          if (Math.abs(at.lat - latitude) > 1e-8 || Math.abs(at.lng - longitude) > 1e-8) marker.setLngLat(next);
          marker.getPopup()?.setDOMContent(popupNode(row.listing.title, approximate));
        }
      }
      const key = pins.map((row) => row.id).sort().join(",");
      if (key !== fitted.current && pins.length > 0) {
        fitted.current = key;
        if (pins.length === 1 && pins[0]?.listing.longitude != null && pins[0].listing.latitude != null) {
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
      }
    };
    if (map.loaded()) sync();
    else map.once("load", sync);
    return () => {
      map.off("load", sync);
    };
  }, [rows]);

  const missing = rows.length - placed(rows).length;
  return (
    <section className="map-panel">
      <p className="meta">Drag a pin to correct the building. Grey pins are approximate: the portal does not publish the address. Only stored points are shown.</p>
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
