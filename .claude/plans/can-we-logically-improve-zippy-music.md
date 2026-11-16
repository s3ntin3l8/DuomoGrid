# Richer listing data, working map and land value, price history, moderate scoring

## Context

I ran `extension/extract.js` against the two saved pages in `.sample/` (IS24 169094394, Immowelt b1aa3ad6…). Most of what you're missing comes from extraction gaps, not from the desk:

- **IS24:**
  - No coordinates. They sit in `IS24.expose` → `exposeMap.location.{latitude,longitude}` (with `showFullAddress:false`), which no collector reads. With no point there is no pin and no Bodenrichtwert lookup.
  - `city` is `"Eichstätt_Kreis"`: `obj_regio2` is the Kreis, and the town is `locationAddress.city` = Kösching.
  - Several fields hold sentinels or wrong values:
    - `street` = `"no_information"` and `condition` = "no information".
    - `provisionText` = `"y"`.
    - `energyCert` is null although `obj_energyType` = `energy_required`.
  - The description is never read. `snippet` is the meta description.
  - Not captured either:
    - gallery (`galleryData.images[].type` PICTURE/FLOORPLAN, plus `linksAndDocuments.items[].floorPlan`);
    - 2 parking spaces at 10.000 €;
    - bathrooms;
    - "Bezugsfrei ab";
    - `furnishingDescription` ("Wärmepumpe, Fußbodenheizung").
- **Immowelt:** the new page layout is almost entirely missed. Price, area, rooms, city and PLZ all come back null, the type is `other`, and the title is garbage. Everything is in `window["__UFRN_LIFECYCLE_SERVERREQUEST__"]=JSON.parse("…")` → `app_demand_referral_cldp.data.classified`:
  - `sections.hardFacts.price.previousPrice` (329.000 → 319.000);
  - `metadata.creationDate` (listed since);
  - `domains.medias.images[]` and `.floorplans[]`, already classified;
  - `sections.energy.features` (heatingSystem, energySource = Pellets, state, yearOfConstruction);
  - `features.details.categories` (Außen-Stellplatz, Keller…);
  - description texts;
  - `location.geometry` MultiPolygon (address not published);
  - `price.base.commissionFee` "3,57 % (inkl. MwSt.)";
  - `priceComparison` (an Immowelt €/m² estimate, area unclear, so it is display only).
- **Rotekapsel** shows whether the price changed, when the listing was first published, and how long it has been online. We can do the same with our own `observations` plus the portal dates and previous price.

Your decisions: **hotlink images**, **opt-in auto-update on revisit**, **moderate scoring**, **Bodenrichtwert on approximate points shown with a caveat**.

The work ships as five PRs, sequenced because everything depends on PR 1. Each PR updates both copies of the skill (`.claude/skills/duomogrid/SKILL.md` and `.agents/skills/duomogrid/SKILL.md`) where it changes an invariant. Each PR runs the gate (`make lint && make typecheck && make test`) and gets a `duomogrid-reviewer` pass.

---

## PR 1: `fix(extension): read current IS24 and Immowelt exposés` (map and Bodenrichtwert start working)

**Repo hygiene:** add `.sample/` to `.gitignore`. The real pages contain agent names and phone numbers, so they are never committed.

**`extension/extract.js`**
- Add a new collector, `immoweltClassified(doc)`. It finds the `__UFRN_LIFECYCLE_SERVERREQUEST__` script, does `JSON.parse(JSON.parse(literal))`, and maps **explicit paths** into one flat record that is pushed **first** (because `pick` is first-match-wins):
  - price: `tracking.av_items[0].price` or `mortgage.price`;
  - area: `advertising.tracking_config.Wohnflaeche`;
  - rooms: `Raeume`;
  - city and PLZ: `location.address.city` / `zipCode`;
  - `Bundesland`;
  - type: `rawData.propertyType` + `distributionType`;
  - title: `sections.description.headline` / `mainDescription.headline`;
  - commission: `price.base.commissionFee.value`;
  - year, condition and energy from `sections.energy`;
  - `externalId` = `metadata.legacyId` (the URL UUID, so already-saved rows still match). Do **not** use `classified.id`.
