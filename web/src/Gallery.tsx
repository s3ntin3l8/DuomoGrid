import { useEffect, useState } from "react";
import type { DeskListing } from "./api";

type Image = DeskListing["listing"]["images"][number];
type Open = { list: Image[]; index: number } | null;

/** referrerPolicy keeps the desk's address out of the request, so a CDN has no reason to refuse a hotlink. */
function Picture({ image, className }: { image: Image; className?: string }) {
  return <img className={className} src={image.url} alt={image.caption ?? ""} loading="lazy" referrerPolicy="no-referrer" />;
}

function Lightbox({ open, onClose, onStep }: { open: NonNullable<Open>; onClose: () => void; onStep: (by: number) => void }) {
  const image = open.list[open.index];
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onStep(-1);
      if (event.key === "ArrowRight") onStep(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);
  if (!image) return null;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={image.caption ?? "Image"} onClick={onClose}>
      <figure onClick={(event) => event.stopPropagation()}>
        <img src={image.url} alt={image.caption ?? ""} referrerPolicy="no-referrer" />
        <figcaption>
          {image.caption ? `${image.caption} · ` : ""}
          {open.index + 1} of {open.list.length}
        </figcaption>
        <div className="row-actions">
          <button className="quiet" type="button" onClick={() => onStep(-1)} disabled={open.list.length < 2}>
            Previous
          </button>
          <button className="quiet" type="button" onClick={() => onStep(1)} disabled={open.list.length < 2}>
            Next
          </button>
          <a href={image.url} target="_blank" rel="noreferrer noopener">
            Open the original
          </a>
          <button className="primary" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </figure>
    </div>
  );
}

/** Photos as a strip under the title, floor plans as their own block. Both open in the same lightbox. */
export function Gallery({ row, part }: { row: DeskListing; part: "photos" | "floorplans" }) {
  const [open, setOpen] = useState<Open>(null);
  const all = row.listing.images;
  const list = all.filter((image) => (part === "photos" ? image.kind === "photo" : image.kind === "floorplan"));
  if (list.length === 0) return null;
  const step = (by: number) => setOpen((current) => (current ? { ...current, index: (current.index + by + current.list.length) % current.list.length } : current));
  const strip = (
    <div className={part === "photos" ? "strip" : "plans"}>
      {list.map((image, index) => (
        <button key={image.url} type="button" className="shot" onClick={() => setOpen({ list, index })} aria-label={image.caption ?? `Image ${index + 1}`}>
          <Picture image={image} />
          {part === "floorplans" && image.caption ? <span>{image.caption}</span> : null}
        </button>
      ))}
    </div>
  );
  const lightbox = open ? <Lightbox open={open} onClose={() => setOpen(null)} onStep={step} /> : null;
  if (part === "photos") {
    return (
      <>
        {strip}
        <p className="meta">Images load from the portal and disappear when the listing is taken down.</p>
        {lightbox}
      </>
    );
  }
  return (
    <section className="block">
      <h3>Floor plans</h3>
      {strip}
      {/* The photo strip carries this note. Without photos the plans must say it themselves. */}
      {all.some((image) => image.kind === "photo") ? null : (
        <p className="meta">Images load from the portal and disappear when the listing is taken down.</p>
      )}
      {lightbox}
    </section>
  );
}
