//! Skin auctions in $MOLT: escrowed bids, anti-snipe extension, settlement (burn + sculptor
//! pool) and pro-rata claims by the cycle's sculptors.

use near_sdk::json_types::U128;
use near_sdk::{AccountId, assert_one_yocto, env, near, require};

use crate::journal::{JournalEntry, JournalKind};
use crate::pricing;
use crate::slots::Genome;
use crate::{Molt, MoltExt};

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Bid {
    pub bidder: AccountId,
    pub amount: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct AuctionState {
    pub ends_at_ns: u64,
    pub highest: Option<Bid>,
    pub settled: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct SkinRecord {
    pub cycle: u32,
    pub genome: Genome,
    /// Total burned by sculptors during the cycle (denominator of their shares).
    pub cycle_burned: u128,
    /// Receives the skin if nobody bids.
    pub top_sculptor: AccountId,
    pub auction: AuctionState,
    /// Part of the winning bid left for sculptors once settled.
    pub sculptor_pool: u128,
}

#[near]
impl Molt {
    /// Bids `amount` $MOLT on a skin. The tokens are escrowed; the previous highest bidder
    /// is refunded in the same call (raising your own bid escrows only the difference).
    /// Requires 1 yoctoNEAR.
    #[payable]
    pub fn bid(&mut self, skin_id: u32, amount: U128) {
        assert_one_yocto();
        let bidder = env::predecessor_account_id();
        require!(
            bidder != env::current_account_id(),
            "The contract account cannot bid"
        );
        self.advance();
        let now = env::block_timestamp();
        let mut auction = self.existing_skin(skin_id).auction.clone();
        require!(
            !auction.settled && now < auction.ends_at_ns,
            "Auction is closed"
        );
        let minimum = self.min_next_bid(&auction);
        require!(
            amount.0 >= minimum,
            format!("Bid too low: minimum is {minimum}")
        );

        match auction.highest.take() {
            Some(previous) if previous.bidder == bidder => {
                self.escrow(&bidder, amount.0 - previous.amount, "bid raise");
            }
            Some(previous) => {
                self.escrow(&bidder, amount.0, "bid");
                self.pay_out(&previous.bidder, previous.amount, "outbid refund");
            }
            None => self.escrow(&bidder, amount.0, "bid"),
        }
        auction.highest = Some(Bid {
            bidder: bidder.clone(),
            amount: amount.0,
        });
        let anti_snipe = self.config.anti_snipe_ns.0;
        if auction.ends_at_ns - now < anti_snipe {
            auction.ends_at_ns = now + anti_snipe;
        }
        self.skin_record_mut(skin_id).auction = auction;

        self.journal.record(JournalEntry {
            account_id: Some(bidder),
            amount,
            skin_id: Some(skin_id),
            ..JournalEntry::new(JournalKind::Bid, self.cycle.number)
        });
    }

    /// Pays the caller's share of a settled skin's sculptor pool.
    pub fn claim_sculptor_share(&mut self, skin_id: u32) -> U128 {
        self.advance();
        let sculptor = env::predecessor_account_id();
        require!(
            self.is_registered(&sculptor),
            "Register storage first (storage_deposit)"
        );
        let skin = self.existing_skin(skin_id).clone();
        require!(skin.auction.settled, "Auction not settled yet");
        let share = self.sculptor_share(&skin, &sculptor);
        let contribution = self.contributions.remove(&(skin.cycle, sculptor.clone()));
        require!(contribution.is_some(), "Nothing to claim");
        self.pay_out(&sculptor, share, "sculptor share");

        self.journal.record(JournalEntry {
            account_id: Some(sculptor),
            amount: U128(share),
            skin_id: Some(skin_id),
            ..JournalEntry::new(JournalKind::SculptorClaim, self.cycle.number)
        });
        U128(share)
    }
}

impl Molt {
    pub(crate) fn skin_record(&self, skin_id: u32) -> Option<&SkinRecord> {
        skin_id
            .checked_sub(1)
            .and_then(|index| self.skins.get(index))
    }

    fn existing_skin(&self, skin_id: u32) -> &SkinRecord {
        self.skin_record(skin_id)
            .unwrap_or_else(|| env::panic_str("Unknown skin"))
    }

    fn skin_record_mut(&mut self, skin_id: u32) -> &mut SkinRecord {
        skin_id
            .checked_sub(1)
            .and_then(|index| self.skins.get_mut(index))
            .unwrap_or_else(|| env::panic_str("Unknown skin"))
    }

    pub(crate) fn min_next_bid(&self, auction: &AuctionState) -> u128 {
        pricing::min_next_bid(
            self.config.min_bid.0,
            auction.highest.as_ref().map(|bid| bid.amount),
            self.config.min_bid_increment_bps,
        )
    }

    /// Whether `account` has tokens escrowed as the highest bid of an open auction.
    pub(crate) fn is_highest_bidder(&self, account: &AccountId) -> bool {
        self.open_auctions.iter().any(|&id| {
            self.skin_record(id)
                .and_then(|skin| skin.auction.highest.as_ref())
                .is_some_and(|bid| &bid.bidder == account)
        })
    }

    pub(crate) fn sculptor_share(&self, skin: &SkinRecord, account: &AccountId) -> u128 {
        if !skin.auction.settled {
            return 0;
        }
        let contribution = self
            .contributions
            .get(&(skin.cycle, account.clone()))
            .copied();
        pricing::pro_rata(
            skin.sculptor_pool,
            contribution.unwrap_or(0),
            skin.cycle_burned,
        )
    }

    /// Settles every open auction whose end has passed. Returns `true` if any was settled.
    pub(crate) fn settle_ended_auctions(&mut self) -> bool {
        let now = env::block_timestamp();
        let ended: Vec<u32> = self
            .open_auctions
            .iter()
            .copied()
            .filter(|&id| {
                self.skin_record(id)
                    .is_some_and(|skin| now >= skin.auction.ends_at_ns)
            })
            .collect();
        self.open_auctions.retain(|id| !ended.contains(id));
        for &skin_id in &ended {
            self.settle(skin_id);
        }
        !ended.is_empty()
    }

    /// Winning bid: skin to the winner, `auction_burn_bps` burned, the rest to the sculptor
    /// pool. No bid: skin to the cycle's top sculptor.
    fn settle(&mut self, skin_id: u32) {
        let burn_bps = self.config.auction_burn_bps;
        let skin = self.skin_record_mut(skin_id);
        skin.auction.settled = true;
        let (new_owner, winning_bid) = match skin.auction.highest.clone() {
            Some(bid) => (bid.bidder, bid.amount),
            None => (skin.top_sculptor.clone(), 0),
        };
        let (burned, pool) = pricing::split_winning_bid(winning_bid, burn_bps);
        skin.sculptor_pool = pool;
        self.burn(&env::current_account_id(), burned, "auction burn");
        self.burned_by_auction += burned;
        self.release_skin(skin_id, &new_owner);

        self.journal.record(JournalEntry {
            account_id: Some(new_owner),
            amount: U128(winning_bid),
            burned: U128(burned),
            skin_id: Some(skin_id),
            ..JournalEntry::new(JournalKind::Settle, self.cycle.number)
        });
    }
}
