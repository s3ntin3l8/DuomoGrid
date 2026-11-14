# DuomoGrid

Self-hosted desk for homes you are thinking of buying or renting. You open a listing, the extension reads that page, and this server stores it and scores it. It does not crawl portals.

Purchase costs follow the German rules (transfer tax by state, notary, land register, buyer commission) but every label in the product is English. Rental listings are stored beside purchases and are never ranked on the same score. A purchase can be compared with the cold rent of similar rentals you have already saved.

## Run

```bash
cp .env.example .env
# set INGEST_TOKEN, then:
docker compose pull && docker compose up -d
```

To build from source instead, uncomment the `build:` block in `docker-compose.yml` and run `docker compose up -d --build`. For a reverse proxy (Traefik, Authentik), write a `docker-compose.override.yml` (gitignored) that drops the published port with `ports: !reset []`, joins your proxy network and adds your Traefik labels. Split the routing in two: `/listings` and `/assumptions` must bypass forward-auth (the extension cannot follow an SSO redirect; they are gated by the bearer token), while everything else, the desk and the unguarded example `/users`, must sit behind your forward-auth middleware, because the desk is otherwise published unauthenticated. Set `traefik.docker.network` to the proxy network and `traefik.http.services.<name>.loadbalancer.server.port=3000`. Also set `TRUST_PROXY` in `.env` to the proxy network's CIDR, or rate limiting sees every client as the proxy's IP (see `.env.example`).

The API listens on port 3000. After `npm run build`, that same port serves the desk. `GET /health` is the liveness check. Listing routes require `Authorization: Bearer $INGEST_TOKEN`.

For UI work with reload, run the API and the desk separately:

```bash
make dev
npm run dev:web
```

The desk on port 5173 proxies `/listings` and `/assumptions` to port 3000. Paste the ingest token once; it stays in this browser.

Without Docker:

```bash
make install
make dev
```

SQLite defaults to `file:./data/app.db`.

## Extension

Each GitHub release includes `duomogrid-extension-<version>.zip`, with `manifest.json` at the root of the archive. Unzip it and load that folder as an unpacked extension. The popup stores the server URL, so the same zip talks to a released image or to `:edge`. There is no separate extension build for edge. Set the server URL and the same ingest token in the popup, then open a single exposé and choose **Save to DuomoGrid**. A second save of the same listing updates the row and adds a price observation only when the price changed. A street is stored even when the page has no coordinate. When the page includes a coordinate, that point is stored too. A later save that omits the street or the coordinate leaves the stored value in place. Open the desk at the server URL, paste the token, and the listing is there. **Map** shows those stored points with the same filters as the list. Drag a pin to correct the building, or clear the point from the detail. There is no geocoder. The basemap is loaded from `tiles.openfreemap.org`, so opening the map requests tiles for the area in view from that host. The listings themselves stay on this machine. Opening a saved point looks up the Bavarian Bodenrichtwert for that plot and shows it on the detail. It is a land value in EUR per m² of land, not the asking price per living m², and not the official paid Auskunft. A zone that is not published shows the zone and no figure. No point, or a point outside Bavaria, shows nothing. A saved buy listing can also show a district sale band from the AK OGA Immobilienmarktbericht Deutschland 2025 for a used apartment or a house. The band is the published range for that district, not the value of this building, and not the asking-price guide. A buy can flag the asking price against a published Bodenrichtwert and against that district sale band. A missing figure adds no flag and does not change the score. Rentals are not flagged this way.

## What a saved listing shows

- **Place.** Neither portal publishes the address, so the point the extension reads is the middle of a quarter or an area. It is drawn as a grey pin and labelled approximate, the Bodenrichtwert at it carries a caveat, and an approximate point never earns the "under the plot's land value" flag. Drag the pin onto the building and it becomes exact. A later save from the portal never replaces a point you placed.
- **Photos and floor plans.** The extension sends the picture URLs the exposé lists, split into photos and floor plans (up to 30 and 10). They are loaded from the portal's own CDN and never copied, so they disappear when the portal delists the listing. Opening the desk asks that CDN for the thumbnails you can see, with no referrer.
- **Description and details.** The seller's text as published, in parts, and the facts the exposé lists: parking and its price, bedrooms, bathrooms, heating system and fuel, when the portal listed it. Facts read out of the text (heat pump, refurbishment, KfW standard, a renovation or heating year, a special levy, a reserve) are shown with the sentence they came from. Sentences that say no, or only that something is possible, are skipped. Two of them reach the analysis and no other: a renovation year, only to fill a gap, and the year the heating was renewed, for the energy score.
- **Price history.** A step chart and a timeline of the prices you saved, the cuts, and the days on the market. Immowelt's own earlier price has no date, so it is drawn first and hollow.
- **Auto-update, off by default.** The popup can switch on a price check: when you open the exposé of a listing you already saved, the extension sends it to your server, at most once per exposé every ten minutes, and the server records a new price. Nothing else changes, so your corrections stay, and a listing you did not save is never saved this way.
- **Score.** The heating cost uses the fuel the exposé names. A parking space sold with the home is charged taxes and fees and added to the cash needed. The energy score takes one heating adjustment: oil or night storage lower, gas lower, a heating renewed 30 or more years ago lower, a heat pump or district heat higher. Price cuts, time on the market, the portal's own estimate and findings from the text are flags and change no score. Rentals are still never scored.

## What is not here yet

Trends are the medians of listings you saved. These are tracked as issues:

- Local copies of photos and floor plans, which needs a decision on the "no requests" rule (#26).
- A stronger score that uses the district band, price cuts and the portal estimate (#27).
- Leasehold, listed-building and tenant flags driven by the description on the server (#28).
- A check of the Immowelt rental layout against a real saved rental page (#29).
- Taking the heating fuel from the description when the exposé names none (#30).

## Development

`make test`, `make lint`, and `make typecheck` match the template. See `AGENTS.md` for CI.

## License

AGPL-3.0. Copyright (C) 2026 Björn Hansen.
