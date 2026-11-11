//! Fixed-size airdrop for the demo: `airdrop_amount` once per account from `airdrop_pool`.
//! Trivially sybil-able; a mainnet launch would use `airdrop_pool = 0`.

use near_sdk::json_types::U128;
use near_sdk::{env, near, require};

use crate::journal::{JournalEntry, JournalKind};
use crate::storage::{self, AIRDROP_CLAIM_STORAGE_BYTES, bytes_cost};
use crate::{Shed, ShedExt};

#[near]
impl Shed {
    /// Sends `airdrop_amount` to the caller, once. The caller must be storage-registered and
    /// attach `airdrop_deposit()` for the claim record (the excess is refunded).
    #[payable]
    pub fn claim_airdrop(&mut self) -> U128 {
        self.advance();
        let claimer = env::predecessor_account_id();
        let amount = self.config.airdrop_amount.0;
        require!(
            self.is_registered(&claimer),
            "Register storage first (storage_deposit)"
        );
        require!(
            !self.airdrop_claimed.contains(&claimer),
            "Airdrop already claimed"
        );
        require!(
            amount > 0 && self.airdrop_remaining >= amount,
            "Airdrop pool is empty"
        );
        storage::take_deposit(bytes_cost(AIRDROP_CLAIM_STORAGE_BYTES));
        self.airdrop_claimed.insert(claimer.clone());
        self.airdrop_remaining -= amount;
        self.pay_out(&claimer, amount, "airdrop");

        self.journal.record(JournalEntry {
            account_id: Some(claimer),
            amount: U128(amount),
            ..JournalEntry::new(JournalKind::Airdrop, self.cycle.number)
        });
        U128(amount)
    }
}
