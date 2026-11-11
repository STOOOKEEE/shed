//! SHED — the memecoin that sheds its skins. See `docs/design.md`.
//!
//! One contract is both the NEP-141 token ($SHED) and the NEP-171 collection of skins.
//! There is no owner and no admin method: every parameter is fixed by `new`.

pub mod config;
pub mod journal;
pub mod pricing;

pub mod schedule;
pub mod slots;
pub mod storage;

mod airdrop;
mod auction;
mod face;
mod sculpt;
mod skins;
mod token;
mod views;

#[cfg(test)]
mod tests;

use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::non_fungible_token::NonFungibleToken;
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{AccountId, BorshStorageKey, PanicOnDefault, env, near};

use crate::auction::SkinRecord;
use crate::config::ShedConfig;
use crate::face::FaceRecord;
use crate::journal::Journal;
use crate::sculpt::CycleState;
use crate::slots::Genome;
pub use shed_exuviae;

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    FtAccounts,
    NftOwners,
    NftMetadata,
    NftEnumeration,
    NftApprovals,
    Contributions,
    Skins,
    AirdropClaims,
    Journal,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Shed {
    config: ShedConfig,
    genesis_ns: u64,
    token: FungibleToken,
    skin_nft: NonFungibleToken,
    /// Current look of the mascot.
    genome: Genome,
    /// Sculpting state of the cycle held in memory (may lag behind the clock until `advance`).
    cycle: CycleState,
    /// Tokens burned by an account while sculpting a cycle, keyed by `(cycle, account)`.
    contributions: LookupMap<(u32, AccountId), u128>,
    /// Skin `n` is stored at index `n - 1`.
    skins: Vector<SkinRecord>,
    /// Skins whose auction is not settled yet (a handful at most).
    open_auctions: Vec<u32>,
    airdrop_remaining: u128,
    airdrop_claimed: LookupSet<AccountId>,
    burned_by_transform: u128,
    burned_by_auction: u128,
    /// The live face NFT and how many were ever minted (token ids `face-1`, `face-2`, …).
    face: Option<FaceRecord>,
    faces_minted: u32,
    /// The burn collection (Exuviae) contract account, if deployed. Set once at init.
    exuviae_contract: Option<AccountId>,
    journal: Journal,
}

#[near]
impl Shed {
    /// Launches the token. `#[private]`: only the contract account itself, in the deploy
    /// transaction, can initialise it.
    #[init]
    #[private]
    pub fn new(config: ShedConfig, exuviae_contract: Option<AccountId>) -> Self {
        let contract_id = env::current_account_id();
        if let Err(error) = config.validate(&contract_id) {
            env::panic_str(error);
        }
        let mut token = FungibleToken::new(StorageKey::FtAccounts);
        for holder in [&config.initial_holder, &contract_id] {
            token.internal_register_account(holder);
        }
        let airdrop_pool = config.airdrop_pool.0;
        let holder_share = config.total_supply.0 - airdrop_pool;
        token.internal_deposit(&config.initial_holder, holder_share);
        FtMint {
            owner_id: &config.initial_holder,
            amount: holder_share.into(),
            memo: Some("launch"),
        }
        .emit();
        if airdrop_pool > 0 {
            token.internal_deposit(&contract_id, airdrop_pool);
            FtMint {
                owner_id: &contract_id,
                amount: airdrop_pool.into(),
                memo: Some("airdrop pool"),
            }
            .emit();
        }
        Self {
            genesis_ns: env::block_timestamp(),
            token,
            skin_nft: NonFungibleToken::new(
                StorageKey::NftOwners,
                contract_id,
                Some(StorageKey::NftMetadata),
                Some(StorageKey::NftEnumeration),
                Some(StorageKey::NftApprovals),
            ),
            genome: Genome::default(),
            cycle: CycleState::new(1),
            contributions: LookupMap::new(StorageKey::Contributions),
            skins: Vector::new(StorageKey::Skins),
            open_auctions: Vec::new(),
            airdrop_remaining: airdrop_pool,
            airdrop_claimed: LookupSet::new(StorageKey::AirdropClaims),
            burned_by_transform: 0,
            burned_by_auction: 0,
            face: None,
            faces_minted: 0,
            exuviae_contract,
            journal: Journal::new(StorageKey::Journal),
            config,
        }
    }

    /// Permissionless keeper call: settles finished auctions and closes finished cycles.
    /// Every state-changing method does the same first, so calling this is never required.
    /// Returns `true` if anything changed.
    pub fn shed(&mut self) -> bool {
        self.advance()
    }
}

impl Shed {
    fn now() -> u64 {
        env::block_timestamp()
    }

    fn current_cycle(&self) -> u32 {
        schedule::cycle_at(
            self.genesis_ns,
            self.config.cycle_duration_ns.0,
            Self::now(),
        )
    }

    /// Brings the state up to the current time: settle ended auctions, then close the cycle.
    fn advance(&mut self) -> bool {
        let settled_any = self.settle_ended_auctions();
        let current = self.current_cycle();
        if current <= self.cycle.number {
            return settled_any;
        }
        self.close_cycle();
        self.cycle = CycleState::new(current);
        true
    }
}
