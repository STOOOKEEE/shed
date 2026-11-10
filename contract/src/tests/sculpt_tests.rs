use near_contract_standards::fungible_token::FungibleTokenCore;
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_sdk::json_types::U128;

use super::*;
use crate::journal::JournalKind;
use crate::render::render_svg;
use crate::slots::Slot;

const FUNDS: u128 = 10_000;

fn funded(name: &str) -> (Molt, AccountId) {
    let mut contract = new_contract();
    let who = account(name);
    fund(&mut contract, &who, FUNDS, GENESIS);
    (contract, who)
}

fn transform(contract: &mut Molt, who: &AccountId, now: u64, slot: Slot, variant: u8) -> u128 {
    sculpt(contract, who, now, slot, variant)
}

#[test]
fn transform_burns_the_price_and_changes_the_mascot() {
    let (mut contract, alice) = funded("alice");
    let paid = transform(&mut contract, &alice, GENESIS + 1, Slot::Shell, 2);
    assert_eq!(paid, BASE_PRICE);
    assert_eq!(balance(&contract, &alice), FUNDS - BASE_PRICE);
    assert_eq!(contract.ft_total_supply(), U128(SUPPLY - BASE_PRICE));
    let mascot = contract.mascot();
    assert_eq!(mascot.genome.shell, 2);
    assert_eq!(mascot.svg, render_svg(&mascot.genome));
    assert_eq!(contract.stats().burned_by_transform, U128(BASE_PRICE));
}

#[test]
fn changing_the_same_slot_again_costs_more() {
    let (mut contract, alice) = funded("alice");
    transform(&mut contract, &alice, GENESIS + 1, Slot::Eyes, 1);
    assert_eq!(contract.mascot().slot_prices.eyes, U128(150));
    assert_eq!(
        transform(&mut contract, &alice, GENESIS + 2, Slot::Eyes, 2),
        150
    );
    assert_eq!(
        transform(&mut contract, &alice, GENESIS + 3, Slot::Eyes, 3),
        225
    );
    assert_eq!(contract.mascot().slot_changes.eyes, 3);
}

#[test]
fn other_slots_keep_the_base_price() {
    let (mut contract, alice) = funded("alice");
    transform(&mut contract, &alice, GENESIS + 1, Slot::Eyes, 1);
    assert_eq!(
        transform(&mut contract, &alice, GENESIS + 2, Slot::Claws, 1),
        BASE_PRICE
    );
}

#[test]
fn prices_reset_when_a_new_cycle_starts() {
    let (mut contract, alice) = funded("alice");
    transform(&mut contract, &alice, GENESIS + 1, Slot::Eyes, 1);
    transform(&mut contract, &alice, GENESIS + 2, Slot::Eyes, 2);
    assert_eq!(
        transform(&mut contract, &alice, GENESIS + CYCLE, Slot::Eyes, 3),
        BASE_PRICE
    );
    assert_eq!(contract.mascot().cycle, 2);
}

#[test]
#[should_panic(expected = "Attach at least")]
fn transform_requires_a_deposit() {
    let (mut contract, alice) = funded("alice");
    call_as(&alice, GENESIS + 1, 0);
    contract.transform(Slot::Shell, 1);
}

#[test]
#[should_panic(expected = "Unknown variant")]
fn transform_rejects_unknown_variants() {
    let (mut contract, alice) = funded("alice");
    transform(&mut contract, &alice, GENESIS + 1, Slot::Claws, 200);
}

#[test]
#[should_panic(expected = "The mascot already wears this variant")]
fn transform_rejects_the_current_variant() {
    let (mut contract, alice) = funded("alice");
    transform(&mut contract, &alice, GENESIS + 1, Slot::Claws, 0);
}

#[test]
#[should_panic(expected = "The account doesn't have enough balance")]
fn transform_requires_enough_tokens() {
    let mut contract = new_contract();
    let poor = account("poor");
    fund(&mut contract, &poor, BASE_PRICE - 1, GENESIS);
    transform(&mut contract, &poor, GENESIS + 1, Slot::Shell, 1);
}

#[test]
fn contributions_track_burns_per_cycle() {
    let (mut contract, alice) = funded("alice");
    transform(&mut contract, &alice, GENESIS + 1, Slot::Eyes, 1);
    transform(&mut contract, &alice, GENESIS + 2, Slot::Eyes, 2);
    assert_eq!(contract.contribution(1, alice.clone()), U128(250));
    let top = contract.mascot().top_sculptor.unwrap();
    assert_eq!((top.account_id, top.burned), (alice, U128(250)));
}

