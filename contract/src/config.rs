//! Launch parameters. Set once by `new`, never writable afterwards.

use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, near};

use crate::pricing::BPS_DENOMINATOR;

/// Hard ceiling on slot price growth (×10 per change) so prices stay meaningful.
pub const MAX_PRICE_GROWTH_BPS: u32 = 10 * BPS_DENOMINATOR;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct ShedConfig {
    /// Receives `total_supply - airdrop_pool` at launch.
    pub initial_holder: AccountId,
    pub total_supply: U128,
    /// Tokens kept by the contract for `claim_airdrop`.
    pub airdrop_pool: U128,
    /// Tokens given once to each claiming account.
    pub airdrop_amount: U128,
    pub cycle_duration_ns: U64,
    pub auction_duration_ns: U64,
    /// A bid placed less than this before the end pushes the end to `now + anti_snipe_ns`.
    pub anti_snipe_ns: U64,
    /// Burn price of the first change of a slot in a cycle.
    pub base_transform_price: U128,
    /// Multiplier applied per previous change of the same slot in the cycle (15000 = ×1.5).
    pub price_growth_bps: u32,
    pub min_bid: U128,
    pub min_bid_increment_bps: u32,
    /// Share of the winning bid that is burned; the rest goes to the cycle's sculptors.
    pub auction_burn_bps: u32,
}

impl ShedConfig {
    /// Checks the parameters are coherent. `contract_id` must not be the initial holder:
    /// the contract's own balance holds escrowed bids, pools and the airdrop.
    pub fn validate(&self, contract_id: &AccountId) -> Result<(), &'static str> {
        let checks: [(bool, &'static str); 11] = [
            (self.total_supply.0 > 0, "total_supply must be positive"),
            (
                self.airdrop_pool.0 <= self.total_supply.0,
                "airdrop_pool exceeds total_supply",
            ),
            (
                self.airdrop_amount.0 <= self.airdrop_pool.0,
                "airdrop_amount exceeds airdrop_pool",
            ),
            (
                (self.airdrop_pool.0 == 0) == (self.airdrop_amount.0 == 0),
                "airdrop_pool and airdrop_amount must be both zero or both positive",
            ),
            (
                self.cycle_duration_ns.0 > 0,
                "cycle_duration_ns must be positive",
            ),
            (
                self.auction_duration_ns.0 > 0,
                "auction_duration_ns must be positive",
            ),
            (
                self.anti_snipe_ns.0 <= self.auction_duration_ns.0,
                "anti_snipe_ns exceeds auction_duration_ns",
            ),
            (
                self.base_transform_price.0 > 0,
                "base_transform_price must be positive",
            ),
            (
                (BPS_DENOMINATOR..=MAX_PRICE_GROWTH_BPS).contains(&self.price_growth_bps),
                "price_growth_bps must be between 10000 and 100000",
            ),
            (self.min_bid.0 > 0, "min_bid must be positive"),
            (
                self.auction_burn_bps <= BPS_DENOMINATOR,
                "auction_burn_bps exceeds 10000",
            ),
        ];
        if let Some((_, error)) = checks.iter().find(|(ok, _)| !ok) {
            return Err(error);
        }
        if &self.initial_holder == contract_id {
            return Err("initial_holder cannot be the contract itself");
        }
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) const SUPPLY: u128 = 1_000_000;
    pub(crate) const AIRDROP_POOL: u128 = 100_000;
    pub(crate) const AIRDROP: u128 = 1_000;
    pub(crate) const CYCLE: u64 = 1_000;
    pub(crate) const AUCTION: u64 = 1_000;
    pub(crate) const ANTI_SNIPE: u64 = 100;
    pub(crate) const BASE_PRICE: u128 = 100;
    pub(crate) const MIN_BID: u128 = 50;

    pub(crate) fn valid_config() -> ShedConfig {
        ShedConfig {
            initial_holder: "holder.near".parse().unwrap(),
            total_supply: U128(SUPPLY),
            airdrop_pool: U128(AIRDROP_POOL),
            airdrop_amount: U128(AIRDROP),
            cycle_duration_ns: U64(CYCLE),
            auction_duration_ns: U64(AUCTION),
            anti_snipe_ns: U64(ANTI_SNIPE),
            base_transform_price: U128(BASE_PRICE),
            price_growth_bps: 15_000,
            min_bid: U128(MIN_BID),
            min_bid_increment_bps: 500,
            auction_burn_bps: 5_000,
        }
    }

    fn contract() -> AccountId {
        "shed.near".parse().unwrap()
    }

    fn rejected(change: impl FnOnce(&mut ShedConfig)) -> Result<(), &'static str> {
        let mut config = valid_config();
        change(&mut config);
        config.validate(&contract())
    }

    #[test]
    fn valid_config_is_accepted() {
        assert_eq!(valid_config().validate(&contract()), Ok(()));
    }

    #[test]
    fn zero_supply_is_rejected() {
        assert!(rejected(|c| c.total_supply = U128(0)).is_err());
    }

    #[test]
    fn airdrop_pool_larger_than_supply_is_rejected() {
        assert!(rejected(|c| c.airdrop_pool = U128(2_000_000)).is_err());
    }

    #[test]
    fn airdrop_amount_larger_than_pool_is_rejected() {
        assert!(rejected(|c| c.airdrop_amount = U128(200_000)).is_err());
    }

    #[test]
    fn airdrop_pool_without_amount_is_rejected() {
        assert!(rejected(|c| c.airdrop_amount = U128(0)).is_err());
    }

    #[test]
    fn disabled_airdrop_is_accepted() {
        let result = rejected(|c| {
            c.airdrop_pool = U128(0);
            c.airdrop_amount = U128(0);
        });
        assert_eq!(result, Ok(()));
    }

    #[test]
    fn zero_durations_are_rejected() {
        assert!(rejected(|c| c.cycle_duration_ns = U64(0)).is_err());
        assert!(rejected(|c| c.auction_duration_ns = U64(0)).is_err());
    }

    #[test]
    fn anti_snipe_longer_than_auction_is_rejected() {
        assert!(rejected(|c| c.anti_snipe_ns = U64(2_000)).is_err());
    }

    #[test]
    fn free_transformations_are_rejected() {
        assert!(rejected(|c| c.base_transform_price = U128(0)).is_err());
    }

    #[test]
    fn price_growth_outside_bounds_is_rejected() {
        assert!(rejected(|c| c.price_growth_bps = 9_999).is_err());
        assert!(rejected(|c| c.price_growth_bps = MAX_PRICE_GROWTH_BPS + 1).is_err());
    }

    #[test]
    fn zero_min_bid_is_rejected() {
        assert!(rejected(|c| c.min_bid = U128(0)).is_err());
    }

    #[test]
    fn burn_share_above_100_percent_is_rejected() {
        assert!(rejected(|c| c.auction_burn_bps = 10_001).is_err());
    }

    #[test]
    fn contract_as_initial_holder_is_rejected() {
        assert!(rejected(|c| c.initial_holder = contract()).is_err());
    }
}