- Add an IS24 collector built on the existing `assignedObject`:
  - `galleryData`;
  - the `"exposeMap"` / `"location"` object, read **by path** (`location.latitude/longitude`), so the `quarterBoundsJson` corners are never picked;
  - `locationAddress` (city, zip, street, isFullAddress);
  - `exposeContent`;
  - `linksAndDocuments`.
- Fix the IS24 values:
  - city = `locationAddress.city` → `obj_regio3`, and `obj_regio2` only as a last resort with `_Kreis` stripped;
  - district = null when it equals the city;
  - add `obj_energyType` → `energyCert`;
  - `obj_courtage: "y"` is not provision text.
- Filter the `no_information` sentinel globally in `unwrap`/`pick`. Also filter `keine Angabe`.
- Add `locationPrecision: "approximate" | "exact"` to the payload:
  - IS24 sends `exact` only when `showFullAddress`/`isFullAddress` is true;
  - Immowelt sends the polygon centroid (mean of the ring vertices) as `approximate`.

**Server**
- `src/domain/ingest.ts`: accept the client precision **only** as `"approximate"`. Anything else, including a missing value, stays `"exact"`, which keeps old extensions working.
- POST upsert in `src/routes/listings.ts`: an incoming approximate point **never replaces** a stored exact point (one that was dragged or PATCHed). Otherwise the existing replace rules apply. PATCH keeps setting `exact`.
- `asInput` / types: `locationPrecision: "exact" | "approximate" | null` (`src/domain/types.ts`).
- Bodenrichtwert: still look it up at approximate points. In `landValueFlag` (`src/domain/analyze.ts`), an approximate point never yields the `good` "under the plot's land value" flag. It yields only the info flag, with "approximate location" in its detail.

**Desk**
- `web/src/Map.tsx`: approximate pins get a different marker (hollow/grey) and a popup line "approximate location — drag to the building". Dragging already PATCHes to exact.
- `Detail.tsx` `LandValue`: add the caveat line when the point is approximate.
- `web/src/api.ts`: mirror the precision type.

**Tests**
- Add two new **synthetic, anonymized** fixtures in `test/extension/fixtures/` that reproduce the real structures:
  - an IS24 JS literal with embedded JSON, including bbox decoys;
  - an Immowelt double-encoded `JSON.parse`.
- Assert:
  - city Kösching-style;
  - the point, and that it is not a bbox corner;
  - precision;
  - Immowelt price, area and rooms;
  - `externalId` = UUID;
  - the sentinels are gone.
- Route tests:
  - an approximate point does not overwrite an exact one;
  - an approximate point never produces the good land flag.

## PR 2: `feat: store the description and listing details`

**Payload (additive, `v: 1`; add the aliases to both sides)**
- `description`: `{ object, furnishing, location, other }`, each up to 6000 chars.
- `heatingSystem`: e.g. Zentralheizung, Fußbodenheizung.
- `energySource`: Pellets, Wärmepumpe, Gas, Öl, Fernwärme, Strom.
- `parkingSpaces`, `parkingType` (garage / outdoor / underground / carport), `parkingPriceEur`.
- `bathrooms`, `bedrooms`, `availableFrom`, `listedAt` (Immowelt `creationDate`).
- `portalPreviousPriceEur` (Immowelt `previousPrice`; IS24 when `showPriceReduction` is set).
- `portalMarketEurPerM2` with low/high (Immowelt `priceComparison`).
- `details`: label → value pairs from the Immowelt categories and IS24 `is24qa-*` dt/dd. These stay as published, in German.

