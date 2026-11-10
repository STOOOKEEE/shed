#!/usr/bin/env python3
"""End-to-end smoke test of a live MOLT deployment on NEAR testnet.

Plays a full round with two funded testnet accounts whose keys are in the system keychain
(near-cli-rs `save-to-keychain`): airdrop, sculpting (face mint/burn), a molt, two bids,
settlement and a sculptor claim. Every step is checked against the contract views.

Usage: scripts/smoke_testnet.py <contract.testnet> <player1.testnet> <player2.testnet>
Needs: python3 (stdlib only), near-cli-rs. Signs real testnet transactions.
"""

import base64
import json
import subprocess
import sys
import time
import urllib.request

RPC_URL = "https://test.rpc.fastnear.com"
GAS = "300.0 Tgas"
ONE_YOCTO = 1
POLL_SECONDS = 10


def view(contract, method, args=None):
    params = {
        "request_type": "call_function",
        "finality": "optimistic",
        "account_id": contract,
        "method_name": method,
        "args_base64": base64.b64encode(json.dumps(args or {}).encode()).decode(),
    }
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "query", "params": params}).encode()
    request = urllib.request.Request(RPC_URL, data=body, headers={"Content-Type": "application/json"})
    response = json.load(urllib.request.urlopen(request))
    result = response.get("result", {})
    if "error" in response or "error" in result:
        raise RuntimeError(f"view {method} failed: {response}")
    return json.loads(bytes(result["result"]))


def call(contract, signer, method, args, deposit_yocto, expect_failure=False):
    command = [
        "near", "contract", "call-function", "as-transaction", contract, method,
        "json-args", json.dumps(args), "prepaid-gas", GAS,
        "attached-deposit", f"{deposit_yocto} yoctoNEAR",
        "sign-as", signer, "network-config", "testnet", "sign-with-keychain", "send",
    ]
    done = subprocess.run(command, capture_output=True, text=True)
    failed = done.returncode != 0 or "Failure" in done.stdout + done.stderr
    if failed != expect_failure:
        raise RuntimeError(f"{signer} → {method} {'should have failed' if expect_failure else 'failed'}:\n"
                           f"{done.stdout[-1500:]}\n{done.stderr[-1500:]}")
    print(f"  ✓ {signer} → {method}{' (rejected as expected)' if expect_failure else ''}")


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    print(f"  ✓ {message}")


def wait_for_cycle(contract, target):
    while view(contract, "mascot")["cycle"] < target:
        time.sleep(POLL_SECONDS)


def wait_until_auction_ended(contract, skin_id):
    ends_at_ns = int(view(contract, "skin", {"skin_id": skin_id})["auction"]["ends_at_ns"])
    while True:
        block = json.load(urllib.request.urlopen(urllib.request.Request(
            RPC_URL,
            data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "block",
                             "params": {"finality": "final"}}).encode(),
            headers={"Content-Type": "application/json"})))
        if int(block["result"]["header"]["timestamp_nanosec"]) > ends_at_ns:
            return
        time.sleep(POLL_SECONDS)


def balance(contract, account):
    return int(view(contract, "ft_balance_of", {"account_id": account}))


def sculpt(contract, who, slot, variant):
    deposit = int(view(contract, "transform_deposit", {"account_id": who}))
    call(contract, who, "transform", {"slot": slot, "variant": variant}, deposit)


def main(contract, p1, p2):
    config = view(contract, "config")
    airdrop = int(config["airdrop_amount"])
    base_price = int(config["base_transform_price"])

    print("1. Onboarding (storage + airdrop)")
    storage = int(view(contract, "storage_balance_bounds")["min"])
    for who in (p1, p2):
        if view(contract, "storage_balance_of", {"account_id": who}) is None:
            call(contract, who, "storage_deposit", {"registration_only": True}, storage)
        if not view(contract, "airdrop_claimed", {"account_id": who}):
            call(contract, who, "claim_airdrop", {}, int(view(contract, "airdrop_deposit")))
        check(balance(contract, who) >= airdrop, f"{who} holds the airdrop")

    print("2. Sculpting, faces minted and burned")
    start_cycle = view(contract, "mascot")["cycle"]
    faces_before = view(contract, "mascot")["face"]
    supply_before = int(view(contract, "ft_total_supply"))
    p1_before = balance(contract, p1)
    sculpt(contract, p1, "headgear", 1)
    first_face = view(contract, "mascot")["face"]
    check(first_face["owner_id"] == p1, f"{p1} holds the live face {first_face['token_id']}")
    if faces_before:
        check(view(contract, "nft_token", {"token_id": faces_before["token_id"]}) is None,
              f"previous face {faces_before['token_id']} burned")
    sculpt(contract, p2, "eyes", 4)
    second_face = view(contract, "mascot")["face"]
    check(second_face["owner_id"] == p2, f"{p2} now holds {second_face['token_id']}")
    check(view(contract, "nft_token", {"token_id": first_face["token_id"]}) is None,
          f"{first_face['token_id']} burned by the next change")
    call(contract, p2, "nft_transfer", {"receiver_id": p1, "token_id": second_face["token_id"]},
         ONE_YOCTO, expect_failure=True)
    check(balance(contract, p1) == p1_before - base_price, f"{p1} paid the base price")
    check(int(view(contract, "ft_total_supply")) == supply_before - 2 * base_price,
          "both prices were burned")

    print("3. Molt (waiting for the cycle to end)")
    wait_for_cycle(contract, start_cycle + 1)
    skins_before = view(contract, "stats")["skins_minted"]
    call(contract, p1, "molt", {}, 0)
    skin_id = view(contract, "stats")["skins_minted"]
    check(skin_id == skins_before + 1, f"skin #{skin_id} minted")
    skin = view(contract, "skin", {"skin_id": skin_id})
    check(skin["genome"]["headgear"] == 1 and skin["genome"]["eyes"] == 4, "skin keeps the cycle's look")
    check(skin["owner_id"] == contract, "skin held by the contract during its auction")

    print("4. Auction")
    minimum = int(skin["auction"]["min_next_bid"])
    p1_before = balance(contract, p1)
    call(contract, p1, "bid", {"skin_id": skin_id, "amount": str(minimum)}, ONE_YOCTO)
    check(balance(contract, p1) == p1_before - minimum, f"{p1}'s bid escrowed")
    raised = int(view(contract, "skin", {"skin_id": skin_id})["auction"]["min_next_bid"])
    call(contract, p2, "bid", {"skin_id": skin_id, "amount": str(raised)}, ONE_YOCTO)
    check(balance(contract, p1) == p1_before, f"{p1} refunded when outbid")

    print("5. Settlement (waiting for the auction to end)")
    wait_until_auction_ended(contract, skin_id)
    burned_before = int(view(contract, "stats")["burned_by_auction"])
    call(contract, p1, "molt", {}, 0)
    skin = view(contract, "skin", {"skin_id": skin_id})
    check(skin["owner_id"] == p2 and skin["auction"]["settled"], f"skin #{skin_id} handed to {p2}")
    check(int(view(contract, "stats")["burned_by_auction"]) == burned_before + raised // 2,
          "half of the winning bid burned")

    print("6. Sculptor claims")
    for who in (p1, p2):
        share = int(view(contract, "sculptor_claimable", {"skin_id": skin_id, "account_id": who}))
        before = balance(contract, who)
        call(contract, who, "claim_sculptor_share", {"skin_id": skin_id}, 0)
        check(balance(contract, who) == before + share, f"{who} received {share} yocto-MOLT")

    print("\nAll checks passed.")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
