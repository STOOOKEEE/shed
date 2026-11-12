//! Sculpting: burning $SHED to change one trait of the mascot, and closing a cycle into a skin.

use near_sdk::json_types::U128;
use near_sdk::{AccountId, env, near, require};

use crate::auction::{AuctionState, SkinRecord};
use crate::journal::{JournalEntry, JournalKind};
use crate::pricing;
use crate::slots::{PerSlot, Slot};
use crate::storage::{self, CONTRIBUTION_STORAGE_BYTES, SKIN_STORAGE_BYTES, bytes_cost};
use crate::{Shed, ShedExt};

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Sculptor {
    pub account_id: AccountId,
    pub burned: U128,
}

#[near(serializers = [borsh])]
pub struct CycleState {
    pub number: u32,
    pub slot_changes: PerSlot<u32>,
    pub burned: u128,
    pub top_sculptor: Option<Sculptor>,
}

impl CycleState {
    pub fn new(number: u32) -> Self {
        Self {
            number,
            slot_changes: PerSlot::default(),
            burned: 0,
            top_sculptor: None,
        }
    }
}

#[near]
impl Shed {
    /// Burns the current price of `slot` from the caller and sets it to `variant`.
    /// Attach `transform_deposit(account_id)`: the storage this change creates (at least 1 yocto,
    /// which also forces a full-access-key confirmation). The excess is refunded.
    #[payable]
    pub fn transform(&mut self, slot: Slot, variant: u8) -> U128 {
        let sculptor = env::predecessor_account_id();
        require!(
            sculptor != env::current_account_id(),
            "The contract account cannot sculpt"
        );
        self.advance();
        storage::take_deposit(self.transform_storage_cost(&sculptor));
        require!(variant < slot.variant_count(), "Unknown variant");
        require!(
            *self.genome.get(slot) != variant,
            "The mascot already wears this variant"
        );
        let price = self.slot_price(&self.cycle, slot);
        self.burn(&sculptor, price, "transform");

        *self.genome.get_mut(slot) = variant;
        self.hand_face_to(&sculptor);
        *self.cycle.slot_changes.get_mut(slot) += 1;
        self.cycle.burned += price;
        self.burned_by_transform += price;
        let contribution = self.add_contribution(&sculptor, price);
        if self
            .cycle
            .top_sculptor
            .as_ref()
            .is_none_or(|top| contribution > top.burned.0)
        {
            self.cycle.top_sculptor = Some(Sculptor {
                account_id: sculptor.clone(),
                burned: U128(contribution),
            });
        }

        self.journal.record(JournalEntry {
            account_id: Some(sculptor),
            amount: U128(price),
            burned: U128(price),
            slot: Some(slot),
            variant: Some(variant),
            ..JournalEntry::new(JournalKind::Transform, self.cycle.number)
        });
        U128(price)
    }
}

impl Shed {
    pub(crate) fn slot_price(&self, cycle: &CycleState, slot: Slot) -> u128 {
        pricing::slot_price(
            self.config.base_transform_price.0,
            self.config.price_growth_bps,
            *cycle.slot_changes.get(slot),
        )
        .unwrap_or_else(|| env::panic_str("Slot price overflow: wait for the next cycle"))
    }

    /// NEAR (yocto) the next `transform` by `sculptor` must prepay at the current time: the skin
    /// if it is the first change of its cycle, the contribution entry if `sculptor` is new to it.
    pub(crate) fn transform_storage_cost(&self, sculptor: &AccountId) -> u128 {
        let cycle_is_stale = self.current_cycle() > self.cycle.number;
        let opens_skin = cycle_is_stale || self.cycle.top_sculptor.is_none();
        let new_contributor = cycle_is_stale
            || !self
                .contributions
                .contains_key(&(self.cycle.number, sculptor.clone()));
        let skin_bytes = if opens_skin { SKIN_STORAGE_BYTES } else { 0 };
        let contribution_bytes = if new_contributor {
            CONTRIBUTION_STORAGE_BYTES
        } else {
            0
        };
        // Dethroning the face holder mints their exuvia in the burn collection.
        let exuvia_bytes = if self.face.is_some() && self.exuviae_contract.is_some() {
            shed_exuviae::MINT_STORAGE_BYTES
        } else {
            0
        };
        bytes_cost(skin_bytes + contribution_bytes + exuvia_bytes)
    }

    /// Adds `amount` to the caller's contribution to the current cycle; returns the new total.
    fn add_contribution(&mut self, sculptor: &AccountId, amount: u128) -> u128 {
        let key = (self.cycle.number, sculptor.clone());
        let total = self.contributions.get(&key).copied().unwrap_or(0) + amount;
        self.contributions.insert(key, total);
        total
    }

    /// Freezes the cycle held in memory into a skin if anyone sculpted during it.
    pub(crate) fn close_cycle(&mut self) {
        let Some(top) = self.cycle.top_sculptor.clone() else {
            return;
        };
        let skin_id = self.skins.len() + 1;
        let cycle = self.cycle.number;
        let genome = self.genome;
        self.mint_skin(skin_id, cycle, &genome);
        self.skins.push(SkinRecord {
            cycle,
            genome,
            cycle_burned: self.cycle.burned,
            top_sculptor: top.account_id,
            auction: AuctionState {
                ends_at_ns: env::block_timestamp() + self.config.auction_duration_ns.0,
                highest: None,
                settled: false,
            },
            sculptor_pool: 0,
        });
        self.open_auctions.push(skin_id);
        self.journal.record(JournalEntry {
            amount: U128(self.cycle.burned),
            skin_id: Some(skin_id),
            ..JournalEntry::new(JournalKind::Shed, cycle)
        });
    }
}