**Schema** (`src/db/schema.ts` → `npm run db:generate`, new migration only)
- Typed columns for what analysis reads: `heating_system`, `energy_source`, `parking_spaces`, `parking_type`, `parking_price_eur`, `listed_at`, `portal_previous_price_eur`, `portal_market_eur_per_m2`.
- JSON text columns for display-only data: `description_json`, `details_json`, and `images_json` (filled in PR 3).
- **Re-save rule:** a save that lacks these keys (an older installed extension) keeps the stored values, following the `street` precedent.

**Description findings** (new `src/domain/describe.ts`, server side, so it is testable and runs on stored text)
- English-labelled findings with the matched German snippet:
  - Wärmepumpe, Fußbodenheizung, Kernsanierung / KfW-standard;
  - "renoviert/saniert (ca.) YYYY" → `yearRefurbished` when it is missing;
  - heating replacement year;
  - Sonderumlage, Instandhaltungsrücklage amount, Erbbaurecht, vermietet, Denkmal.
- Leasehold, monument and tenant detection move here from `extract.js`. The extension regex stays as a fallback for older servers.

**Desk:** a "Description" section with collapsible Objekt / Ausstattung / Lage / Sonstiges, shown as published. A "Details" grid for parking, bathrooms, available from, heating system, energy source and floor. The Energy line shows source and system. All are added to `DeskListing` in `api.ts`.

**Payload size:** `GET /listings` omits `description`, `details` and `images`, which only `GET /listings/:id` returns. `observations.rawJson` stores the body **without** description and images.

## PR 3: `feat: show photos and floor plans`

- Payload `images: [{ url, caption, kind: "photo" | "floorplan" }]`, capped at 40, with URL host allowlisted to the two CDNs. Sources:
  - IS24: `galleryData` (FLOORPLAN type) plus `linksAndDocuments` with `floorPlan:true`;
  - Immowelt: `medias.images` / `medias.floorplans`.
- `parseIngest` validates `https:` and the host allowlist and drops anything else.
- `src/plugins/security.ts`: add `https://pictures.immobilienscout24.de` and `https://mms.immowelt.de` to `img-src`. Record this in SKILL §2.
- Desk:
  - the photo strip/lightbox on `Detail.tsx`;
  - a separate **Floor plans** section with large view and open-in-tab;
  - a thumbnail (first photo) on the list rows, from a single `coverUrl` added to the list payload;
  - a disclosure line ("Images load from the portal; they vanish when the listing is taken down").
- Before merging, check in the Mullion browser that one URL from each CDN renders from the desk origin. Hotlink protection is a risk.
- File an issue: archive images locally (needs a decision on the no-fetch rule).

## PR 4: `feat: price history with reductions and time on market`

- **History:** `observations` stays the source of current price. The undated `portalPreviousPriceEur` is stored on the listing, **not** synthesized as an observation, so `seenAt` ordering and dedup stay intact.
- Server `present()` adds `priceHistory`:
  - `firstKnownPriceEur` (portal previous, else oldest observation);
  - `currentPriceEur`;
  - `totalChangeEur` / `Pct`;
  - `reductions` (count of downward steps, plus 1 for the portal previous price when higher);
  - `listedAt ?? createdAt` → `daysOnMarket`;
  - `lastChangeAt`.
- Lift the 12-observation cap for the detail route.
- **Desk:**
  - a rotekapsel-style badge on list rows: "−3 % · 2× · 45 d";
  - in Detail, a small SVG step chart of price over time (no new dependency) plus a timeline list that marks the portal-reported previous price as "per portal, undated";
  - extend `priceMove` / `priceMoveText` in `web/src/format.ts`.
- **Opt-in auto-update:**
  - a popup checkbox "Update saved listings when I open them" (`chrome.storage.sync`);
  - a new MV3 background service worker (`manifest.json` `background.service_worker`) receives a message from `content.js` after extraction and POSTs with `updateOnly: true`;
  - the server answers **204 and writes nothing** when the listing isn't saved yet, so browsing never creates listings;
  - the existing observation-dedup rule applies, and notes and status are kept as they are today.
  - Update SKILL §3: the popup reads `body.created`, and an `updateOnly` save is 200 or 204.

