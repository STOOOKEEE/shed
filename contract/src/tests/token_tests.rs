use near_contract_standards::fungible_token::FungibleTokenCore;
use near_contract_standards::fungible_token::metadata::FungibleTokenMetadataProvider;
use near_contract_standards::storage_management::StorageManagement;
use near_sdk::json_types::U128;

use super::*;
use crate::config::tests::valid_config;

#[test]
fn launch_mints_the_whole_supply_once() {
    let contract = new_contract();
    assert_eq!(contract.ft_total_supply(), U128(SUPPLY));
    assert_eq!(balance(&contract, &holder()), SUPPLY - AIRDROP_POOL);
    assert_eq!(balance(&contract, &contract_id()), AIRDROP_POOL);
}

#[test]
#[should_panic(expected = "total_supply must be positive")]
fn launch_rejects_invalid_parameters() {
    let mut config = valid_config();
    config.total_supply = U128(0);
    call_as(&contract_id(), GENESIS, 0);
    let _ = Molt::new(config);
}

#[test]
fn config_view_exposes_parameters_and_genesis() {
    let contract = new_contract();
    let view = contract.config();
    assert_eq!(view.config, valid_config());
    assert_eq!(view.genesis_ns.0, GENESIS);
}

#[test]
fn token_metadata_is_molt_with_18_decimals() {
    let contract = new_contract();
    let metadata = contract.ft_metadata();
    assert_eq!(metadata.symbol, "MOLT");
    assert_eq!(metadata.decimals, 18);
}

#[test]
fn airdrop_pays_a_registered_account_once() {
    let mut contract = new_contract();
    let alice = account("alice");
    fund(&mut contract, &alice, 1, GENESIS);
    call_as(&alice, GENESIS, contract.airdrop_deposit().0);
    assert_eq!(contract.claim_airdrop(), U128(AIRDROP));
    assert_eq!(balance(&contract, &alice), 1 + AIRDROP);
    assert!(contract.airdrop_claimed(alice.clone()));
    assert_eq!(
        contract.stats().airdrop_remaining,
        U128(AIRDROP_POOL - AIRDROP)
    );
}

#[test]
#[should_panic(expected = "Airdrop already claimed")]
fn airdrop_cannot_be_claimed_twice() {
    let mut contract = new_contract();
    let alice = account("alice");
    fund(&mut contract, &alice, 1, GENESIS);
    call_as(&alice, GENESIS, contract.airdrop_deposit().0);
    contract.claim_airdrop();
    contract.claim_airdrop();
}

#[test]
#[should_panic(expected = "Register storage first")]
fn airdrop_requires_storage_registration() {
    let mut contract = new_contract();
    call_as(&account("stranger"), GENESIS, 0);
    contract.claim_airdrop();
}

#[test]
fn storage_deposit_then_claim_works_for_a_new_account() {
    let mut contract = new_contract();
    let bob = account("bob");
    let deposit = contract.storage_balance_bounds().min;
    call_as(&bob, GENESIS, deposit.as_yoctonear());
    contract.storage_deposit(None, Some(true));
    call_as(&bob, GENESIS, contract.airdrop_deposit().0);
    contract.claim_airdrop();
    assert_eq!(balance(&contract, &bob), AIRDROP);
}
