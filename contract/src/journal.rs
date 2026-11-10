//! Bounded onchain log of what happened, readable by any frontend without an indexer.
//! Every entry is also emitted as a NEP-297 event (`standard: "molt"`) for indexers.

use near_sdk::json_types::{U64, U128};
use near_sdk::serde_json::json;
use near_sdk::store::Vector;
use near_sdk::{AccountId, IntoStorageKey, env, near};

use crate::slots::Slot;

/// Entries kept onchain; older ones are overwritten.
pub const JOURNAL_CAPACITY: u32 = 64;
const EVENT_STANDARD: &str = "molt";
const EVENT_VERSION: &str = "1.0.0";

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JournalKind {
    Transform,
    Molt,
    Bid,
    Settle,
    SculptorClaim,
    Airdrop,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct JournalEntry {
    pub kind: JournalKind,
    pub at_ns: U64,
    pub cycle: u32,
    pub account_id: Option<AccountId>,
    pub amount: U128,
    pub burned: U128,
    pub skin_id: Option<u32>,
    pub slot: Option<Slot>,
    pub variant: Option<u8>,
}

impl JournalEntry {
    /// Entry stamped with the current block time; optional fields start empty.
    pub fn new(kind: JournalKind, cycle: u32) -> Self {
        Self {
            kind,
            at_ns: U64(env::block_timestamp()),
            cycle,
            account_id: None,
            amount: U128(0),
            burned: U128(0),
            skin_id: None,
            slot: None,
            variant: None,
        }
    }
}

#[near]
pub struct Journal {
    entries: Vector<JournalEntry>,
    /// Total entries ever written; `written % capacity` is the next slot to overwrite.
    written: u64,
}

impl Journal {
    pub fn new(prefix: impl IntoStorageKey) -> Self {
        Self {
            entries: Vector::new(prefix),
            written: 0,
        }
    }

    /// Stores the entry (overwriting the oldest once full) and emits it as an event.
    pub fn record(&mut self, entry: JournalEntry) {
        emit_event(&entry);
        if self.entries.len() < JOURNAL_CAPACITY {
            self.entries.push(entry);
        } else {
            let index = (self.written % u64::from(JOURNAL_CAPACITY)) as u32;
            self.entries.replace(index, entry);
        }
        self.written += 1;
    }

    /// Up to `limit` entries, newest first.
    pub fn latest(&self, limit: u32) -> Vec<JournalEntry> {
        let count = limit.min(self.entries.len());
        let capacity = u64::from(JOURNAL_CAPACITY);
        (1..=u64::from(count))
            .filter_map(|age| {
                let index = ((self.written - age) % capacity) as u32;
                self.entries.get(index).cloned()
            })
            .collect()
    }
}

fn emit_event(entry: &JournalEntry) {
    let event = json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_VERSION,
        "event": entry.kind,
        "data": [entry],
    });
    env::log_str(&format!("EVENT_JSON:{event}"));
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, get_logs};
    use near_sdk::testing_env;

    fn entry(cycle: u32) -> JournalEntry {
        JournalEntry::new(JournalKind::Transform, cycle)
    }

    fn setup() -> Journal {
        testing_env!(VMContextBuilder::new().build());
        Journal::new(b"j")
    }

    #[test]
    fn latest_returns_newest_first() {
        let mut journal = setup();
        for cycle in 1..=3 {
            journal.record(entry(cycle));
        }
        let cycles: Vec<u32> = journal.latest(10).iter().map(|e| e.cycle).collect();
        assert_eq!(cycles, vec![3, 2, 1]);
    }

    #[test]
    fn latest_respects_limit() {
        let mut journal = setup();
        for cycle in 1..=5 {
            journal.record(entry(cycle));
        }
        assert_eq!(journal.latest(2).len(), 2);
    }

    #[test]
    fn oldest_entries_are_overwritten_when_full() {
        let mut journal = setup();
        let total = JOURNAL_CAPACITY + 6;
        for cycle in 1..=total {
            journal.record(entry(cycle));
        }
        let latest = journal.latest(u32::MAX);
        assert_eq!(latest.len(), JOURNAL_CAPACITY as usize);
        assert_eq!(latest.first().unwrap().cycle, total);
        assert_eq!(latest.last().unwrap().cycle, 7);
    }

    #[test]
    fn recording_emits_a_nep297_event() {
        let mut journal = setup();
        journal.record(entry(4));
        let logs = get_logs();
        assert_eq!(logs.len(), 1);
        assert!(logs[0].starts_with("EVENT_JSON:{"));
        assert!(logs[0].contains(r#""data":[{"kind":"transform""#));
        assert!(logs[0].contains(r#""event":"transform""#));
        assert!(logs[0].contains(r#""standard":"molt""#));
    }
}
