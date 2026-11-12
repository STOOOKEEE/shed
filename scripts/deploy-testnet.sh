#!/usr/bin/env bash
# Deploys SHED to NEAR testnet: the main contract on <contract> and the Exuviae burn collection
# on the sub-account exuviae.<contract> (only the main contract can mint there).
#
# Usage: scripts/deploy-testnet.sh <contract.testnet> <initial-holder.testnet> [--create]
#   --create   create <contract.testnet> first, funded by the testnet faucet (key saved in the
#              system keychain by near-cli-rs).
#   SHED_CYCLE_SECONDS=180 scripts/deploy-testnet.sh …   shorter cycles for a test deployment.
#
# After checking the deployment, lock both accounts (irreversible):
#   scripts/lock-contract.sh <contract.testnet> exuviae.<contract.testnet>
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <contract.testnet> <initial-holder.testnet> [--create]" >&2
  exit 1
fi
CONTRACT="$1"
HOLDER="$2"
CREATE="${3:-}"
EXUVIAE="exuviae.${CONTRACT}"
# Storage of the 206 kB Exuviae wasm (~2.1 NEAR) plus room for its first mints.
EXUVIAE_BALANCE="3 NEAR"

SHED="000000000000000000" # 18 decimals
CYCLE_SECONDS="${SHED_CYCLE_SECONDS:-600}"
NANOS_PER_SECOND=1000000000
CYCLE_NS=$((CYCLE_SECONDS * NANOS_PER_SECOND))
ANTI_SNIPE_NS=$((CYCLE_NS / 4))

CONFIG=$(cat <<JSON
{
  "config": {
    "initial_holder": "${HOLDER}",
    "total_supply": "1000000000${SHED}",
    "airdrop_pool": "100000000${SHED}",
    "airdrop_amount": "100000${SHED}",
    "cycle_duration_ns": "${CYCLE_NS}",
    "auction_duration_ns": "${CYCLE_NS}",
    "anti_snipe_ns": "${ANTI_SNIPE_NS}",
    "base_transform_price": "10000${SHED}",
    "price_growth_bps": 15000,
    "min_bid": "5000${SHED}",
    "min_bid_increment_bps": 500,
    "auction_burn_bps": 5000
  },
  "exuviae_contract": "${EXUVIAE}"
}
JSON
)

if [[ "$CREATE" == "--create" ]]; then
  near account create-account sponsor-by-faucet-service "$CONTRACT" \
    autogenerate-new-keypair save-to-keychain network-config testnet create
fi

# Build with cargo-near (ABI step skipped: its dylib loader fails on recent macOS), deploy with
# near-cli-rs, the tool that saved the keys in the keychain.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$ROOT/contract" && cargo near build non-reproducible-wasm --no-abi)
(cd "$ROOT/contract/exuviae" && cargo near build non-reproducible-wasm --no-abi)

near contract deploy "$CONTRACT" use-file "$ROOT/contract/target/near/shed.wasm" \
  with-init-call new json-args "$CONFIG" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-keychain send

near account create-account fund-myself "$EXUVIAE" "$EXUVIAE_BALANCE" \
  autogenerate-new-keypair save-to-keychain sign-as "$CONTRACT" \
  network-config testnet sign-with-keychain send

near contract deploy "$EXUVIAE" use-file "$ROOT/contract/exuviae/target/near/shed_exuviae.wasm" \
  with-init-call exuviae_new json-args "{\"minter\": \"${CONTRACT}\"}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-keychain send

echo "Deployed $CONTRACT and $EXUVIAE."
echo "Check: near contract call-function as-read-only $CONTRACT config json-args '{}' network-config testnet now"
