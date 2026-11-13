# DuomoGrid

Self-hosted desk for homes you are thinking of buying or renting. You open a listing, the extension reads that page, and this server stores it and scores it. It does not crawl portals.

Purchase costs follow the German rules (transfer tax by state, notary, land register, buyer commission) but every label in the product is English. Rental listings are stored beside purchases and are never ranked on the same score. A purchase can be compared with the cold rent of similar rentals you have already saved.

## Run

```bash
cp .env.example .env
# set INGEST_TOKEN, then:
docker compose up --build
```

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

Load `extension/` as an unpacked extension. Set the server URL and the same ingest token in the popup, then open a single exposé and choose **Save to DuomoGrid**. A second save of the same listing updates the row and adds a price observation only when the price changed. A street is stored even when the page has no coordinate. When the page includes a coordinate, that point is stored too. A later save that omits the street or the coordinate leaves the stored value in place. Open the desk at the server URL, paste the token, and the listing is there. **Map** shows those stored points with the same filters as the list. Drag a pin to correct the building, or clear the point from the detail. There is no geocoder. The basemap is loaded from `tiles.openfreemap.org`, so opening the map requests tiles for the area in view from that host. The listings themselves stay on this machine. Opening a saved point looks up the Bavarian Bodenrichtwert for that plot and shows it on the detail. It is a land value in EUR per m² of land, not the asking price per living m², and not the official paid Auskunft. A zone that is not published shows the zone and no figure. No point, or a point outside Bavaria, shows nothing. A saved buy listing can also show a district sale band from the AK OGA Immobilienmarktbericht Deutschland 2025 for a used apartment or a house. The band is the published range for that district, not the value of this building, and not the asking-price guide. A buy can flag the asking price against a published Bodenrichtwert and against that district sale band. A missing figure adds no flag and does not change the score. Rentals are not flagged this way.

## What is not here yet

Trends are the medians of listings you saved.

## Development

`make test`, `make lint`, and `make typecheck` match the template. See `AGENTS.md` for CI.

## License

AGPL-3.0. Copyright (C) 2026 Björn Hansen.
