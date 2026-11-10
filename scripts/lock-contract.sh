#!/usr/bin/env bash
# Deletes every access key of the contract account, so nobody (including the deployer) can ever
# redeploy code or act as the contract again. IRREVERSIBLE.
#
# Usage: scripts/lock-contract.sh <contract-account.testnet>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <contract-account.testnet>" >&2
  exit 1
fi
CONTRACT="$1"

KEYS=$(near account list-keys "$CONTRACT" network-config testnet now 2>&1 | grep -oE 'ed25519:[1-9A-HJ-NP-Za-km-z]+' || true)
if [[ -z "$KEYS" ]]; then
  echo "No access key found on $CONTRACT: already locked." >&2
  exit 0
fi

echo "Keys on $CONTRACT:"
echo "$KEYS"
read -r -p "Delete them all? This cannot be undone. Type the account id to confirm: " CONFIRM
if [[ "$CONFIRM" != "$CONTRACT" ]]; then
  echo "Aborted." >&2
  exit 1
fi

near account delete-keys "$CONTRACT" public-keys "$(echo "$KEYS" | paste -sd, -)" \
  network-config testnet sign-with-keychain send
echo "Locked. Verify: near account list-keys $CONTRACT network-config testnet now"
