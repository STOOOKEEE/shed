//! Pure arithmetic of the mechanic: slot prices, bid steps, auction split, sculptor shares.

use wide::U256;

/// Generated code from `uint` trips a clippy lint we cannot fix at the call site.
#[allow(clippy::manual_div_ceil)]
mod wide {
    uint::construct_uint! {
        /// 256-bit unsigned integer, only used for `pro_rata` intermediate products.
        pub struct U256(4);
    }
}

pub const BPS_DENOMINATOR: u32 = 10_000;

/// Price to change a slot that was already changed `changes` times this cycle:
/// `base × (growth_bps / 10000) ^ changes`, rounded down at each step. `None` on overflow.
pub fn slot_price(base: u128, growth_bps: u32, changes: u32) -> Option<u128> {
    (0..changes).try_fold(base, |price, _| {
        price
            .checked_mul(u128::from(growth_bps))
            .map(|scaled| scaled / u128::from(BPS_DENOMINATOR))
    })
}

/// `amount × bps / 10000`, rounded down.
pub fn apply_bps(amount: u128, bps: u32) -> u128 {
    pro_rata(amount, u128::from(bps), u128::from(BPS_DENOMINATOR))
}

/// Smallest acceptable bid: `min_bid` for the first bid, otherwise the highest bid plus
/// `increment_bps` of it (at least +1 so bids strictly increase).
pub fn min_next_bid(min_bid: u128, highest: Option<u128>, increment_bps: u32) -> u128 {
    match highest {
        None => min_bid,
        Some(highest) => highest.saturating_add(apply_bps(highest, increment_bps).max(1)),
    }
}

/// Splits a winning bid into `(burned, sculptor_pool)`.
pub fn split_winning_bid(bid: u128, burn_bps: u32) -> (u128, u128) {
    let burned = apply_bps(bid, burn_bps);
    (burned, bid - burned)
}

/// `pool × contribution / total`, rounded down, computed on 256 bits.
pub fn pro_rata(pool: u128, contribution: u128, total: u128) -> u128 {
    if total == 0 {
        return 0;
    }
    let share = U256::from(pool) * U256::from(contribution) / U256::from(total);
    share.low_u128()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_change_costs_the_base_price() {
        assert_eq!(slot_price(1_000, 15_000, 0), Some(1_000));
    }

    #[test]
    fn each_previous_change_multiplies_the_price() {
        assert_eq!(slot_price(1_000, 15_000, 1), Some(1_500));
        assert_eq!(slot_price(1_000, 15_000, 2), Some(2_250));
        assert_eq!(slot_price(1_000, 20_000, 3), Some(8_000));
    }

    #[test]
    fn neutral_growth_keeps_price_flat() {
        assert_eq!(slot_price(1_000, 10_000, 50), Some(1_000));
    }

    #[test]
    fn slot_price_overflow_is_none() {
        assert_eq!(slot_price(u128::MAX / 2, 30_000, 1), None);
    }

    #[test]
    fn apply_bps_rounds_down() {
        assert_eq!(apply_bps(999, 5_000), 499);
        assert_eq!(apply_bps(1_000, 10_000), 1_000);
        assert_eq!(apply_bps(1_000, 0), 0);
    }

    #[test]
    fn first_bid_minimum_is_min_bid() {
        assert_eq!(min_next_bid(100, None, 500), 100);
    }

    #[test]
    fn next_bid_must_beat_highest_by_increment() {
        assert_eq!(min_next_bid(100, Some(1_000), 500), 1_050);
    }

    #[test]
    fn next_bid_always_strictly_increases() {
        assert_eq!(min_next_bid(1, Some(3), 500), 4);
    }

    #[test]
    fn winning_bid_split_conserves_amount() {
        assert_eq!(split_winning_bid(1_001, 5_000), (500, 501));
        assert_eq!(split_winning_bid(1_000, 10_000), (1_000, 0));
    }

    #[test]
    fn pro_rata_share_is_proportional() {
        assert_eq!(pro_rata(1_000, 1, 4), 250);
        assert_eq!(pro_rata(1_000, 4, 4), 1_000);
        assert_eq!(pro_rata(10, 1, 3), 3);
    }

    #[test]
    fn pro_rata_handles_products_beyond_u128() {
        let big = 10u128.pow(30);
        assert_eq!(pro_rata(big, big, big * 2), big / 2);
    }

    #[test]
    fn pro_rata_of_zero_total_is_zero() {
        assert_eq!(pro_rata(1_000, 0, 0), 0);
    }
}
