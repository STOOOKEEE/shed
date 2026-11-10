//! Callers prepay the storage they create, so the contract's NEAR balance cannot be drained.

use near_sdk::env;
use near_sdk::json_types::U128;

use super::*;
use crate::slots::{Genome, Slot};
use crate::storage::{CONTRIBUTION_STORAGE_BYTES, SKIN_STORAGE_BYTES, bytes_cost};

/// A 64-character account id: the longest NEAR allows, the worst case for storage.
fn longest_account() -> AccountId {
    format!("{}.near", "a".repeat(59)).parse().unwrap()
}

#[test]
fn first_change_of_a_cycle_prepays_the_skin_and_the_contribution() {
    let contract = new_contract();
    call_as(&account("alice"), GENESIS + 1, 0);
    let expected = bytes_cost(SKIN_STORAGE_BYTES + CONTRIBUTION_STORAGE_BYTES);
    assert_eq!(contract.transform_deposit(account("alice")).0, expected);
}

#[test]
fn a_new_sculptor_later_in_the_cycle_prepays_only_the_contribution() {
    let mut contract = new_contract();
    let (alice, bob) = (account("alice"), account("bob"));
    fund(&mut contract, &alice, 10_000, GENESIS);
    sculpt(&mut contract, &alice, GENESIS + 1, Slot::Shell, 1);
    call_as(&bob, GENESIS + 2, 0);
    assert_eq!(
        contract.transform_deposit(bob).0,
        bytes_cost(CONTRIBUTION_STORAGE_BYTES)
    );
}

#[test]
fn a_returning_sculptor_only_attaches_one_yocto() {
    let mut contract = new_contract();
    let alice = account("alice");
    fund(&mut contract, &alice, 10_000, GENESIS);
    sculpt(&mut contract, &alice, GENESIS + 1, Slot::Shell, 1);
    call_as(&alice, GENESIS + 2, 0);
    assert_eq!(contract.transform_deposit(alice).0, 1);
}

#[test]
fn a_pending_molt_means_the_next_change_opens_a_new_skin() {
    let mut contract = new_contract();
    let alice = account("alice");
    fund(&mut contract, &alice, 10_000, GENESIS);
    sculpt(&mut contract, &alice, GENESIS + 1, Slot::Shell, 1);
    call_as(&alice, GENESIS + CYCLE, 0);
    let expected = bytes_cost(SKIN_STORAGE_BYTES + CONTRIBUTION_STORAGE_BYTES);
    assert_eq!(contract.transform_deposit(alice).0, expected);
}

#[test]
#[should_panic(expected = "Attach at least")]
fn an_underfunded_first_change_is_rejected() {
    let mut contract = new_contract();
    let alice = account("alice");
    fund(&mut contract, &alice, 10_000, GENESIS);
    call_as(&alice, GENESIS + 1, bytes_cost(CONTRIBUTION_STORAGE_BYTES));
    contract.transform(Slot::Shell, 1);
}

/// Mint, a bid and the settlement to a new owner, all with 64-character account ids.
#[test]
fn the_skin_budget_covers_the_largest_skin_for_its_whole_life() {
    let mut contract = new_contract();
    let sculptor = longest_account();
    let bidder: AccountId = format!("{}.near", "b".repeat(59)).parse().unwrap();
    fund(&mut contract, &sculptor, 100_000, GENESIS);
    fund(&mut contract, &bidder, 100_000, GENESIS);
    let largest = Genome::from_fn(|slot| slot.variant_count() - 1);
    for slot in Slot::ALL {
        let variant = *largest.get(slot);
        if variant != 0 {
            sculpt(&mut contract, &sculptor, GENESIS + 1, slot, variant);
        }
    }
    let before = env::storage_usage();
    call_as(&sculptor, GENESIS + CYCLE, 0);
    contract.molt();
    call_as(&bidder, GENESIS + CYCLE + 1, 1);
    contract.bid(1, U128(MIN_BID));
    call_as(&bidder, GENESIS + CYCLE + AUCTION, 0);
    contract.molt();
    assert_eq!(contract.skin(1).unwrap().owner_id, bidder);
    let used = env::storage_usage().saturating_sub(before);
    assert!(used <= SKIN_STORAGE_BYTES, "a skin used {used} bytes");
}

/// Covers the `(cycle, account)` contribution entry plus one journal entry.
#[test]
fn the_contribution_budget_covers_the_longest_account() {
    let mut contract = new_contract();
    let first = account("alice");
    let longest = longest_account();
    fund(&mut contract, &first, 100_000, GENESIS);
    fund(&mut contract, &longest, 100_000, GENESIS);
    sculpt(&mut contract, &first, GENESIS + 1, Slot::Shell, 1);
    let before = env::storage_usage();
    sculpt(&mut contract, &longest, GENESIS + 2, Slot::Eyes, 1);
    let used = env::storage_usage().saturating_sub(before);
    assert!(
        used <= CONTRIBUTION_STORAGE_BYTES,
        "a contribution used {used} bytes"
    );
}

#[test]
#[should_panic(expected = "Attach at least")]
fn airdrop_claims_prepay_their_storage() {
    let mut contract = new_contract();
    let alice = account("alice");
    fund(&mut contract, &alice, 1, GENESIS);
    call_as(&alice, GENESIS, 0);
    contract.claim_airdrop();
}
