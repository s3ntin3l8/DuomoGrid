# AGENTS.md — DuomoGrid

Self-hosted Fastify service for buy and rent listings the user chooses to save.
The browser extension reads only the exposé already open on ImmoScout24 or Immowelt
and POSTs it to `/listings`. The desk in `web/` is a Vite app, built into `web/dist` and served
on `/` outside of tests. Analysis (purchase costs, financing, energy, rent-versus-buy)
runs on the server. SQLite lives in a Docker volume. UI, code, and docs are English.
City names and listing text stay as published.

The repo was created from `node-backend-template` (Fastify + TypeScript, SQLite via Drizzle,
encryption-at-rest, security middleware) and is wired to the centralized CI/CD in
[`s3ntin3l8/.github`](https://github.com/s3ntin3l8/.github). The example `/users` route is unused
by the product and can be removed once nothing in CI depends on it.

<!-- mullion:briefing:start -->
This repo's correctness invariants live in `.claude/skills/duomogrid/SKILL.md`. They cover the ingest guard scoping, the extension↔server payload aliases, buy-versus-rent scoring, price history in `observations`, null-not-zero analysis math, the hand-mirrored desk types, and the migration and DB-singleton footguns. Read it before changing `src/`, `web/`, `extension/` or `drizzle/`. To review a diff against it, delegate to the `duomogrid-reviewer` agent (`.claude/agents/duomogrid-reviewer.md`), which reads that skill first and applies it as its checklist.

## Workflow Conventions

- Never commit directly to the default branch. Always branch and open a PR.
- Branch off the latest remote default branch, never off your local one: `git fetch origin && git checkout -b <branch> origin/<default>`. A local default branch is routinely stale, which is what makes a PR show up as "out-of-date with the base branch" the moment it's opened.
- Work in a dedicated worktree per branch, under `.wt/<name>` (the branch name with `/` replaced by `-`, so the directory stays flat), off the latest remote default branch: `git fetch origin && git worktree add .wt/<name> -b <branch> origin/<default>`. A fresh worktree does not inherit installed dependencies — reinstall them there before testing or building.
- Commit and PR titles need a Conventional Commits prefix (`feat:`, `fix:`, `chore:`, ...).
- Squash-merge PRs — the PR title becomes the commit message on the default branch.
- Require green CI before merging.
- Run a self-review pass on your own diff before declaring done.

  Request an automated/bot review through the review relay (`mullion review`, or the `request_review` tool) — once after opening the pull request, and again per head commit after pushing fixes for a changes-requested review, then wait for it. A review comment that mentions the review bot is for humans, not agents; if no relay is set up, tell the human instead. One review per pull request at a time: a review that is already running is not re-requested — the request is refused with its run id, and that refusal is the answer, not an error to retry: wait for it, or stop it with stop_review. A review takes 10-30 minutes; check review_status once instead of asking again. After pushing fixes for a changes-requested review, ask again only when no review is in flight. Once the review bot has approved, apply its remaining suggestions and push without requesting another review, even though the head moved: small targeted fixes do not change the verdict, and re-reviewing them only breeds more nits. Never re-trigger a review with an @mention of the review bot: that path is for humans, and it queues another round behind the running one.
- Fixing the code is not enough to address review feedback — reply to each inline comment via the GitHub API, then resolve the thread via the GraphQL `resolveReviewThread` mutation, rather than pushing a silent fix. Reply with `gh api repos/{owner}/{repo}/pulls/<pr>/comments/<comment_id>/replies -f body="…"`; resolve with `gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<thread_id>"}) { thread { isResolved } } }'`, taking the thread id from a `reviewThreads` query on the pull request, not from the REST comment id.
- File a tracked issue for anything a plan defers, blocks, or descopes, and link it from the PR (using the repository's issue template if it has one) — a footnote in a plan doc is not a durable record. Write each one as a spec an agent can implement on its own (scope, acceptance criteria), not as a note. Title it the way this repo titles commits and PRs, reusing its existing scope names rather than coining new ones; attach it as a sub-issue to the matching open epic when one exists; and set GitHub's `blocked_by` dependency where one issue cannot start before another closes.
- After a merge, delete the local and remote branch and remove any associated worktree.
- Before pushing, run the full lint/typecheck/test/format gate.
<!-- mullion:briefing:end -->

## Repo specifics

- **Pre-push gate:** `make lint && make typecheck && make test`. There is no format target. `.prettierrc` exists, but no script, hook or CI step runs Prettier. `make typecheck` checks both the server (`tsconfig.json`) and the desk (`web/tsconfig.json`).
- **Hooks:** `make install-hooks` needs `pre-commit` on PATH. pre-commit runs detect-secrets, whitespace/YAML/JSON checks and ESLint. pre-push runs typecheck and the tests.
- **Fresh worktree:** `make install` (`npm ci`), then `make build`. The build compiles the server to `dist/` and the desk to `web/dist/`.
- **Local UI work:** run `make dev` (API on :3000) and `npm run dev:web` (desk on :5173, which proxies only `/listings` and `/assumptions`). Every listing/assumption route needs `Authorization: Bearer $INGEST_TOKEN`. Without `INGEST_TOKEN` set, those routes return 503.
- **npm-only scripts:** `npm run db:generate` (after `src/db/schema.ts` edits), `npm run db:seed`, `npm run dev:web`.
- **Releases:** Release Please cuts versions and `CHANGELOG.md` from Conventional Commit titles on `main`. Don't hand-edit `CHANGELOG.md` or `.release-please-manifest.json`.
- **CI:** `ci-cd.yml` runs `ci-node` (`npm ci`, lint, `test:coverage` with `strict-checks`, Codecov upload) and then `build-docker`, which publishes `s3ntin3l8/duomogrid`. `hermes.yml` is the AI PR reviewer, running on a self-hosted runner.
- **detect-secrets** runs on changed files only. It matches a known secret by filename, hash and type, but the hook rewrites the baseline's line numbers and fails until the baseline is refreshed. A change that shifts lines in a baselined file therefore needs `.secrets.baseline` regenerated in the same change (`detect-secrets scan > .secrets.baseline`, after vetting new detections).
- **Docker:** the image installs with `npm ci --ignore-scripts` on `node:26-slim` (no Python/node-gyp), so native dependencies must ship prebuilds. `compose.yaml` refuses to start without `INGEST_TOKEN`.
- **Repository setup** (coverage floor, test sharding, Hermes and Codecov secrets) is in `CONTRIBUTING.md`. Read it only when changing CI coverage or sharding, or when review/coverage uploads are silently skipped.

**The #1 thing to get right:** a caller job that invokes a reusable workflow needing
write scopes **must declare a `permissions:` block** — the default `GITHUB_TOKEN` is
read-only and the run otherwise fails at startup with zero jobs. The caller's grant
must cover **every** scope the reusable workflow's jobs declare, or the run fails at
startup. `build-docker` needs `contents: read` + `packages: write` +
`id-token: write` (the last for keyless image signing); `codeql` needs
`security-events: write`; `release-please` needs `contents: write` +
`pull-requests: write`; `hermes.yml` needs only `contents: read`. See the `s3ntin3l8/.github` README for the full table.

## Commands (Makefile)

| Command | Does |
|---------|------|
| `make install` | Install dependencies (`npm ci`). |
| `make install-hooks` | Install pre-commit + pre-push hooks. |
| `make dev` | Start the API with reload (`tsx watch`). The desk has its own `npm run dev:web`. |
| `make test` | Run the Vitest suite. |
| `make test-coverage` | Run tests with coverage (`vitest run --coverage`). |
| `make lint` | Run ESLint. |
| `make typecheck` | Type-check the server and the desk (`tsc --noEmit`). |
| `make build` | Production build: server to `dist/`, desk to `web/dist/`. |
| `make clean` | Remove `node_modules`, `dist`, and caches. |

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
  Product routes: `listings` (ingest/upsert, list, detail, PATCH notes/status) and `assumptions`
  (GET/PUT financing assumptions). Both are guarded by `src/auth/guard.ts`. `root` serves the built desk.
- **Domain** (`src/domain/`): `ingest` (normalizes extension payloads), `analyze` (costs, financing,
  energy, flags, score), `compare` (cohort medians, rent-versus-buy), `reference` (states, postal
  codes, city benchmarks), `assumptions`, `types`.
- **DB** (`src/db/`): Drizzle schema/client/seed; SQL migrations in `drizzle/`.
  `getDb()`/`ensureDb()`/`closeDb()` manage a singleton connection.
- **Desk** (`web/`): React + Vite. `web/src/api.ts` mirrors the server response types by hand.
- **Extension** (`extension/`): MV3, loaded unpacked. `extract.js` parses the open exposé and `popup.js` POSTs it.
- `Dockerfile` — multi-stage build → non-root runtime (built/pushed by CI).
- `.github/workflows/` — thin callers of the reusable workflows in `s3ntin3l8/.github`.
- `.claude/` — `settings.json` + `hooks/session-start.sh`: a SessionStart hook that
  installs deps and tooling so
  [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web)
  sessions can build, test, and lint. Runs only in the remote env.

## Key invariants

The full list, with reasons, is in `.claude/skills/duomogrid/SKILL.md`. Read it before changing
`src/`, `web/`, `extension/` or `drizzle/`. The ones most often broken:

- Each route plugin that serves user data calls `installIngestGuard(app, prefix)` itself. The hook is encapsulated, and an empty token means 503.
- Rentals are never scored. For `offer: "rent"`, `priceEur` is the cold rent.
- A listing's price is its newest `observations` row. `listings` has no price column.
- Unknown amounts stay `null` in analysis. They are never coerced to `0`.
- Extension field aliases (`listingKind`, `hausgeldEur`, `provisionPercent`, `rentedOut`) stay accepted by `parseIngest`.
- `web/src/api.ts` must be updated by hand whenever the `present()`/`Analysis` shape changes. Typecheck won't catch drift.
- Existing migrations are never edited or renamed (note the two `0003_*` files at idx 2 and 3).

## Conventions

- **ESM throughout** (`"type": "module"`); imports use `.js` specifiers even for `.ts`
  sources (Node16 resolution). Prefer `import type` for type-only imports (enforced by
  ESLint).
- Tests live in `test/`, mirroring `src/`, and use `app.inject()`. `test/setup.ts`
  gives each test file an isolated temp SQLite DB.
- Config is read from `app.config` (typed via the `declare module "fastify"`
  augmentation in `src/plugins/env.ts`) — not `process.env` directly.
- After changing `src/db/schema.ts`, run `npm run db:generate` and commit the
  generated migration.
- **Secrets:** never commit real credentials; `detect-secrets` runs in pre-commit and
  CI against `.secrets.baseline` (regenerate with
  `detect-secrets scan > .secrets.baseline` after vetting new detections).

## Documentation map

- `README.md` — run instructions, the extension, and what is not built yet.
- `AGENTS.md` (this file) — the live contract for how the repo is wired: layout, invariants,
  CI/CD conventions. Keep it in sync with the code, not with what the code used to do.
- `.claude/skills/duomogrid/SKILL.md` — correctness invariants; `.claude/agents/duomogrid-reviewer.md` applies them in review.
- `.agents/skills/duomogrid/` — a byte-identical copy of the skill for agent CLIs that read `.agents/` instead of `.claude/`. Edit both together; `npm run lint` (`check:skill-mirror`) fails when they differ.
- `CONTRIBUTING.md` — one-time repository setup (coverage floor, sharding, review and Codecov secrets).
