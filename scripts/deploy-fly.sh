#!/usr/bin/env bash
# Deploy all three services to Fly.io.
# Run after `fly auth login` and `fly auth signup` (if needed) succeed.
#
# Requires these environment variables set in your shell:
#   STELLAR_ORACLE_SECRET   - admin Stellar secret (from `stellar keys secret arena-admin`)
#   ORACLE_SIGNING_SECRET   - 32-byte hex Ed25519 oracle key
#   GEMINI_API_KEY          - Google AI Studio key
#   GROQ_API_KEY            - Groq cloud key
#   OPENROUTER_API_KEY      - OpenRouter key (for Nemotron model)
#   LIVE_ROUND_CONTRACT_ID  - deployed contract ID
#
# All three apps share a generated prefix so they're easy to find:
#   neh-oracle.fly.dev
#   neh-runner.fly.dev
#   neh-web.fly.dev

set -e

: "${ORACLE_STELLAR_SECRET:?ORACLE_STELLAR_SECRET is required}"
: "${ORACLE_SIGNING_SECRET:?ORACLE_SIGNING_SECRET is required}"
: "${GEMINI_API_KEY:?GEMINI_API_KEY is required}"
: "${GROQ_API_KEY:?GROQ_API_KEY is required}"
: "${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is required}"
: "${LIVE_ROUND_CONTRACT_ID:?LIVE_ROUND_CONTRACT_ID is required}"

REGION="${FLY_REGION:-ord}"
PREFIX="${FLY_APP_PREFIX:-neh}"

ORACLE_APP="${PREFIX}-oracle"
RUNNER_APP="${PREFIX}-runner"
WEB_APP="${PREFIX}-web"

ORACLE_URL="https://${ORACLE_APP}.fly.dev"
RUNNER_URL="https://${RUNNER_APP}.fly.dev"

# 1. ORACLE
echo "=== oracle: $ORACLE_APP ==="
fly apps create "$ORACLE_APP" 2>/dev/null || echo "(app exists)"
fly volumes create oracle_data --app "$ORACLE_APP" --region "$REGION" --size 1 --yes 2>/dev/null || echo "(volume exists)"
fly secrets set --app "$ORACLE_APP" \
  ORACLE_STELLAR_SECRET="$ORACLE_STELLAR_SECRET" \
  ORACLE_SIGNING_SECRET="$ORACLE_SIGNING_SECRET" \
  GEMINI_API_KEY="$GEMINI_API_KEY" \
  GROQ_API_KEY="$GROQ_API_KEY" \
  LIVE_ROUND_CONTRACT_ID="$LIVE_ROUND_CONTRACT_ID" \
  RUNNER_URL="$RUNNER_URL"
fly deploy services/oracle --app "$ORACLE_APP" --config services/oracle/fly.toml --dockerfile services/oracle/Dockerfile --remote-only --ha=false

# 2. RUNNER
echo "=== runner: $RUNNER_APP ==="
fly apps create "$RUNNER_APP" 2>/dev/null || echo "(app exists)"
fly volumes create runner_data --app "$RUNNER_APP" --region "$REGION" --size 1 --yes 2>/dev/null || echo "(volume exists)"
fly secrets set --app "$RUNNER_APP" \
  GEMINI_API_KEY="$GEMINI_API_KEY" \
  GROQ_API_KEY="$GROQ_API_KEY" \
  OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  LIVE_ROUND_CONTRACT_ID="$LIVE_ROUND_CONTRACT_ID" \
  ORACLE_URL="$ORACLE_URL"
fly deploy services/runner --app "$RUNNER_APP" --config services/runner/fly.toml --dockerfile services/runner/Dockerfile --remote-only --ha=false

# 3. WEB (must build with public env vars baked in)
echo "=== web: $WEB_APP ==="
fly apps create "$WEB_APP" 2>/dev/null || echo "(app exists)"
fly deploy apps/web --app "$WEB_APP" --config apps/web/fly.toml --dockerfile apps/web/Dockerfile --remote-only --ha=false \
  --build-arg NEXT_PUBLIC_ORACLE_URL="$ORACLE_URL" \
  --build-arg NEXT_PUBLIC_RUNNER_URL="$RUNNER_URL" \
  --build-arg NEXT_PUBLIC_LIVE_ROUND_CONTRACT_ID="$LIVE_ROUND_CONTRACT_ID"

echo ""
echo "=== done ==="
echo "  oracle:  $ORACLE_URL"
echo "  runner:  $RUNNER_URL"
echo "  web:     https://${WEB_APP}.fly.dev"
