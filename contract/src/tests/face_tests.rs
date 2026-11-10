//! The "face": one live NFT of the current mascot, held by whoever changed it last and burned
//! as soon as someone changes it again.

use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_sdk::json_types::U128;
use near_sdk::test_utils::get_logs;

use super::*;
use crate::render::{render_svg, svg_data_uri};
use crate::slots::Slot;

const FUNDS: u128 = 10_000;

fn two_sculptors() -> (Molt, AccountId, AccountId) {
    let mut contract = new_contract();
    let (alice, bob) = (account("alice"), account("bob"));
    fund(&mut contract, &alice, FUNDS, GENESIS);
    fund(&mut contract, &bob, FUNDS, GENESIS);
    (contract, alice, bob)
}

#[test]
fn a_transform_mints_the_face_to_the_sculptor() {
    let (mut contract, alice, _) = two_sculptors();
    sculpt(&mut contract, &alice, GENESIS + 1, Slot::Headgear, 1);
    let face = contract.nft_token("face-1".to_string()).unwrap();
    assert_eq!(face.owner_id, alice);
    assert_eq!(contract.mascot().face.unwrap().owner_id, alice);
}

#[test]
fn the_face_shows_the_live_mascot() {
    let (mut contract, alice, _) = two_sculptors();
    sculpt(&mut contract, &alice, GENESIS + 1, Slot::Headgear, 1);
    let media = contract
        .nft_token("face-1".to_string())
        .unwrap()
        .metadata
        .unwrap()
        .media;
    assert_eq!(
        media,
        Some(svg_data_uri(&render_svg(&contract.mascot().genome)))
    );
}

#[test]
fn the_next_transform_burns_the_previous_face() {
    let (mut contract, alice, bob) = two_sculptors();
    sculpt(&mut contract, &alice, GENESIS + 1, Slot::Headgear, 1);
    sculpt(&mut contract, &bob, GENESIS + 2, Slot::Eyes, 4);
    assert!(contract.nft_token("face-1".to_string()).is_none());
    assert_eq!(
        contract.nft_token("face-2".to_string()).unwrap().owner_id,
        bob
    );
    assert_eq!(contract.nft_supply_for_owner(alice), U128(0));
    assert!(
        get_logs()
            .iter()
            .any(|log| log.contains(r#""event":"nft_burn""#))
    );
}

#[test]
fn changing_your_own_look_again_replaces_your_face() {
    let (mut contract, alice, _) = two_sculptors();
    sculpt(&mut contract, &alice, GENESIS + 1, Slot::Headgear, 1);
    sculpt(&mut contract, &alice, GENESIS + 2, Slot::Headgear, 2);
    assert!(contract.nft_token("face-1".to_string()).is_none());
    assert_eq!(contract.nft_supply_for_owner(alice), U128(1));
}

#[test]
fn only_one_face_ever_exists() {
    let (mut contract, alice, bob) = two_sculptors();
    for (step, who) in [&alice, &bob, &alice, &bob].into_iter().enumerate() {
        sculpt(
            &mut contract,
            who,
            GENESIS + 1 + step as u64,
            Slot::Shell,
            step as u8 + 1,
        );
    }
    let faces = contract
        .nft_tokens(None, None)
        .into_iter()
        .filter(|token| token.token_id.starts_with("face-"))
        .count();
    assert_eq!(faces, 1);
}

#[test]
fn the_face_survives_a_molt() {
    let (mut contract, alice, _) = two_sculptors();
    sculpt(&mut contract, &alice, GENESIS + 1, Slot::Headgear, 1);
    call_as(&alice, GENESIS + CYCLE, 0);
    contract.molt();
    assert_eq!(
        contract.nft_token("face-1".to_string()).unwrap().owner_id,
        alice
    );
    assert_eq!(contract.skin(1).unwrap().genome.headgear, 1);
}

#[test]
#[should_panic(expected = "The face cannot be transferred")]
fn the_face_cannot_be_transferred() {
    let (mut contract, alice, bob) = two_sculptors();
    sculpt(&mut contract, &alice, GENESIS + 1, Slot::Headgear, 1);
    call_as(&alice, GENESIS + 2, 1);
    contract.nft_transfer(bob, "face-1".to_string(), None, None);
}

#[test]
#[should_panic(expected = "The face cannot be transferred")]
fn the_face_cannot_be_approved_for_sale() {
    let (mut contract, alice, bob) = two_sculptors();
    sculpt(&mut contract, &alice, GENESIS + 1, Slot::Headgear, 1);
    call_as(&alice, GENESIS + 2, 1_000_000_000_000_000_000_000);
    contract.nft_approve("face-1".to_string(), bob, None);
}
