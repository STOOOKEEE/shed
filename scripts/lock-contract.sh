#!/usr/bin/env bash
# Deletes every access key of the given contract accounts, so nobody (including the deployer)
# can ever redeploy code or act as the contracts again. IRREVERSIBLE.
#
# Usage: scripts/lock-contract.sh <contract.testnet> [exuviae.<contract.testnet>]
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <contract.testnet> [more accounts…]" >&2
  exit 1
fi

for ACCOUNT in "$@"; do
  KEYS=$(near account list-keys "$ACCOUNT" network-config testnet now 2>&1 \
    | grep -oE 'ed25519:[1-9A-HJ-NP-Za-km-z]+' || true)
  if [[ -z "$KEYS" ]]; then
    echo "No access key on $ACCOUNT: already locked."
    continue
  fi
  echo "Keys on $ACCOUNT:"
  echo "$KEYS"
  read -r -p "Delete them all? This cannot be undone. Type the account id to confirm: " CONFIRM
  if [[ "$CONFIRM" != "$ACCOUNT" ]]; then
    echo "Skipped $ACCOUNT." >&2
    continue
  fi
  near account delete-keys "$ACCOUNT" public-keys "$(echo "$KEYS" | paste -sd, -)" \
    network-config testnet sign-with-keychain send
  echo "Locked $ACCOUNT. Verify: near account list-keys $ACCOUNT network-config testnet now"
done