#[test]
fn mascot_view_flags_a_pending_molt() {
    let (mut contract, alice) = funded("alice");
    transform(&mut contract, &alice, GENESIS + 1, Slot::Shell, 3);
    call_as(&alice, GENESIS + CYCLE + 5, 0);
    let mascot = contract.mascot();
    assert!(mascot.molt_pending);
    assert_eq!(mascot.cycle, 2);
    assert_eq!(mascot.slot_prices.shell, U128(BASE_PRICE));
    assert_eq!(mascot.cycle_ends_at_ns.0, GENESIS + 2 * CYCLE);
}

#[test]
fn cycle_end_freezes_the_look_into_a_skin_held_in_auction() {
    let (mut contract, alice) = funded("alice");
    transform(&mut contract, &alice, GENESIS + 1, Slot::Headgear, 4);
    let molt_time = GENESIS + CYCLE + 5;
    call_as(&alice, molt_time, 0);
    assert!(contract.molt());

    let skin = contract.skin(1).unwrap();
    assert_eq!(skin.cycle, 1);
    assert_eq!(skin.genome.headgear, 4);
    assert_eq!(skin.owner_id, contract_id());
    assert_eq!(skin.auction.ends_at_ns.0, molt_time + AUCTION);
    assert!(!skin.auction.settled);
    assert_eq!(contract.auctions().len(), 1);

    let token = contract.nft_token("1".to_string()).unwrap();
    let media = token.metadata.unwrap().media.unwrap();
    assert!(media.starts_with("data:image/svg+xml;base64,"));
}

#[test]
fn the_next_cycle_starts_from_the_last_look() {
    let (mut contract, alice) = funded("alice");
    transform(&mut contract, &alice, GENESIS + 1, Slot::Headgear, 4);
    call_as(&alice, GENESIS + CYCLE + 5, 0);
    contract.molt();
    assert_eq!(contract.mascot().genome.headgear, 4);
}

#[test]
fn a_quiet_cycle_mints_no_skin() {
    let mut contract = new_contract();
    call_as(&holder(), GENESIS + 3 * CYCLE, 0);
    assert!(contract.molt());
    assert_eq!(contract.stats().skins_minted, 0);
    assert!(contract.skin(1).is_none());
    call_as(&holder(), GENESIS + 3 * CYCLE + 1, 0);
    assert!(!contract.molt());
}

#[test]
fn molt_is_triggered_by_any_later_transform() {
    let (mut contract, alice) = funded("alice");
    transform(&mut contract, &alice, GENESIS + 1, Slot::Shell, 1);
    transform(&mut contract, &alice, GENESIS + CYCLE + 1, Slot::Shell, 2);
    assert_eq!(contract.skin(1).unwrap().genome.shell, 1);
    assert_eq!(contract.mascot().genome.shell, 2);
}

#[test]
fn preview_swaps_a_single_trait() {
    let contract = new_contract();
    let mut expected = contract.mascot().genome;
    expected.eyes = 4;
    assert_eq!(contract.preview_svg(Slot::Eyes, 4), render_svg(&expected));
}

#[test]
fn catalog_lists_every_slot_with_names() {
    let contract = new_contract();
    let catalog = contract.catalog();
    assert_eq!(catalog.len(), Slot::ALL.len());
    assert_eq!(catalog[0].slot, Slot::Background);
    assert_eq!(catalog[5].variants[4], "Chef Hat");
}

#[test]
fn journal_records_transforms_and_molts_newest_first() {
    let (mut contract, alice) = funded("alice");
    transform(&mut contract, &alice, GENESIS + 1, Slot::Shell, 1);
    call_as(&alice, GENESIS + CYCLE, 0);
    contract.molt();
    let kinds: Vec<JournalKind> = contract.journal(10).iter().map(|e| e.kind).collect();
    assert_eq!(kinds, vec![JournalKind::Molt, JournalKind::Transform]);
    let transform_entry = &contract.journal(10)[1];
    assert_eq!(transform_entry.account_id, Some(alice));
    assert_eq!(transform_entry.burned, U128(BASE_PRICE));
    assert_eq!(transform_entry.slot, Some(Slot::Shell));
}
