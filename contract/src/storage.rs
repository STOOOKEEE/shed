//! Storage that callers prepay in NEAR, so activity cannot drain the contract's balance.
//! Budgets are upper bounds checked by `tests/storage_tests.rs` against the worst case
//! (largest skin SVG, 64-character account ids).

use near_sdk::{NearToken, Promise, env, require};

/// A skin: NFT owner + enumeration entries, NEP-177 metadata with the base64 SVG, skin record.
/// Prepaid by the first sculptor of a cycle.
pub const SKIN_STORAGE_BYTES: u64 = 7_000;
/// A `(cycle, account)` contribution entry plus one journal entry. Prepaid by each new
/// sculptor of a cycle.
pub const CONTRIBUTION_STORAGE_BYTES: u64 = 400;
/// An `airdrop_claimed` entry plus one journal entry.
pub const AIRDROP_CLAIM_STORAGE_BYTES: u64 = 400;
/// Minimum attached deposit: forces a full-access-key confirmation, like `ft_transfer`.
pub const MIN_DEPOSIT_YOCTO: u128 = 1;

pub fn bytes_cost(bytes: u64) -> u128 {
    env::storage_byte_cost().as_yoctonear() * u128::from(bytes)
}

/// Requires at least `required` yoctoNEAR attached and refunds the excess to the caller.
pub fn take_deposit(required: u128) {
    let required = required.max(MIN_DEPOSIT_YOCTO);
    let attached = env::attached_deposit().as_yoctonear();
    require!(
        attached >= required,
        format!("Attach at least {required} yoctoNEAR (storage prepayment)")
    );
    let excess = attached - required;
    if excess > 0 {
        Promise::new(env::predecessor_account_id())
            .transfer(NearToken::from_yoctonear(excess))
            .detach();
    }
}
