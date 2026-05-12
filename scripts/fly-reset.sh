#!/usr/bin/env bash
# Full reset of the Fly.io deployment:
#   1. Deploy a fresh Soroban contract (next_rid = 1 again)
#   2. Wipe oracle SQLite + runner agent secrets via fly ssh
#   3. Update LIVE_ROUND_CONTRACT_ID secret on oracle + runner (auto-restarts)
#   4. Redeploy oracle + runner with latest source
#   5. Rebuild web with the new contract baked into NEXT_PUBLIC_*
#
# Requires a local .env with the oracle Stellar admin secret + LLM keys,
# and `arena-admin` configured in the stellar CLI.

set -e

cd "$(dirname "$0")/.."

# Pick up flyctl from its install location if not on PATH already.
export PATH="$HOME/.fly/bin:$PATH"
export STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

ORACLE_APP="${ORACLE_APP:-neh-oracle}"
RUNNER_APP="${RUNNER_APP:-neh-runner}"
WEB_APP="${WEB_APP:-neh-web}"

echo "=== 1. deploying fresh contract ==="
WASM_HASH=$(stellar contract upload \
  --wasm contracts/target/wasm32v1-none/release/live_round.wasm \
  --source arena-admin --network testnet 2>&1 | grep -E '^[0-9a-f]{64}$' | tail -1)
[ -n "$WASM_HASH" ] || { echo "wasm upload failed"; exit 1; }
CONTRACT=$(stellar contract deploy \
  --wasm-hash "$WASM_HASH" --source arena-admin --network testnet 2>&1 \
  | grep -E '^C[A-Z0-9]{55}$' | tail -1)
[ -n "$CONTRACT" ] || { echo "contract deploy failed"; exit 1; }
ADMIN=$(stellar keys address arena-admin)
ORACLE_PK=$(grep -E "^ORACLE_PUBKEY=|^ORACLE_SIGNING_PUBKEY=" .env 2>/dev/null | cut -d= -f2- | head -1)
[ -z "$ORACLE_PK" ] && ORACLE_PK="96320c2f34436462c30290b0df015639d3ab6f356aeacb45d6ae0bb658262dea"
stellar contract invoke --id "$CONTRACT" --source arena-admin --network testnet -- \
  init --admin "$ADMIN" \
  --oracle_pk "$ORACLE_PK" \
  --rep_pool 1000 --top_n 3 > /dev/null
echo "new contract: $CONTRACT"

echo ""
echo "=== 2. wiping volumes ==="
fly ssh console --app "$ORACLE_APP" -C "sh -c 'rm -f /data/arena.db /data/arena.db-shm /data/arena.db-wal'"
fly ssh console --app "$RUNNER_APP" -C "sh -c 'rm -f /data/runner.json'"

echo ""
echo "=== 3. updating contract ID secret on both ==="
fly secrets set --app "$ORACLE_APP" LIVE_ROUND_CONTRACT_ID="$CONTRACT" 2>&1 | tail -2
fly secrets set --app "$RUNNER_APP" LIVE_ROUND_CONTRACT_ID="$CONTRACT" 2>&1 | tail -2

echo ""
echo "=== 4. redeploying oracle + runner with latest source ==="
fly deploy . --app "$ORACLE_APP" \
  --config services/oracle/fly.toml \
  --dockerfile services/oracle/Dockerfile \
  --remote-only --ha=false --yes 2>&1 | tail -3
fly deploy . --app "$RUNNER_APP" \
  --config services/runner/fly.toml \
  --dockerfile services/runner/Dockerfile \
  --remote-only --ha=false --yes 2>&1 | tail -3

echo ""
echo "=== 5. rebuilding web with new contract baked in ==="
fly deploy . --app "$WEB_APP" \
  --config apps/web/fly.toml \
  --dockerfile apps/web/Dockerfile \
  --remote-only --ha=false --yes \
  --build-arg NEXT_PUBLIC_ORACLE_URL="https://${ORACLE_APP}.fly.dev" \
  --build-arg NEXT_PUBLIC_RUNNER_URL="https://${RUNNER_APP}.fly.dev" \
  --build-arg NEXT_PUBLIC_LIVE_ROUND_CONTRACT_ID="$CONTRACT" 2>&1 | tail -3

echo ""
echo "=== local .env update (optional, for parity with deployment) ==="
for f in .env services/oracle/.env services/runner/.env apps/web/.env.local; do
  if [ -f "$f" ]; then
    grep -v "^LIVE_ROUND_CONTRACT_ID=\|^NEXT_PUBLIC_LIVE_ROUND_CONTRACT_ID=" "$f" > "$f.tmp"
    echo "LIVE_ROUND_CONTRACT_ID=$CONTRACT" >> "$f.tmp"
    echo "NEXT_PUBLIC_LIVE_ROUND_CONTRACT_ID=$CONTRACT" >> "$f.tmp"
    mv "$f.tmp" "$f"
  fi
done
echo "done — contract: $CONTRACT"
echo "live at: https://${WEB_APP}.fly.dev"
