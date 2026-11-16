# Compose + per-host override (Pocket / branchDAM pattern)

## Context
`compose.yaml` today builds locally and publishes :3000. We want the Pocket-style split:
a committed, host-agnostic `compose.yaml` that pulls the published image, a committed
`compose.override.example.yaml` showing a Traefik + Authentik setup with placeholder
values, and a gitignored `compose.override.yaml` with this host's real wiring
(`docker compose` merges it automatically, the same way branchDAM does).

Auth split: the extension POSTs to `/listings` with a Bearer token and has no Authentik
session. So the data routes skip Authentik and stay protected by `INGEST_TOKEN`, and only
the desk (`/`) sits behind forward-auth. This is the same two-router shape as branchDAM.

## REVISION (supersedes 1–4 below)
- Rename `compose.yaml` to **`docker-compose.yml`** (committed; `git mv`). If both files
  existed, compose would pick `compose.yaml`, so the old file must go. This file *is* the
  example, done the branchDAM way: `image: ghcr.io/s3ntin3l8/duomogrid:${IMAGE_TAG:-latest}`,
  `name: duomogrid`, the `proxy` network, and both routers with placeholder values
  (`duomogrid.example.com`, desk on `authentik@file`, API on `/listings` + `/assumptions`
  with bearer auth only). No published ports.
- **`docker-compose.override.yml`** is gitignored and auto-merged. It holds the edge image,
  the dev-01 hostname, `chain-authentik@file` and `strip-identity@file`.
- There is **no** override example file. `.gitignore` gets `docker-compose.override.yml`.
- The README "Run" section points at the labels to edit, or at an override.

## Changes (worktree `.wt/chore-compose-override`, branch `chore/compose-override`)

1. **`compose.yaml`** (committed, generic)
   - `name: duomogrid` pins the project, so a run from a worktree adopts the same stack
     and volume.
   - `image: ghcr.io/s3ntin3l8/duomogrid:${IMAGE_TAG:-latest}`, `pull_policy: always`.
     `latest` is the newest release.
   - Keep the env vars (`INGEST_TOKEN: ${INGEST_TOKEN:?…}`, `DATABASE_URL`, `PORT`) and add
     `DB_ENCRYPTION_KEY: ${DB_ENCRYPTION_KEY:-}` and `LOG_LEVEL`.
   - `security_opt: [no-new-privileges:true]`, `restart: unless-stopped`, and the
     `duomo-data` volume (same name, so existing data is kept).
   - `ports: "127.0.0.1:${DUOMO_PORT:-3000}:3000"`, so a plain `docker compose up` works
     with no proxy. The override drops it with `ports: !reset []`. This needs Compose
     v2.24 or later; the host has v5.7.
   - A header comment explaining the layering, how to verify it with
     `docker compose config`, and the `edge`/`latest` choice.
2. **`compose.override.example.yaml`** (committed): a Traefik example on `dg.example.com`
   - `ports: !reset []`, `networks: [proxy]` (external).
   - Router `duomogrid-api`: `Host && (PathPrefix(/listings) || PathPrefix(/assumptions))`,
     priority 100, bearer-only. Its comment explains why it bypasses forward-auth (the
     extension has no session).
   - Router `duomogrid`: `Host`, priority 10, `middlewares: authentik@file`.
   - Service port 3000, `certresolver` via `${TRAEFIK_CERTRESOLVER:-cloudflare}`.
   - An optional outpost router (`/outpost.goauthentik.io/`), left commented out.
   - `IMAGE_TAG` stays commented, so the example uses `latest`.
3. **`compose.override.yaml`** (gitignored, local only, never committed)
   - `image: ghcr.io/s3ntin3l8/duomogrid:edge`, which tracks pushes to main.
   - Host `duomogrid.dev-01.in.s3ntin3l8.de`.
   - Desk router uses `chain-authentik@file`. The API router uses `strip-identity@file`
     only, the same as branchDAM's real override.
   - The global authentik-outpost router already serves `/outpost.goauthentik.io/`, so
     this file needs no outpost router.
4. **`.gitignore`**: add `compose.override.yaml` and `compose.override.yml`.
5. **README "Run"** and the AGENTS.md Docker bullet: describe pull versus local build
   (`docker compose build` stays possible through a `build: .` line in the override, or
   with `--build`). Point readers to the example override.
6. **Follow-up issue (deferred)**: `fix: trust Traefik for client IPs`. The app does not
   set `trustProxy`, so behind Traefik the rate limit (100/min) buckets every client under
   the proxy IP. Link it from the PR.

## Running on dev-01 (this host) during development
- This host already has the `proxy` network, `traefik` and the `authentik-outpost`
  container. The real `compose.override.yaml` therefore goes in the main checkout
  (`~/projects/DuomoGrid`), which is where the stack is run from.
- The override's `ports: !reset []` keeps the container off host port 3000, so
  `make dev` (:3000) and `npm run dev:web` (:5173) keep working alongside the deployed
  stack. The only way in is through Traefik.
- The pinned `name: duomogrid` means that running compose from a `.wt/*` worktree can
  never start a second stack on the same hostname.
- There is no `.env` in the main checkout yet. I'll create one (gitignored) with a freshly
  generated `INGEST_TOKEN` and `DB_ENCRYPTION_KEY`. Note: changing the encryption key
  later makes the encrypted columns unreadable.
- Because the image tracks `edge`, every merge to main lands on dev-01 at the next
  `docker compose pull && docker compose up -d`. Migrations run at startup and don't
  roll back.

## Verification
- `docker compose config` with a dummy `INGEST_TOKEN` must show the merged labels, no
  ports, and the `edge` image.
- `docker compose -f compose.yaml config` must show `latest` and the 127.0.0.1 port.
- `docker compose -f compose.yaml -f compose.override.example.yaml config` must parse.
- Run the gate (`make lint && make typecheck && make test`) and pre-commit
  (detect-secrets), then open the PR and request a review via `mullion review`.
- Ask the user before running `docker compose up -d` on the host, because it is a live
  deploy. Then check `https://duomogrid.dev-01…/`: it should redirect to Authentik. A
  `POST /listings` without a session but with a Bearer token should return 2xx/4xx, not
  a redirect.
