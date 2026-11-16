# DuomoGrid

Self-hosted desk for homes you are thinking of buying or renting. You open a listing, the extension reads that page, and this server stores it and scores it. It does not crawl portals.

Purchase costs follow the German rules (transfer tax by state, notary, land register, buyer commission) but every label in the product is English. Rental listings are stored beside purchases and are never ranked on the same score. A purchase can be compared with the cold rent of similar rentals you have already saved.

## Run

```bash
cp .env.example .env
# set INGEST_TOKEN, then:
docker compose pull && docker compose up -d
```

To build from source instead, uncomment the `build:` block in `docker-compose.yml` and run `docker compose up -d --build`. For a reverse proxy (Traefik, Authentik), write a `docker-compose.override.yml` (gitignored) that drops the published port with `ports: !reset []`, joins your proxy network and adds your Traefik labels. Split the routing by header, not by path, on the same service, with the bearer router at the higher priority. A request that carries an `Authorization` header (the extension, and a desk that still pastes a token) must bypass forward-auth and strip client identity headers: the extension cannot follow an SSO redirect, and a client-supplied username must not survive onto that path. A request without that header, including the desk's own calls to `/listings` and `/assumptions`, goes through forward-auth, which sets the identity header. Put the same identity-header strip in front of that chain, so a client cannot pre-set the username. The bearer router's rule is the host plus a non-empty Authorization header (Traefik: Header regexp `.+`), at a higher priority than the forward-auth router. Set `traefik.docker.network` to the proxy network and `traefik.http.services.<name>.loadbalancer.server.port=3000`. Set `TRUST_PROXY` in `.env` to the proxy network's CIDR (a hop count or `true` does not enable identity-header auth) and `TRUSTED_AUTH_HEADER` to the header the proxy adds, for example `X-Authentik-Username`. The desk then skips the token prompt. Without that header name, or without an address-list `TRUST_PROXY`, the desk still asks for the token. Do not put a hostname in the tracked compose file. Rate limiting sees every client as the proxy's IP unless `TRUST_PROXY` is set (see `.env.example`).

The API listens on port 3000. After `npm run build`, that same port serves the desk. `GET /health` is the liveness check. Listing routes require `Authorization: Bearer $INGEST_TOKEN`, or a trusted forward-auth identity when `TRUSTED_AUTH_HEADER` is set. `INGEST_TOKEN` is still required either way.

For UI work with reload, run the API and the desk separately:

```bash
make dev
npm run dev:web
```

The desk on port 5173 proxies `/listings`, `/assumptions`, `/auth`, `/ai` and `/mcp` to port 3000. Paste the ingest token once; it stays in this browser. A deployed desk whose server reports proxy auth does not ask.

Without Docker:

```bash
make install
make dev
```

SQLite defaults to `file:./data/app.db`.

## Extension

Each GitHub release includes `duomogrid-extension-<version>.zip`, with `manifest.json` at the root of the archive. Unzip it and load that folder as an unpacked extension. The popup stores the server URL, so the same zip talks to a released image or to `:edge`. There is no separate extension build for edge. Open the desk, then choose **Pair with this tab** in the popup. That stores the server address and the ingest token. The two fields are still there if the desk is not the open tab. On Windows, Chrome will not update an unpacked extension. When a release is out, the popup says so. Replace the files in the same folder and click **Reload** on `chrome://extensions`. Do not load the new zip as a second extension: that is a new install, and the pairing does not follow it. Then open a single exposé and choose **Save to DuomoGrid**. A second save of the same listing updates the row and adds a price observation only when the price changed. A street is stored even when the page has no coordinate. When the page includes a coordinate, that point is stored too. A later save that omits the street or the coordinate leaves the stored value in place. Open the desk at the server URL and the listing is there. Paste the token unless the server is behind forward-auth, in which case the desk does not ask. **Map** shows those stored points with the same filters as the list. Each pin carries the score of the listing, coloured by the band the server gave it, and a rental shows as a rental because a rental is never scored. A hollow pin is an approximate point. Click a pin for the photo, the price, the area and the score, then open the listing from there; the map stays where it is. Pins that sit on top of each other are spread apart so the scores can be read. A pile of more than nine keeps the highest scores on the ring; the rest share the building. Drag a pin to correct the building, or clear the point from the detail. The arrow keys move a focused pin, and the shift key makes the step larger. There is no geocoder. The basemap is loaded from `tiles.openfreemap.org`, so opening the map requests tiles for the area in view from that host. The listings themselves stay on this machine. Opening a saved point looks up the Bavarian Bodenrichtwert for that plot and shows it on the detail. It is a land value in EUR per m² of land, not the asking price per living m², and not the official paid Auskunft. A zone that is not published shows the zone and no figure. No point, or a point outside Bavaria, shows nothing. A saved buy listing can also show a district sale band from the AK OGA Immobilienmarktbericht Deutschland 2025 for a used apartment or a house. The band is the published range for that district, not the value of this building, and not the asking-price guide. A buy can flag the asking price against a published Bodenrichtwert and against that district sale band. A missing figure adds no flag and does not change the score. Rentals are not flagged this way.

