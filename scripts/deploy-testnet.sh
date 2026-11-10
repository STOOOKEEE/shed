#!/usr/bin/env bash
# Deploys MOLT to NEAR testnet with the demo parameters (10-minute cycles by default).
#
# Usage: scripts/deploy-testnet.sh <contract-account.testnet> <initial-holder.testnet> [--create]
#   --create   create <contract-account.testnet> first, funded by the testnet faucet
#              (its key is saved in your system keychain by near-cli-rs).
#   MOLT_CYCLE_SECONDS=180 scripts/deploy-testnet.sh …   shorter cycles for a test deployment.
# After checking the deployment, lock the contract (irreversible) with:
#   scripts/lock-contract.sh <contract-account.testnet>
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <contract-account.testnet> <initial-holder.testnet> [--create]" >&2
  exit 1
fi
CONTRACT="$1"
HOLDER="$2"
CREATE="${3:-}"

MOLT="000000000000000000" # 18 decimals
CYCLE_SECONDS="${MOLT_CYCLE_SECONDS:-600}"
NANOS_PER_SECOND=1000000000
CYCLE_NS=$((CYCLE_SECONDS * NANOS_PER_SECOND))
ANTI_SNIPE_NS=$((CYCLE_NS / 4))

CONFIG=$(cat <<JSON
{
  "config": {
    "initial_holder": "${HOLDER}",
    "total_supply": "1000000000${MOLT}",
    "airdrop_pool": "100000000${MOLT}",
    "airdrop_amount": "100000${MOLT}",
    "cycle_duration_ns": "${CYCLE_NS}",
    "auction_duration_ns": "${CYCLE_NS}",
    "anti_snipe_ns": "${ANTI_SNIPE_NS}",
    "base_transform_price": "10000${MOLT}",
    "price_growth_bps": 15000,
    "min_bid": "5000${MOLT}",
    "min_bid_increment_bps": 500,
    "auction_burn_bps": 5000
  }
}
JSON
)

if [[ "$CREATE" == "--create" ]]; then
  near account create-account sponsor-by-faucet-service "$CONTRACT" \
    autogenerate-new-keypair save-to-keychain network-config testnet create
fi

# Build with cargo-near, deploy with near-cli-rs: the same tool that saved the key in the keychain.
cd "$(dirname "$0")/../contract"
cargo near build non-reproducible-wasm
near contract deploy "$CONTRACT" use-file target/near/molt.wasm \
  with-init-call new json-args "$CONFIG" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-keychain send

echo "Deployed. Check it: near contract call-function as-read-only $CONTRACT config json-args '{}' network-config testnet now"
