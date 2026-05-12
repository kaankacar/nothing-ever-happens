#!/usr/bin/env bash
# Spin up oracle + runner + web in three foreground panes (use tmux/iterm/etc).
# This script is a convenience for the smoke test; in production each service
# runs independently.
set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ] && [ ! -f .env.local ]; then
  echo "Copy .env.example to .env and fill in values first."
  exit 1
fi

echo "Starting oracle …"
(cd services/oracle && pnpm dev) &
ORACLE_PID=$!

echo "Starting runner …"
(cd services/runner && pnpm dev) &
RUNNER_PID=$!

echo "Starting web …"
(cd apps/web && pnpm dev)

kill $ORACLE_PID $RUNNER_PID 2>/dev/null || true
