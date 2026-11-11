//! SHED Exuviae: the burn collection. One permanent NFT per dethroned sculptor, minted by the
//! main contract and nobody else. Each exuvia keeps its look and its reign; unlike the face,
//! it survives and can be sold.

use near_contract_standards::non_fungible_token::NonFungibleToken;
use near_contract_standards::non_fungible_token::metadata::{
    NFT_METADATA_SPEC, NFTContractMetadata, TokenMetadata,
};
use near_contract_standards::non_fungible_token::{Token, TokenId};
use near_gas::NearGas;
use near_sdk::json_types::U64;
use near_sdk::store::LookupMap;
use near_sdk::{AccountId, BorshStorageKey, PanicOnDefault, env, ext_contract, near, require};

use shed_art::render_svg;

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Owners,
    NftMetadata,
    NftEnumeration,
    Reigns,
    Genomes,
    Successors,
}

#[derive(PanicOnDefault, near_sdk::borsh::BorshSerialize, near_sdk::borsh::BorshDeserialize)]
pub struct Exuviae {
    nft: NonFungibleToken,
    metadata: NFTContractMetadata,
    /// `exuvia id -> reign`, in nanoseconds.
    reigns: LookupMap<TokenId, (U64, U64)>,
    /// `exuvia id -> the look it froze`.
    genomes: LookupMap<TokenId, shed_art::slot::Genome>,
    /// `exuvia id -> account that dethroned the sculptor`.
    successors: LookupMap<TokenId, AccountId>,
    /// The one account allowed to mint: the main contract.
    minter: AccountId,
    minted: u32,
}

/// Storage a mint costs (about a kilobyte: owner, metadata with the SVG, maps) and the gas
/// the main contract attaches to the cross-contract call.
pub const MINT_STORAGE_BYTES: u64 = 1_400;
pub const MINT_GAS: NearGas = NearGas::from_tgas(20);

#[ext_contract(ext)]
#[allow(dead_code)]
trait ExuviaeMinter {
    fn mint(
        &mut self,
        sculptor: AccountId,
        genome: shed_art::slot::Genome,
        reign_ns: U64,
        successor: AccountId,
    ) -> Token;
}

impl Exuviae {
    /// Called once, in the same transaction as the main contract's `new` (sub-account deploy).
    pub fn exuviae_new(minter: AccountId) -> Self {
        Self {
            nft: NonFungibleToken::new(
                StorageKey::Owners,
                env::current_account_id(),
                Some(StorageKey::NftMetadata),
                Some(StorageKey::NftEnumeration),
                None::<&[u8]>,
            ),
            metadata: NFTContractMetadata {
                spec: NFT_METADATA_SPEC.to_string(),
                name: "SHED Exuviae".to_string(),
                symbol: "EXUVIA".to_string(),
                icon: None,
                base_uri: None,
                reference: None,
                reference_hash: None,
            },
            reigns: LookupMap::new(StorageKey::Reigns),
            genomes: LookupMap::new(StorageKey::Genomes),
            successors: LookupMap::new(StorageKey::Successors),
            minter,
            minted: 0,
        }
    }

    /// Minted by the main contract only. `reign_ns` is how long `sculptor` held the face.
    pub fn mint(
        &mut self,
        sculptor: AccountId,
        genome: shed_art::slot::Genome,
        reign_ns: U64,
        successor: AccountId,
    ) -> Token {
        require!(
            env::predecessor_account_id() == self.minter,
            "Only the SHED contract mints Exuviae"
        );
        self.minted += 1;
        let token_id: TokenId = self.minted.to_string();
        let svg = render_svg(&self.genomes.get(&token_id).copied().unwrap_or_default());
        let metadata = TokenMetadata {
            title: Some(format!("SHED Exuviae #{}", self.minted)),
            description: Some(format!(
                "The carapace {} left behind after {} dethroned it. Held for {}.",
                sculptor, successor, reign_ns.0
            )),
            media: Some(shed_art::svg_data_uri(&svg)),
            issued_at: Some((env::block_timestamp() / 1_000_000).to_string()),
            ..Default::default()
        };
        self.reigns.insert(
            token_id.clone(),
            (
                U64(env::block_timestamp() - reign_ns.0),
                U64(env::block_timestamp()),
            ),
        );
        self.genomes.insert(token_id.clone(), genome);
        self.successors.insert(token_id.clone(), successor);
        self.nft
            .internal_mint_with_refund(token_id.clone(), sculptor.clone(), Some(metadata), None)
    }

    pub fn reign(&self, token_id: TokenId) -> (U64, U64) {
        self.reigns
            .get(&token_id)
            .copied()
            .unwrap_or((U64(0), U64(0)))
    }

    pub fn successor(&self, token_id: TokenId) -> Option<AccountId> {
        self.successors.get(&token_id).cloned()
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm_exports {
    use super::*;
    use near_sdk::{env, serde_json};

    #[unsafe(no_mangle)]
    pub extern "C" fn exuviae_new() {
        env::setup_panic_hook();
        let args: MinterArgs = serde_json::from_slice(env::input().unwrap_or_default().as_slice())
            .unwrap_or_else(|_| env::panic_str("Invalid arguments to exuviae_new"));
        let contract = Exuviae::exuviae_new(args.minter);
        env::state_write(&contract);
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn exuviae_nft_token() {
        env::setup_panic_hook();
        let contract: Exuviae = env::state_read::<Exuviae>()
            .unwrap_or_else(|| env::panic_str("Contract must be initialized first"));
        let args: TokenArgs = serde_json::from_slice(env::input().unwrap_or_default().as_slice())
            .unwrap_or_else(|_| env::panic_str("Invalid arguments to nft_token"));
        use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
        match contract.nft.nft_token(args.token_id) {
            Some(token) => {
                env::value_return(&serde_json::to_vec(&token).unwrap_or_default());
            }
            None => env::value_return(b"null"),
        }
    }

    #[unsafe(no_mangle)]
    pub extern "C" fn mint() {
        env::setup_panic_hook();
        let mut contract: Exuviae = env::state_read::<Exuviae>()
            .unwrap_or_else(|| env::panic_str("Contract must be initialized first"));
        require!(
            env::predecessor_account_id() == contract.minter,
            "Only the SHED contract mints Exuviae"
        );
        #[derive(near_sdk::serde::Deserialize)]
        struct MintArgs {
            sculptor: AccountId,
            genome: shed_art::slot::Genome,
            reign_ns: U64,
            successor: AccountId,
        }
        let args: MintArgs = serde_json::from_slice(env::input().unwrap_or_default().as_slice())
            .unwrap_or_else(|_| env::panic_str("Invalid arguments to mint"));
        let token = contract.mint(args.sculptor, args.genome, args.reign_ns, args.successor);
        env::value_return(&serde_json::to_vec(&token).unwrap_or_default());
        env::state_write(&contract);
    }

    #[derive(near_sdk::serde::Deserialize)]
    struct MinterArgs {
        minter: AccountId,
    }

    #[derive(near_sdk::serde::Deserialize)]
    struct TokenArgs {
        token_id: String,
    }
}
