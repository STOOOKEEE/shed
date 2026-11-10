//! Unit tests of the contract behaviour with a mocked blockchain.

mod auction_tests;
mod face_tests;
mod guard_tests;
mod sculpt_tests;
mod storage_tests;
mod token_tests;

use near_contract_standards::fungible_token::FungibleTokenCore;
use near_contract_standards::storage_management::StorageManagement;
use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, testing_env};

use crate::Molt;
pub(crate) use crate::config::tests::{
    AIRDROP, AIRDROP_POOL, ANTI_SNIPE, AUCTION, BASE_PRICE, CYCLE, MIN_BID, SUPPLY, valid_config,
};

pub(crate) const GENESIS: u64 = 1_000_000;

pub(crate) fn account(name: &str) -> AccountId {
    format!("{name}.near").parse().unwrap()
}

pub(crate) fn contract_id() -> AccountId {
    account("molt")
}

pub(crate) fn holder() -> AccountId {
    account("holder")
}

/// Sets the next call's caller, time and attached deposit.
pub(crate) fn call_as(caller: &AccountId, now_ns: u64, deposit_yocto: u128) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(contract_id())
            .predecessor_account_id(caller.clone())
            .signer_account_id(caller.clone())
            .block_timestamp(now_ns)
            .attached_deposit(NearToken::from_yoctonear(deposit_yocto))
            .account_balance(NearToken::from_near(1_000))
            .build()
    );
}

pub(crate) fn new_contract() -> Molt {
    call_as(&contract_id(), GENESIS, 0);
    Molt::new(valid_config())
}

/// Registers `who` and sends them `amount` from the initial holder.
pub(crate) fn fund(contract: &mut Molt, who: &AccountId, amount: u128, now_ns: u64) {
    let deposit = contract.storage_balance_bounds().min;
    call_as(who, now_ns, deposit.as_yoctonear());
    contract.storage_deposit(None, Some(true));
    call_as(&holder(), now_ns, 1);
    contract.ft_transfer(who.clone(), U128(amount), None);
}

pub(crate) fn balance(contract: &Molt, who: &AccountId) -> u128 {
    contract.ft_balance_of(who.clone()).0
}

/// `transform` as `who` at `now_ns`, attaching exactly the deposit the contract asks for.
pub(crate) fn sculpt(
    contract: &mut Molt,
    who: &AccountId,
    now_ns: u64,
    slot: crate::slots::Slot,
    variant: u8,
) -> u128 {
    call_as(who, now_ns, 0);
    let deposit = contract.transform_deposit(who.clone()).0;
    call_as(who, now_ns, deposit);
    contract.transform(slot, variant).0
}
