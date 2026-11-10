//! Cycles are aligned on a fixed schedule: cycle `n` (1-based) covers
//! `[genesis + (n-1) × duration, genesis + n × duration)`.

/// Index of the cycle running at `now_ns`.
pub fn cycle_at(genesis_ns: u64, duration_ns: u64, now_ns: u64) -> u32 {
    let elapsed_cycles = now_ns.saturating_sub(genesis_ns) / duration_ns;
    u32::try_from(elapsed_cycles + 1).unwrap_or(u32::MAX)
}

/// Timestamp at which `cycle` ends.
pub fn cycle_end(genesis_ns: u64, duration_ns: u64, cycle: u32) -> u64 {
    genesis_ns.saturating_add(duration_ns.saturating_mul(u64::from(cycle)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const GENESIS: u64 = 1_000;
    const DURATION: u64 = 100;

    #[test]
    fn first_cycle_starts_at_genesis() {
        assert_eq!(cycle_at(GENESIS, DURATION, GENESIS), 1);
        assert_eq!(cycle_at(GENESIS, DURATION, GENESIS + 99), 1);
    }

    #[test]
    fn cycle_changes_exactly_at_its_end() {
        assert_eq!(cycle_at(GENESIS, DURATION, GENESIS + 100), 2);
        assert_eq!(cycle_at(GENESIS, DURATION, GENESIS + 1_050), 11);
    }

    #[test]
    fn time_before_genesis_is_cycle_one() {
        assert_eq!(cycle_at(GENESIS, DURATION, 0), 1);
    }

    #[test]
    fn cycle_end_matches_cycle_at() {
        assert_eq!(cycle_end(GENESIS, DURATION, 1), 1_100);
        assert_eq!(
            cycle_at(GENESIS, DURATION, cycle_end(GENESIS, DURATION, 7)),
            8
        );
    }
}
