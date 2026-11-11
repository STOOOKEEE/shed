//! Skins: NEP-171 NFTs (with NEP-177 metadata, NEP-178 approvals, NEP-181 enumeration).
//! Each skin is the frozen look of one cycle, with its SVG stored onchain. The same collection
//! holds the live face (see `face.rs`), which these methods refuse to move.

use std::collections::HashMap;

use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::{NftBurn, NftMint};
use near_contract_standards::non_fungible_token::metadata::{
    NFT_METADATA_SPEC, NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata,
};
use near_contract_standards::non_fungible_token::{Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::serde_json;
use near_sdk::{AccountId, Promise, PromiseOrValue, env, near, require};

use crate::face::{FACE_LOCKED, is_face};
use crate::slots::Genome;
use crate::{Shed, ShedExt};
use shed_art::{render_svg, svg_data_uri};

const NANOS_PER_MILLI: u64 = 1_000_000;

pub(crate) fn token_id(skin_id: u32) -> TokenId {
    skin_id.to_string()
}

impl Shed {
    /// Mints skin `skin_id`, owned by the contract while its auction runs. Storage is paid by
    /// the contract account.
    pub(crate) fn mint_skin(&mut self, skin_id: u32, cycle: u32, genome: &Genome) {
        let svg = render_svg(genome);
        let metadata = TokenMetadata {
            title: Some(format!("SHED skin #{skin_id}")),
            description: Some(format!(
                "The look of the SHED mascot at the end of cycle {cycle}, shed and frozen onchain."
            )),
            media: Some(svg_data_uri(&svg)),
            issued_at: Some((env::block_timestamp() / NANOS_PER_MILLI).to_string()),
            extra: Some(serde_json::json!({ "cycle": cycle, "genome": genome }).to_string()),
            ..Default::default()
        };
        let owner = env::current_account_id();
        let id = token_id(skin_id);
        self.skin_nft
            .internal_mint_with_refund(id.clone(), owner.clone(), Some(metadata), None);
        NftMint {
            owner_id: &owner,
            token_ids: &[&id],
            memo: None,
        }
        .emit();
    }

    /// Hands a skin over from the contract (auction escrow) to its new owner.
    pub(crate) fn release_skin(&mut self, skin_id: u32, to: &AccountId) {
        let contract_id = env::current_account_id();
        self.skin_nft
            .internal_transfer(&contract_id, to, &token_id(skin_id), None, None);
    }

    pub(crate) fn skin_owner(&self, skin_id: u32) -> Option<AccountId> {
        self.skin_nft.owner_by_id.get(&token_id(skin_id))
    }

    /// Removes a token and everything the standard stores about it, then emits `nft_burn`.
    pub(crate) fn burn_nft(&mut self, token_id: &TokenId, owner_id: &AccountId, memo: &str) {
        let nft = &mut self.skin_nft;
        nft.owner_by_id.remove(token_id);
        if let Some(metadata) = nft.token_metadata_by_id.as_mut() {
            metadata.remove(token_id);
        }
        if let Some(tokens_per_owner) = nft.tokens_per_owner.as_mut()
            && let Some(mut owned) = tokens_per_owner.get(owner_id)
        {
            owned.remove(token_id);
            if owned.is_empty() {
                tokens_per_owner.remove(owner_id);
            } else {
                tokens_per_owner.insert(owner_id, &owned);
            }
        }
        if let Some(approvals) = nft.approvals_by_id.as_mut() {
            approvals.remove(token_id);
        }
        if let Some(next_approval_ids) = nft.next_approval_id_by_id.as_mut() {
            next_approval_ids.remove(token_id);
        }
        NftBurn {
            owner_id,
            token_ids: &[token_id],
            authorized_id: None,
            memo: Some(memo),
        }
        .emit();
    }
}

#[near]
impl NonFungibleTokenCore for Shed {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        require!(!is_face(&token_id), FACE_LOCKED);
        self.skin_nft
            .nft_transfer(receiver_id, token_id, approval_id, memo)
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        require!(!is_face(&token_id), FACE_LOCKED);
        self.skin_nft
            .nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.skin_nft
            .nft_token(token_id)
            .map(|token| self.with_live_media(token))
    }
}

#[near]
impl NonFungibleTokenResolver for Shed {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.skin_nft.nft_resolve_transfer(
            previous_owner_id,
            receiver_id,
            token_id,
            approved_account_ids,
        )
    }
}

#[near]
impl NonFungibleTokenApproval for Shed {
    #[payable]
    fn nft_approve(
        &mut self,
        token_id: TokenId,
        account_id: AccountId,
        msg: Option<String>,
    ) -> Option<Promise> {
        require!(!is_face(&token_id), FACE_LOCKED);
        self.skin_nft.nft_approve(token_id, account_id, msg)
    }

    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.skin_nft.nft_revoke(token_id, account_id)
    }

    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.skin_nft.nft_revoke_all(token_id)
    }

    fn nft_is_approved(
        &self,
        token_id: TokenId,
        approved_account_id: AccountId,
        approval_id: Option<u64>,
    ) -> bool {
        self.skin_nft
            .nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Shed {
    fn nft_total_supply(&self) -> U128 {
        self.skin_nft.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.skin_nft
            .nft_tokens(from_index, limit)
            .into_iter()
            .map(|token| self.with_live_media(token))
            .collect()
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.skin_nft.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.skin_nft
            .nft_tokens_for_owner(account_id, from_index, limit)
            .into_iter()
            .map(|token| self.with_live_media(token))
            .collect()
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Shed {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "SHED skins".to_string(),
            symbol: "SKIN".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}