## What a saved listing shows

- **Place.** Neither portal publishes the address, so the point the extension reads is the middle of a quarter or an area. It is drawn as a grey pin and labelled approximate, the Bodenrichtwert at it carries a caveat, and an approximate point never earns the "under the plot's land value" flag. Drag the pin onto the building and it becomes exact. A later save from the portal never replaces a point you placed.
- **Photos and floor plans.** The extension sends the picture URLs the exposé lists, split into photos and floor plans (up to 30 and 10). They are loaded from the portal's own CDN and never copied, so they disappear when the portal delists the listing. Opening the desk asks that CDN for the thumbnails you can see, with no referrer.
- **Description and details.** The seller's text as published, in parts, and the facts the exposé lists: parking and its price, bedrooms, bathrooms, heating system and fuel, when the portal listed it. Facts read out of the text (heat pump, refurbishment, KfW standard, a renovation or heating year, a special levy, a reserve) are shown with the sentence they came from. Sentences that say no, or only that something is possible, are skipped. Two of them reach the score and no other: a renovation year, only to fill a gap, and the year the heating was renewed, for the energy score. A special levy or a leasehold named in the text also raises a flag, which changes no score.
- **Price history.** A step chart and a timeline of the prices you saved, the cuts, and the days on the market. Immowelt's own earlier price has no date, so it is drawn first and hollow.
- **Auto-update, off by default.** The popup can switch on a price check: when you open the exposé of a listing you already saved, the extension sends it to your server, at most once per exposé every ten minutes, and the server records a new price. Nothing else changes, so your corrections stay, and a listing you did not save is never saved this way.
- **Score.** The heating cost uses the fuel the exposé names. A parking space sold with the home is charged taxes and fees and added to the cash needed. The energy score takes one heating adjustment: oil or night storage lower, gas lower, a heating renewed 30 or more years ago lower, a heat pump or district heat higher. Price cuts, time on the market, the portal's own estimate and findings from the text are flags and change no score. A bought house with no stated condo fee has none, so its monthly cost includes maintenance (scaled by the age of the building), property tax and insurance from the assumptions, and a saved house's monthly total, its budget flag and its rent comparison rise when this ships. A house that states a Hausgeld keeps it and only adds the property tax, because the Hausgeld already covers upkeep and insurance. The defaults are rough, not quotes: about 10 EUR per m² a year for upkeep before the age factor (the usual rule of thumb is around 1 EUR per m² and month), 450 EUR a year property tax and 2.5 EUR per m² a year insurance. Replace them with your own figures. The financing section also shows what is still owed when the fixed-rate period ends and what the payment would be at a rate one and two points higher; these are display only. On the detail view of a purchase, the highest price that still fits your monthly budget and the highest price that still scores 65 ("worth a look") are solved by re-running the analysis at each price. Next to the saved rentals nearby, the desk compares buying with renting over the years you set: the cost that does not come back (interest, upkeep, purchase costs, and what your equity would have earned) against rent, and net wealth after that time. It uses the median cold rent of the rentals you saved in the same city and type and of a similar size, your assumed return, home price change and rent increase, and leaves out selling costs. Rentals are still never scored.

## Settings and market figures

**Settings** in the desk toolbar holds everything that applies to every listing: equity, term, budget, target price per m², the purchase fees and the financing rate. A section at the top shows where the market stands right now.

