# CLAUDE.md — DuomoGrid

Self-hosted Fastify service for buy and rent listings the user chooses to save.
The browser extension reads only the exposé already open on ImmoScout24 or Immowelt
and POSTs it to `/listings`. The desk in `web/` is a Vite app, built into `web/dist` and served
on `/` outside of tests. Analysis (purchase costs, financing, energy, rent-versus-buy)
runs on the server. SQLite lives in a Docker volume. UI, code, and docs are English.
City names and listing text stay as published.

The repo was created from `node-backend-template`. The sections below are still the
operational contract (layout, CI, commands). The example `/users` route is unused
by the product and can be removed once nothing in CI depends on it.


A Fastify + TypeScript backend starter (SQLite via Drizzle, encryption-at-rest,
security middleware) wired to the centralized CI/CD in
[`s3ntin3l8/.github`](https://github.com/s3ntin3l8/.github). If you are an AI agent
or developer working in a repo created from this template, read this first.

## First steps after creating a repo from this template

1. Rename the placeholders: `name` in `package.json`, the `# Project Name` title in
   `README.md`, and any references to `node-backend-template`.
2. `make install` — install dependencies (`npm ci`).
3. `make install-hooks` — installs the pre-commit and pre-push hooks.
4. `make build` — verify everything compiles.
5. Decide your CI coverage floor: `ci-cd.yml` ships `test-script: "test:coverage"`;
   the reusable `ci-node` defaults `coverage-fail-under: '0'` (a starter floor) —
   **ratchet it up** as you add real code. Test sharding is shipped off; enable it
   via the commented `test-shards` lines in `ci-cd.yml` (the `json` coverage reporter
   that shard merging needs is already set in `vitest.config.ts`).
6. Set the Hermes review secrets `HERMES_APP_ID`, `HERMES_APP_PRIVATE_KEY` and
   `HERMES_API_KEY` — as repo secrets **and** under Settings → Secrets → Dependabot
   (a Dependabot-authored run sees only the latter). Without them `hermes.yml` skips
   with a notice. Keep Settings → Actions → General → "Require approval for all outside
   collaborators" on: the reviewer runs on a self-hosted runner.

## Commands (Makefile)

| Command | Does |
|---------|------|
| `make install` | Install dependencies (`npm ci`). |
| `make install-hooks` | Install pre-commit + pre-push hooks. |
| `make dev` | Start the dev server with reload (`tsx watch`). |
| `make test` | Run the Vitest suite. |
| `make test-coverage` | Run tests with coverage (`vitest run --coverage`). |
| `make lint` | Run ESLint. |
| `make typecheck` | Type-check with `tsc --noEmit`. |
| `make build` | Production build → `dist/`. |
| `make clean` | Remove `node_modules`, `dist`, and caches. |

Direct npm equivalents also exist: `npm run db:generate` (after `src/db/schema.ts`
edits) and `npm run db:seed`.

## Architecture / Layout

- **App factory**: `src/app.ts` exports `buildApp()`, which registers plugins then
  routes and returns the Fastify instance. `src/server.ts` calls it and handles
  listen + graceful shutdown (`SIGINT`/`SIGTERM`).
- **Plugins** (`src/plugins/`, all wrapped in `fastify-plugin`): `env` (validated
  config on `app.config`), `logging`, `security` (helmet, rate-limit, CORS), `db`
  (runs migrations, decorates `app.db` and `app.encryption`, closes the DB on
  shutdown).
- **Routes** (`src/routes/`): each exports an `async (app) => {}` plugin. `health`
  has `/health` (liveness) and `/ready` (DB ping). `users` is the example CRUD
  demonstrating `app.db` + `app.encryption` + JSON-schema validation.
- **DB** (`src/db/`): Drizzle schema/client/seed; SQL migrations in `drizzle/`.
  `getDb()`/`ensureDb()`/`closeDb()` manage a singleton connection.
- `Dockerfile` — multi-stage build → non-root runtime (built/pushed by CI).
- `.github/workflows/` — thin callers of the reusable workflows in `s3ntin3l8/.github`.
- `.claude/` — `settings.json` + `hooks/session-start.sh`: a SessionStart hook that
  installs deps and tooling so
  [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web)
  sessions can build, test, and lint. Runs only in the remote env.

## Key invariants

Rules a change to this repo should not silently break, with the reasoning behind each — add to
this list as the codebase grows past "starter template." It's intentionally short today.

## CI/CD — uses centralized reusable workflows

Workflows here are **callers** of `s3ntin3l8/.github/.github/workflows/*.yml@main`:
`ci-cd.yml` (ci-node + docker-publish), `codeql.yml`, `dependency-review.yml`,
`release-please.yml`, `ghcr-cleanup.yml`, `hermes.yml` (AI PR review).

**The #1 thing to get right:** a caller job that invokes a reusable workflow needing
write scopes **must declare a `permissions:` block** — the default `GITHUB_TOKEN` is
read-only and the run otherwise fails at startup with zero jobs. The caller's grant
must cover **every** scope the reusable workflow's jobs declare, or the run fails at
startup. `build-docker` needs `contents: read` + `packages: write` +
`id-token: write` (the last for keyless image signing); `codeql` needs
`security-events: write`; `release-please` needs `contents: write` +
`pull-requests: write`; `hermes.yml` needs only `contents: read`. See the `s3ntin3l8/.github` README for the full table.

`ci-node` installs via `npm ci`, runs lint + `test:coverage`, and uploads coverage to
Codecov.

> **Codecov TODO:** coverage upload requires a `CODECOV_TOKEN` repo secret and the
> repo onboarded on [codecov.io](https://about.codecov.io/) before results/badges
> show. The workflow runs the upload unconditionally; it just no-ops without the token.

## Conventions

- **ESM throughout** (`"type": "module"`); imports use `.js` specifiers even for `.ts`
  sources (Node16 resolution). Prefer `import type` for type-only imports (enforced by
  ESLint).
- **Conventional Commits** — Release Please cuts versions/changelogs from them.
- Tests live in `test/`, mirroring `src/`, and use `app.inject()`. `test/setup.ts`
  gives each test file an isolated temp SQLite DB.
- Config is read from `app.config` (typed via the `declare module "fastify"`
  augmentation in `src/plugins/env.ts`) — not `process.env` directly.
- After changing `src/db/schema.ts`, run `npm run db:generate` and commit the
  generated migration.
- **Secrets:** never commit real credentials; `detect-secrets` runs in pre-commit and
  CI against `.secrets.baseline` (regenerate with
  `detect-secrets scan > .secrets.baseline` after vetting new detections).
- **Before committing:** run `make lint && make typecheck && make test` (the pre-push
  hook enforces this).

## Documentation map

- `README.md` — setup and usage instructions for whatever you build from this template.
- `CLAUDE.md` (this file) — the live contract for how the repo is wired: layout, invariants,
  CI/CD conventions. Keep it in sync with the code, not with what the code used to do.

Add real docs here as the project grows past what these two files can hold on their own (e.g. an
API contract, an architecture decision log, an operational runbook) — this section exists so
that pattern has an obvious place to start rather than being invented under time pressure later.