## PR 5: `feat(score): energy source, parking and heating age in the buy score` (moderate)

All changes are in `src/domain/analyze.ts`, and null stays null.

- **Heating cost:** `heatingEuroPerKwh` uses `energySource` first, then falls back to the `heating` label. Pellets 0.08 and heat pump 0.28 already exist, so "Zentralheizung + Pellets" stops falling to the 0.12 default.
- **Parking:** a known `parkingPriceEur` on a buy is added to the fee base and `cashToCloseEur`. It shows as its own "Parking" line in Cash to close and is not part of `priceEur` / €/m². An unknown price adds nothing and is not 0. Existing exact-value tests stay valid because no fixture has parking.
- **Energy subscore:**
  - an oil or gas source, or a heating replacement year from the description that is 30 or more years old, takes 8 points off (stacking with the existing oil/night-storage −12 capped at one penalty);
  - a heat pump or district heating adds 5;
  - a new "Fossil heating may need replacing (GEG)" warn flag.
- **Flags only (not score inputs):**
  - price reduced (good/info with the amounts);
  - long time on market (over 120 days, info: "room to negotiate");
  - the portal €/m² estimate compared with the asking price (info, labelled as the portal's estimate);
  - description findings (Sonderumlage warn, Kernsanierung/KfW info).
- Keep subscore weights unchanged. Update SKILL §6 with the new inputs and keep the README claim that rentals are never scored.
- File an issue for the "Strong" scoring variant (district band or portal estimate as the price reference, a reduction bonus), so it is recorded but deferred.

---

## Critical files

- `extension/extract.js`, `extension/content.js`, `extension/popup.{js,html}`, `extension/manifest.json`
- `src/domain/ingest.ts`, `src/domain/analyze.ts`, `src/domain/types.ts`, the new `src/domain/describe.ts`
- `src/routes/listings.ts` (`present`, POST upsert, `history`), `src/db/schema.ts` and the new `drizzle/` migration
- `src/plugins/security.ts` (img-src)
- `web/src/api.ts`, `Detail.tsx`, `App.tsx`, `Map.tsx`, `format.ts`, `styles.css`
- `test/extension/fixtures/*` (new synthetic files), `test/extension/*.test.ts`, `test/routes/listings.test.ts`, the new `test/domain/describe.test.ts`
- Both SKILL.md copies, and the README "what is not built yet" list

## Reuse

- `assignedObject`, `pick`, `parseDeNumber`, `parseProvision`, `energyClass` in `extract.js`
- `looseNumber`, `pointOf` in `ingest.ts`
- `ensureBodenrichtwert` / `bodenrichtwertView` in `listings.ts`
- `priceMove` in `web/src/format.ts`
- `Line` / `block` components in `Detail.tsx`

## Verification

1. Per PR, run `make lint && make typecheck && make test` in a fresh `.wt/<branch>` worktree (`make install` first).
2. Run the extractor against the real `.sample/` pages with a scratch jsdom script (outside the repo). For both portals, expect:
   - price, area, rooms, city (Kösching / Hepberg), PLZ, state Bayern, a point with `approximate`;
   - heating source, parking, description, and images with floor plans split out;
   - Immowelt `portalPreviousPriceEur` 329000.
3. Run `make dev` + `npm run dev:web` with `INGEST_TOKEN`. POST both extracted payloads with curl, then in the Mullion browser check:
   - both pins appear on the Map tab, styled as approximate;
   - Detail shows the Bodenrichtwert with the caveat, the description, details, the photo strip, and floor plans as a separate section;
   - images load (CSP), and the price history badge reads "−3 %";
   - after re-POSTing with a lower price, the chart and reduction count update;
   - dragging the pin turns the point exact, and the caveat disappears.
4. Extension: load it unpacked and enable auto-update.
   - Opening an unsaved exposé creates nothing (204).
   - Reopening a saved one adds an observation only if the price changed.
