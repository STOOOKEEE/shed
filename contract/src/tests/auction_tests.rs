use near_contract_standards::fungible_token::FungibleTokenCore;
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_sdk::json_types::U128;

use super::*;
use crate::journal::JournalKind;
use crate::slots::Slot;

const FUNDS: u128 = 10_000;
/// When the first skin is minted in these scenarios.
const SHED_TIME: u64 = GENESIS + CYCLE;
const AUCTION_END: u64 = SHED_TIME + AUCTION;

struct Scene {
    contract: Shed,
    alice: AccountId,
    bob: AccountId,
    carol: AccountId,
}

/// Alice burns 300 and Bob 100 during cycle 1, then the cycle closes into skin 1.
fn scene() -> Scene {
    let mut contract = new_contract();
    let (alice, bob, carol) = (account("alice"), account("bob"), account("carol"));
    for who in [&alice, &bob, &carol] {
        fund(&mut contract, who, FUNDS, GENESIS);
    }
    sculpt(&mut contract, &alice, GENESIS + 1, Slot::Shell, 1);
    sculpt(&mut contract, &alice, GENESIS + 2, Slot::Eyes, 1);
    sculpt(&mut contract, &alice, GENESIS + 3, Slot::Claws, 1);
    sculpt(&mut contract, &bob, GENESIS + 4, Slot::Pattern, 1);
    call_as(&bob, SHED_TIME, 0);
    contract.shed();
    Scene {
        contract,
        alice,
        bob,
        carol,
    }
}

fn bid(contract: &mut Shed, who: &AccountId, now: u64, amount: u128) {
    call_as(who, now, 1);
    contract.bid(1, U128(amount));
}

fn settle_at(contract: &mut Shed, now: u64) {
    call_as(&account("keeper"), now, 0);
    contract.shed();
}

#[test]
fn bid_escrows_tokens_in_the_contract() {
    let mut s = scene();
    let escrow_before = balance(&s.contract, &contract_id());
    bid(&mut s.contract, &s.carol, SHED_TIME + 1, 500);
    assert_eq!(balance(&s.contract, &s.carol), FUNDS - 500);
    assert_eq!(balance(&s.contract, &contract_id()), escrow_before + 500);
    let auction = s.contract.skin(1).unwrap().auction;
    assert_eq!(auction.highest_bidder, Some(s.carol.clone()));
    assert_eq!(auction.highest_bid, Some(U128(500)));
    assert_eq!(auction.min_next_bid, U128(525));
}

#[test]
fn outbid_tokens_are_refunded_immediately() {
    let mut s = scene();
    bid(&mut s.contract, &s.carol, SHED_TIME + 1, 500);
    bid(&mut s.contract, &s.bob, SHED_TIME + 2, 525);
    assert_eq!(balance(&s.contract, &s.carol), FUNDS);
}

#[test]
#[should_panic(expected = "Bid too low")]
fn first_bid_must_reach_the_minimum() {
    let mut s = scene();
    bid(&mut s.contract, &s.carol, SHED_TIME + 1, MIN_BID - 1);
}

#[test]
#[should_panic(expected = "Bid too low")]
fn next_bid_must_beat_the_increment() {
    let mut s = scene();
    bid(&mut s.contract, &s.carol, SHED_TIME + 1, 500);
    bid(&mut s.contract, &s.bob, SHED_TIME + 2, 524);
}

#[test]
#[should_panic(expected = "Auction is closed")]
fn bids_after_the_end_are_rejected() {
    let mut s = scene();
    bid(&mut s.contract, &s.carol, AUCTION_END, 500);
}

#[test]
#[should_panic(expected = "Unknown skin")]
fn bids_on_unknown_skins_are_rejected() {
    let mut s = scene();
    call_as(&s.carol, SHED_TIME + 1, 1);
    s.contract.bid(9, U128(500));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn bid_requires_one_yocto() {
    let mut s = scene();
    call_as(&s.carol, SHED_TIME + 1, 0);
    s.contract.bid(1, U128(500));
}

#[test]
fn a_late_bid_extends_the_auction() {
    let mut s = scene();
    let late = AUCTION_END - ANTI_SNIPE / 2;
    bid(&mut s.contract, &s.carol, late, 500);
    assert_eq!(
        s.contract.skin(1).unwrap().auction.ends_at_ns.0,
        late + ANTI_SNIPE
    );
}

#[test]
fn settlement_hands_the_skin_to_the_winner_and_burns_half() {
    let mut s = scene();
    bid(&mut s.contract, &s.carol, SHED_TIME + 1, 1_000);
    let supply_before = s.contract.ft_total_supply().0;
    settle_at(&mut s.contract, AUCTION_END);
    let skin = s.contract.skin(1).unwrap();
    assert!(skin.auction.settled);
    assert_eq!(skin.owner_id, s.carol);
    assert_eq!(s.contract.ft_total_supply().0, supply_before - 500);
    assert_eq!(s.contract.stats().burned_by_auction, U128(500));
    assert!(s.contract.auctions().is_empty());
    let entry = &s.contract.journal(1)[0];
    assert_eq!((entry.kind, entry.burned), (JournalKind::Settle, U128(500)));
}

#[test]
fn sculptors_share_the_rest_pro_rata() {
    let mut s = scene();
    bid(&mut s.contract, &s.carol, SHED_TIME + 1, 1_000);
    settle_at(&mut s.contract, AUCTION_END);
    assert_eq!(s.contract.sculptor_claimable(1, s.alice.clone()), U128(375));
    call_as(&s.alice, AUCTION_END + 1, 0);
    assert_eq!(s.contract.claim_sculptor_share(1), U128(375));
    call_as(&s.bob, AUCTION_END + 1, 0);
    assert_eq!(s.contract.claim_sculptor_share(1), U128(125));
    assert_eq!(balance(&s.contract, &s.alice), FUNDS - 300 + 375);
    assert_eq!(s.contract.sculptor_claimable(1, s.alice.clone()), U128(0));
}

#[test]
#[should_panic(expected = "Nothing to claim")]
fn a_share_cannot_be_claimed_twice() {
    let mut s = scene();
    bid(&mut s.contract, &s.carol, SHED_TIME + 1, 1_000);
    settle_at(&mut s.contract, AUCTION_END);
    call_as(&s.alice, AUCTION_END + 1, 0);
    s.contract.claim_sculptor_share(1);
    s.contract.claim_sculptor_share(1);
}

#[test]
#[should_panic(expected = "Nothing to claim")]
fn non_sculptors_have_nothing_to_claim() {
    let mut s = scene();
    bid(&mut s.contract, &s.carol, SHED_TIME + 1, 1_000);
    settle_at(&mut s.contract, AUCTION_END);
    call_as(&s.carol, AUCTION_END + 1, 0);
    s.contract.claim_sculptor_share(1);
}

#[test]
#[should_panic(expected = "Auction not settled yet")]
fn shares_wait_for_settlement() {
    let mut s = scene();
    call_as(&s.alice, SHED_TIME + 1, 0);
    s.contract.claim_sculptor_share(1);
}

#[test]
fn without_bids_the_skin_goes_to_the_top_sculptor() {
    let mut s = scene();
    let supply_before = s.contract.ft_total_supply().0;
    settle_at(&mut s.contract, AUCTION_END);
    assert_eq!(s.contract.skin(1).unwrap().owner_id, s.alice);
    assert_eq!(s.contract.ft_total_supply().0, supply_before);
    let token = s.contract.nft_token("1".to_string()).unwrap();
    assert_eq!(token.owner_id, s.alice);
}
