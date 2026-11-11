//! $SHED fungible token: NEP-141 core, NEP-145 storage, NEP-148 metadata, plus the internal
//! movements the mechanic needs (burn, escrow, payout).

use near_contract_standards::fungible_token::events::FtBurn;
use near_contract_standards::fungible_token::metadata::{
    FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::{FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{AccountId, NearToken, PromiseOrValue, env, log, near, require};

use crate::{Shed, ShedExt};
use shed_art::svg_data_uri;

pub const DECIMALS: u8 = 18;
const ICON_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="#0b1a33"/><ellipse cx="16" cy="19" rx="8" ry="9" fill="#e63946"/><circle cx="12" cy="9" r="3" fill="#fff"/><circle cx="20" cy="9" r="3" fill="#fff"/><circle cx="12" cy="9" r="1.3"/><circle cx="20" cy="9" r="1.3"/></svg>"##;

impl Shed {
    /// Destroys `amount` of `account`'s tokens and lowers the total supply.
    pub(crate) fn burn(&mut self, account: &AccountId, amount: u128, memo: &str) {
        if amount == 0 {
            return;
        }
        self.token.internal_withdraw(account, amount);
        FtBurn {
            owner_id: account,
            amount: U128(amount),
            memo: Some(memo),
        }
        .emit();
    }

    /// Moves tokens from `from` into the contract's own balance (bids escrow).
    pub(crate) fn escrow(&mut self, from: &AccountId, amount: u128, memo: &str) {
        let contract_id = env::current_account_id();
        self.token
            .internal_transfer(from, &contract_id, amount, Some(memo.to_string()));
    }

    /// Pays `amount` from the contract's balance. Recipients are always registered: claimers
    /// are checked, and highest bidders cannot unregister while their bid is escrowed.
    pub(crate) fn pay_out(&mut self, to: &AccountId, amount: u128, memo: &str) {
        if amount == 0 {
            return;
        }
        let contract_id = env::current_account_id();
        self.token
            .internal_transfer(&contract_id, to, amount, Some(memo.to_string()));
    }

    pub(crate) fn is_registered(&self, account: &AccountId) -> bool {
        self.token.accounts.contains_key(account)
    }
}

#[near]
impl FungibleTokenCore for Shed {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Shed {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, burned) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned > 0 {
            log!("Account @{} burned {} on refund", sender_id, burned);
        }
        used.into()
    }
}

#[near]
impl StorageManagement for Shed {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    /// With `force`, the remaining balance is burned (NEP-145 behaviour). Refused for the
    /// contract account and for highest bidders, so escrow refunds always have a recipient.
    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        let caller = env::predecessor_account_id();
        require!(
            caller != env::current_account_id(),
            "The contract account cannot unregister"
        );
        require!(
            !self.is_highest_bidder(&caller),
            "Highest bidders cannot unregister while their bid is escrowed"
        );
        match self.token.internal_storage_unregister(force) {
            Some((account_id, balance)) => {
                if balance > 0 {
                    FtBurn {
                        owner_id: &account_id,
                        amount: U128(balance),
                        memo: Some("unregister"),
                    }
                    .emit();
                }
                true
            }
            None => false,
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Shed {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "SHED".to_string(),
            symbol: "SHED".to_string(),
            icon: Some(svg_data_uri(ICON_SVG)),
            reference: None,
            reference_hash: None,
            decimals: DECIMALS,
        }
    }
}
