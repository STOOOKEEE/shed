//! The face: a single live NFT of the current mascot. Every `transform` burns the previous
//! face and mints a new one to the sculptor, so the token always belongs to whoever changed
//! the mascot last. It cannot be transferred or approved: it is a title, not an asset.
//! Its image is computed when read, so it always shows the live mascot.

use near_contract_standards::non_fungible_token::Token;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::TokenMetadata;
use near_sdk::serde_json;
use near_sdk::{AccountId, env, near};

use crate::Molt;
use crate::render::{render_svg, svg_data_uri};

const FACE_PREFIX: &str = "face-";
pub const FACE_LOCKED: &str =
    "The face cannot be transferred or approved: it burns when the mascot changes";
const NANOS_PER_MILLI: u64 = 1_000_000;

#[near(serializers = [borsh])]
pub struct FaceRecord {
    pub token_id: String,
    pub owner_id: AccountId,
}

#[near(serializers = [json])]
pub struct FaceView {
    pub token_id: String,
    pub owner_id: AccountId,
}

pub fn is_face(token_id: &str) -> bool {
    token_id.starts_with(FACE_PREFIX)
}

impl Molt {
    /// Burns the current face (if any) and mints a new one to `sculptor`.
    pub(crate) fn hand_face_to(&mut self, sculptor: &AccountId) {
        if let Some(previous) = self.face.take() {
            self.burn_nft(&previous.token_id, &previous.owner_id, "face replaced");
        }
        self.faces_minted += 1;
        let token_id = format!("{FACE_PREFIX}{}", self.faces_minted);
        let metadata = TokenMetadata {
            title: Some(format!("MOLT face #{}", self.faces_minted)),
            description: Some(
                "Held by whoever reshaped the MOLT mascot last. Burns the moment someone changes it again."
                    .to_string(),
            ),
            issued_at: Some((env::block_timestamp() / NANOS_PER_MILLI).to_string()),
            extra: Some(serde_json::json!({ "cycle": self.cycle.number, "genome": self.genome }).to_string()),
            ..Default::default()
        };
        self.skin_nft.internal_mint_with_refund(
            token_id.clone(),
            sculptor.clone(),
            Some(metadata),
            None,
        );
        NftMint {
            owner_id: sculptor,
            token_ids: &[&token_id],
            memo: Some("face"),
        }
        .emit();
        self.face = Some(FaceRecord {
            token_id,
            owner_id: sculptor.clone(),
        });
    }

    /// Fills the face's `media` with the live mascot; other tokens are returned unchanged.
    pub(crate) fn with_live_media(&self, mut token: Token) -> Token {
        if is_face(&token.token_id)
            && let Some(metadata) = token.metadata.as_mut()
        {
            metadata.media = Some(svg_data_uri(&render_svg(&self.genome)));
        }
        token
    }

    pub(crate) fn face_view(&self) -> Option<FaceView> {
        self.face.as_ref().map(|face| FaceView {
            token_id: face.token_id.clone(),
            owner_id: face.owner_id.clone(),
        })
    }
}