- **Market rates.** The desk reads the Deutsche Bundesbank's Zinsstatistik and shows the average effective rate for new residential mortgages of 10 years or more, secured by a lien, next to the unsecured rate, the rate on all new business and the rate on existing loans with up to a year to run. It also shows the spread between the secured and the unsecured rate, and the three most recent months. The Bundesbank publishes a new figure each month and marks the newest one as provisional, so the desk says so.
- **Suggestions, not changes.** A market figure is only ever a suggestion. Your score does not move because a statistic was revised. Each field says where its value came from: **user** (you typed it), **market** (you accepted a published figure, so a later refresh may move it) or **builtin** (the shipped value, which a refresh never touches). Press **Use** to accept a figure, or **Keep mine** to take a value back into your own hands. Typing a number makes it yours as well. **Read the market again** refreshes the figures and moves only the ones already following the market.
- **The range.** The Bundesbank's own spread bounds are no longer served, so the range under the interest rate is the range the rate actually moved in over the last twelve months. It is a rough guide, not a quote.
- **Purchase fees.** The notary, land register and the buyer's share of the commission follow the Gerichts- und Notarkostengesetz and § 656c BGB. They are the same in every state, so they are shown with their rule rather than as a market figure, and there is nothing to refresh.
- **Energy prices.** With a Destatis GENESIS account in `.env` (`DESTATIS_API_TOKEN`, or `DESTATIS_API_USER` and `DESTATIS_API_PASSWORD`), the desk reads the average household electricity and gas prices and offers them as the heating rate for those fuels. Without one, there are no energy prices and the desk says so. The market rates need no account and always work.
- **Heating costs.** The settings hold a rate per fuel, in euro per kWh: electricity, gas, district heat, heating oil, wood and pellets, and one for a home whose heating is not named. The first five cover the eight fuels the analysis knows, because what matters is what burns: a heat pump, an electric heater and night storage all take the electricity rate, and biogas takes the gas rate. Electricity and gas have a published household price to accept; the rest are yours to set. A rate you type is never moved by a refresh.

These are published statistics, not quotes and not a valuation. The desk names the publisher and the period next to every figure it shows.

## Agent & LLM integration

- **Provider setup.** Open **AI** in the desk toolbar (or set `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` in `.env`) to connect a local OpenAI-compatible server (`http://127.0.0.1:11434/v1` for Ollama, `http://127.0.0.1:1234/v1` for LM Studio) or Anthropic (`https://api.anthropic.com` with a Claude Console API key). Allowed base-URL hosts are `127.0.0.1`, `localhost` (use `localhost` when a local server binds to IPv6 loopback), `host.docker.internal`, `api.openai.com`, and `api.anthropic.com`. API keys saved in the desk require `DB_ENCRYPTION_KEY` and are encrypted at rest; keys set via `AI_API_KEY` in `.env` are kept only in memory and never copied into the database.
- **LLM description extraction.** When AI is configured, **Extract with AI** on a listing (or automatic extraction on save) reads the German exposé text and details into structured facts and fills only missing fields (such as condo fee, refurbishment year, energy class/source, leasehold, or current rent) without overwriting portal-supplied or manually corrected values. When AI is off, the deterministic regex parser runs as before.
- **In-desk chat & Makler inquiry.** **Ask AI** answers questions about the active listing or your saved portfolio by calling deterministic server tools (`simulate_analysis`, `compare_listings`, `get_listing`, `list_listings`) so German purchase costs and financing math are never guessed by the model. Each listing detail view also builds a **Due diligence & Makler inquiry** with an English checklist of missing facts and a copy-pasteable German message to the real-estate agent.
- **Model Context Protocol (MCP).** External agents (Claude Desktop, Cursor, Claude Code) can connect either over HTTP at `POST /mcp` (with `Authorization: Bearer $INGEST_TOKEN`) or locally over `stdio` via `npm run mcp`.

## What is not here yet

Trends are the medians of listings you saved. These are tracked as issues:

- Local copies of photos and floor plans, which needs a decision on the "no requests" rule (#26). That rule is about portal pages. The extension popup does ask GitHub, at most once an hour, whether a newer release zip exists.
- A stronger score that uses the district band, price cuts and the portal estimate (#27).
- Leasehold, listed-building and tenant flags driven by the description on the server (#28).
- A check of the Immowelt rental layout against a real saved rental page (#29).
- Taking the heating fuel from the description when the exposé names none (#30).

## Development

`make test`, `make lint`, and `make typecheck` match the template. See `AGENTS.md` for CI.

## License

AGPL-3.0. Copyright (C) 2026 Björn Hansen.
