//! Guards found in review: the contract account cannot play, bidders cannot dodge refunds,
//! raising your own bid only escrows the difference.

use near_contract_standards::storage_management::StorageManagement;
use near_sdk::json_types::U128;

use super::*;
use crate::slots::Slot;

const FUNDS: u128 = 10_000;

/// Alice sculpts cycle 1; at `GENESIS + CYCLE` skin 1 goes to auction. Bob and Carol are funded.
fn auction_open() -> (Molt, AccountId, AccountId) {
    let mut contract = new_contract();
    let (alice, bob, carol) = (account("alice"), account("bob"), account("carol"));
    for who in [&alice, &bob, &carol] {
        fund(&mut contract, who, FUNDS, GENESIS);
    }
    sculpt(&mut contract, &alice, GENESIS + 1, Slot::Shell, 1);
    call_as(&alice, GENESIS + CYCLE, 0);
    contract.molt();
    (contract, bob, carol)
}

#[test]
#[should_panic(expected = "The contract account cannot sculpt")]
fn the_contract_account_cannot_sculpt() {
    let mut contract = new_contract();
    call_as(
        &contract_id(),
        GENESIS + 1,
        1_000_000_000_000_000_000_000_000,
    );
    contract.transform(Slot::Shell, 1);
}

#[test]
#[should_panic(expected = "The contract account cannot bid")]
fn the_contract_account_cannot_bid() {
    let (mut contract, _, _) = auction_open();
    call_as(&contract_id(), GENESIS + CYCLE + 1, 1);
    contract.bid(1, U128(MIN_BID));
}

#[test]
#[should_panic(expected = "The contract account cannot unregister")]
fn the_contract_account_cannot_unregister() {
    let mut contract = new_contract();
    call_as(&contract_id(), GENESIS + 1, 1);
    contract.storage_unregister(Some(true));
}

#[test]
#[should_panic(expected = "Highest bidders cannot unregister")]
fn the_highest_bidder_cannot_unregister() {
    let (mut contract, bob, _) = auction_open();
    call_as(&bob, GENESIS + CYCLE + 1, 1);
    contract.bid(1, U128(FUNDS));
    call_as(&bob, GENESIS + CYCLE + 2, 1);
    contract.storage_unregister(None);
}

#[test]
fn an_outbid_account_can_unregister() {
    let (mut contract, bob, carol) = auction_open();
    call_as(&bob, GENESIS + CYCLE + 1, 1);
    contract.bid(1, U128(MIN_BID));
    call_as(&carol, GENESIS + CYCLE + 2, 1);
    contract.bid(1, U128(FUNDS));
    assert_eq!(balance(&contract, &bob), FUNDS);
    call_as(&bob, GENESIS + CYCLE + 3, 1);
    assert!(contract.storage_unregister(Some(true)));
}

#[test]
fn raising_your_own_bid_escrows_only_the_difference() {
    let (mut contract, bob, _) = auction_open();
    call_as(&bob, GENESIS + CYCLE + 1, 1);
    contract.bid(1, U128(6_000));
    call_as(&bob, GENESIS + CYCLE + 2, 1);
    contract.bid(1, U128(FUNDS));
    assert_eq!(balance(&contract, &bob), 0);
    assert_eq!(
        contract.skin(1).unwrap().auction.highest_bid,
        Some(U128(FUNDS))
    );
}

#[test]
fn molt_is_pending_only_when_a_skin_is_due() {
    let mut contract = new_contract();
    call_as(&holder(), GENESIS + 2 * CYCLE, 0);
    assert!(!contract.mascot().molt_pending);
    let alice = account("alice");
    fund(&mut contract, &alice, FUNDS, GENESIS + 2 * CYCLE);
    sculpt(
        &mut contract,
        &alice,
        GENESIS + 2 * CYCLE + 1,
        Slot::Eyes,
        2,
    );
    call_as(&holder(), GENESIS + 3 * CYCLE, 0);
    assert!(contract.mascot().molt_pending);
}
