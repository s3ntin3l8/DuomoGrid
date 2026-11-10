# DuomoGrid

Self-hosted desk for homes you are thinking of buying or renting. You open a listing, the extension reads that page, and this server stores it and scores it. It does not crawl portals.

Purchase costs follow the German rules (transfer tax by state, notary, land register, buyer commission) but every label in the product is English. Rental listings are stored beside purchases and are never ranked on the same score. A purchase can be compared with the cold rent of similar rentals you have already saved.

## Run

```bash
cp .env.example .env
# set INGEST_TOKEN, then:
docker compose up --build
```

The API listens on port 3000. `GET /health` is the liveness check. Listing routes require `Authorization: Bearer $INGEST_TOKEN`.

Without Docker:

```bash
make install
make dev
```

SQLite defaults to `file:./data/app.db`.

## Extension

Load `extension/` as an unpacked extension. Set the server URL and the same ingest token in the popup, then open a single exposé and choose **Save to DuomoGrid**. A second save of the same listing updates the row and adds a price observation only when the price changed.

## What is not here yet

There is no web UI in this repo yet. The extension and the API are the first slice. Trends are the medians of listings you saved, not a market index.

## Development

`make test`, `make lint`, and `make typecheck` match the template. See `CLAUDE.md` for CI.

## License

AGPL-3.0. Copyright (C) 2026 Björn Hansen.
