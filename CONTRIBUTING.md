<!-- mullion:moved:start -->
## Repository setup

Agent-facing repo rules (layout, commands, CI scope grants, invariants) live in [`AGENTS.md`](AGENTS.md).

One-time settings carried over from `node-backend-template`. Revisit them when changing CI coverage or sharding, or when review/coverage uploads are silently skipped.

- Decide your CI coverage floor: `ci-cd.yml` ships `test-script: "test:coverage"`;
  the reusable `ci-node` defaults `coverage-fail-under: '0'` (a starter floor) —
  **ratchet it up** as you add real code. Test sharding is shipped off; enable it
  via the commented `test-shards` lines in `ci-cd.yml` (the `json` coverage reporter
  that shard merging needs is already set in `vitest.config.ts`).
- Set the Hermes review secrets `HERMES_APP_ID`, `HERMES_APP_PRIVATE_KEY` and
  `HERMES_API_KEY` — as repo secrets **and** under Settings → Secrets → Dependabot
  (a Dependabot-authored run sees only the latter). Without them `hermes.yml` skips
  with a notice. Keep Settings → Actions → General → "Require approval for all outside
  collaborators" on: the reviewer runs on a self-hosted runner.

> **Codecov TODO:** coverage upload requires a `CODECOV_TOKEN` repo secret and the
> repo onboarded on [codecov.io](https://about.codecov.io/) before results/badges
> show. The workflow runs the upload unconditionally; it just no-ops without the token.
<!-- mullion:moved:end -->
