#!/bin/bash
set -euo pipefail

# Only run in Claude Code on the web (remote) sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Install dependencies so linters and tests are ready.
# npm ci, like CI and the Dockerfile: it installs exactly what package-lock.json
# pins and never rewrites it, so a session doesn't start with a dirty lockfile.
npm ci
