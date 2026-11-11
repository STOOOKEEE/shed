//! Read-only methods. `mascot()` and `transform_deposit()` report the effective state at the
//! current block time. Auctions are reported as stored: one past `ends_at_ns` but not
//! `settled` is waiting for the next call (any call, or `shed()`) to settle it.

use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, near, require};

use crate::auction::SkinRecord;
use crate::config::ShedConfig;
use crate::face::FaceView;
use crate::journal::JournalEntry;
use crate::schedule;
use crate::sculpt::{CycleState, Sculptor};
use crate::slots::{Genome, PerSlot, Slot};
use crate::storage::{AIRDROP_CLAIM_STORAGE_BYTES, MIN_DEPOSIT_YOCTO, bytes_cost};
use crate::{Shed, ShedExt};
use shed_art::{render_svg, variant_names};

const DEFAULT_PAGE_SIZE: u32 = 20;

#[near(serializers = [json])]
pub struct ConfigView {
    #[serde(flatten)]
    pub config: ShedConfig,
    pub genesis_ns: U64,
}

#[near(serializers = [json])]
pub struct CatalogEntry {
    pub slot: Slot,
    pub variants: Vec<String>,
}

#[near(serializers = [json])]
pub struct MascotView {
    pub cycle: u32,
    pub cycle_ends_at_ns: U64,
    /// A sculpted cycle is over; the next call (or `shed()`) will freeze it into a skin.
    pub shed_pending: bool,
    pub genome: Genome,
    pub svg: String,
    pub slot_prices: PerSlot<U128>,
    pub slot_changes: PerSlot<u32>,
    pub cycle_burned: U128,
    pub top_sculptor: Option<Sculptor>,
    /// The live face NFT: its holder made the latest change.
    pub face: Option<FaceView>,
}

#[near(serializers = [json])]
#[derive(Debug, PartialEq)]
pub struct AuctionView {
    pub skin_id: u32,
    pub ends_at_ns: U64,
    pub highest_bidder: Option<AccountId>,
    pub highest_bid: Option<U128>,
    pub min_next_bid: U128,
    pub settled: bool,
}

#[near(serializers = [json])]
pub struct SkinView {
    pub skin_id: u32,
    pub cycle: u32,
    pub genome: Genome,
    pub svg: String,
    pub owner_id: AccountId,
    pub auction: AuctionView,
}

#[near(serializers = [json])]
pub struct StatsView {
    pub initial_supply: U128,
    pub total_supply: U128,
    pub burned_by_transform: U128,
    pub burned_by_auction: U128,
    pub skins_minted: u32,
    pub airdrop_remaining: U128,
}

#[near]
impl Shed {
    pub fn config(&self) -> ConfigView {
        ConfigView {
            config: self.config.clone(),
            genesis_ns: U64(self.genesis_ns),
        }
    }

    pub fn catalog(&self) -> Vec<CatalogEntry> {
        Slot::ALL
            .into_iter()
            .map(|slot| CatalogEntry {
                slot,
                variants: variant_names(slot),
            })
            .collect()
    }

    pub fn mascot(&self) -> MascotView {
        let current = self.current_cycle();
        let cycle_is_stale = current > self.cycle.number;
        let fresh_cycle;
        let cycle = if cycle_is_stale {
            fresh_cycle = CycleState::new(current);
            &fresh_cycle
        } else {
            &self.cycle
        };
        let shed_pending = cycle_is_stale && self.cycle.top_sculptor.is_some();
        MascotView {
            cycle: cycle.number,
            cycle_ends_at_ns: U64(schedule::cycle_end(
                self.genesis_ns,
                self.config.cycle_duration_ns.0,
                cycle.number,
            )),
            shed_pending,
            genome: self.genome,
            svg: render_svg(&self.genome),
            slot_prices: PerSlot::from_fn(|slot| U128(self.slot_price(cycle, slot))),
            slot_changes: cycle.slot_changes,
            cycle_burned: U128(cycle.burned),
            top_sculptor: cycle.top_sculptor.clone(),
            face: self.face_view(),
        }
    }

    /// The current mascot with one trait swapped, to preview a transformation.
    pub fn preview_svg(&self, slot: Slot, variant: u8) -> String {
        require!(variant < slot.variant_count(), "Unknown variant");
        let mut genome = self.genome;
        *genome.get_mut(slot) = variant;
        render_svg(&genome)
    }

    pub fn skin(&self, skin_id: u32) -> Option<SkinView> {
        let record = self.skin_record(skin_id)?;
        Some(SkinView {
            skin_id,
            cycle: record.cycle,
            genome: record.genome,
            svg: render_svg(&record.genome),
            owner_id: self.skin_owner(skin_id)?,
            auction: self.auction_view(skin_id, record),
        })
    }

    /// Skins in minting order; `from_index` is 0-based.
    pub fn skins(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<SkinView> {
        let first_id = from_index.unwrap_or(0).saturating_add(1);
        let last_id = first_id.saturating_add(limit.unwrap_or(DEFAULT_PAGE_SIZE));
        (first_id..last_id)
            .map_while(|skin_id| self.skin(skin_id))
            .collect()
    }

    /// Auctions not settled yet (including ended ones waiting for the next call).
    pub fn auctions(&self) -> Vec<AuctionView> {
        self.open_auctions
            .iter()
            .filter_map(|&id| {
                self.skin_record(id)
                    .map(|record| self.auction_view(id, record))
            })
            .collect()
    }

    pub fn sculptor_claimable(&self, skin_id: u32, account_id: AccountId) -> U128 {
        U128(
            self.skin_record(skin_id)
                .map_or(0, |skin| self.sculptor_share(skin, &account_id)),
        )
    }

    pub fn contribution(&self, cycle: u32, account_id: AccountId) -> U128 {
        U128(
            self.contributions
                .get(&(cycle, account_id))
                .copied()
                .unwrap_or(0),
        )
    }

    pub fn stats(&self) -> StatsView {
        StatsView {
            initial_supply: self.config.total_supply,
            total_supply: U128(self.token.total_supply),
            burned_by_transform: U128(self.burned_by_transform),
            burned_by_auction: U128(self.burned_by_auction),
            skins_minted: self.skins.len(),
            airdrop_remaining: U128(self.airdrop_remaining),
        }
    }

    /// Newest first, at most `JOURNAL_CAPACITY` entries.
    pub fn journal(&self, limit: u32) -> Vec<JournalEntry> {
        self.journal.latest(limit)
    }

    pub fn airdrop_claimed(&self, account_id: AccountId) -> bool {
        self.airdrop_claimed.contains(&account_id)
    }

    /// yoctoNEAR to attach to `account_id`'s next `transform` (storage it will create).
    pub fn transform_deposit(&self, account_id: AccountId) -> U128 {
        U128(
            self.transform_storage_cost(&account_id)
                .max(MIN_DEPOSIT_YOCTO),
        )
    }

    /// yoctoNEAR to attach to `claim_airdrop`.
    pub fn airdrop_deposit(&self) -> U128 {
        U128(bytes_cost(AIRDROP_CLAIM_STORAGE_BYTES))
    }
}

impl Shed {
    fn auction_view(&self, skin_id: u32, record: &SkinRecord) -> AuctionView {
        let auction = &record.auction;
        AuctionView {
            skin_id,
            ends_at_ns: U64(auction.ends_at_ns),
            highest_bidder: auction.highest.as_ref().map(|bid| bid.bidder.clone()),
            highest_bid: auction.highest.as_ref().map(|bid| U128(bid.amount)),
            min_next_bid: U128(self.min_next_bid(auction)),
            settled: auction.settled,
        }
    }
}
