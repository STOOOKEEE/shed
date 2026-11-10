//! End-to-end run on a local NEAR sandbox with the real wasm:
//! airdrop → sculpt → molt → auction → settlement → sculptor claim.

mod support;

use near_sdk::base64::{Engine, engine::general_purpose::STANDARD};
use near_sdk::serde_json::{Value, json};
use support::{
    AIRDROP, BASE_PRICE, Env, MOLT, NO_DEPOSIT, ONE_YOCTO, TOTAL_SUPPLY, TestResult, amount,
};

const CYCLE_SECONDS: u64 = 20;

/// The `media` data URI the contract should serve for the live mascot.
fn skin_media(mascot: &Value) -> String {
    let svg = mascot["svg"].as_str().unwrap_or_default();
    format!("data:image/svg+xml;base64,{}", STANDARD.encode(svg))
}

#[tokio::test]
async fn full_molt_cycle_on_sandbox() -> TestResult {
    let env = Env::start(CYCLE_SECONDS).await?;
    let (alice, bob) = (env.account("alice").await?, env.account("bob").await?);

    // 1. Airdrop.
    for who in [&alice, &bob] {
        env.onboard(who).await?;
        assert_eq!(env.balance(who).await?, AIRDROP);
    }

    // 2. Sculpt: Alice changes the shell twice (the second change costs ×1.5), Bob the eyes.
    env.sculpt(&alice, "shell", 2).await?;
    env.sculpt(&alice, "shell", 5).await?;
    env.sculpt(&bob, "eyes", 4).await?;
    let alice_burned = BASE_PRICE + BASE_PRICE * 3 / 2;
    assert_eq!(env.balance(&alice).await?, AIRDROP - alice_burned);
    let mascot = env.view("mascot", json!({})).await?;
    assert_eq!(
        (
            mascot["genome"]["shell"].as_u64(),
            mascot["genome"]["eyes"].as_u64()
        ),
        (Some(5), Some(4))
    );
    let cycle_burned = alice_burned + BASE_PRICE;
    assert_eq!(amount(&mascot["cycle_burned"]), cycle_burned);

    // 2b. Faces: each change minted a face and burned the previous one; Bob holds the live one.
    for burned in ["face-1", "face-2"] {
        let token = env.view("nft_token", json!({ "token_id": burned })).await?;
        assert!(token.is_null(), "{burned} should be burned");
    }
    let face = env
        .view("nft_token", json!({ "token_id": "face-3" }))
        .await?;
    assert_eq!(face["owner_id"], bob.as_str());
    assert_eq!(face["metadata"]["media"], skin_media(&mascot));
    let transfer = json!({ "receiver_id": alice, "token_id": "face-3" });
    env.call_fails(&bob, "nft_transfer", transfer, ONE_YOCTO)
        .await?;

    // 3. The cycle ends; anyone triggers the molt. The skin is held by the contract.
    env.wait_cycles(1).await?;
    env.call(&bob, "molt", json!({}), NO_DEPOSIT).await?;
    let skin = env.view("skin", json!({ "skin_id": 1 })).await?;
    assert_eq!(skin["genome"]["shell"].as_u64(), Some(5));
    assert_eq!(skin["owner_id"], env.contract.0.as_str());
    let token = env.view("nft_token", json!({ "token_id": "1" })).await?;
    let media = token["metadata"]["media"].as_str().unwrap_or_default();
    assert!(media.starts_with("data:image/svg+xml;base64,"));

    // 4. Auction: Bob bids, Alice outbids, Bob is refunded at once.
    let bob_before = env.balance(&bob).await?;
    env.bid(&bob, 1, 10_000).await?;
    env.bid(&alice, 1, 20_000).await?;
    assert_eq!(env.balance(&bob).await?, bob_before);

    // 5. Settlement: Alice owns the skin, half of her bid is burned.
    env.wait_cycles(2).await?;
    env.call(&bob, "molt", json!({}), NO_DEPOSIT).await?;
    let skin = env.view("skin", json!({ "skin_id": 1 })).await?;
    assert_eq!(skin["owner_id"], alice.as_str());
    let auction_burned = 10_000 * MOLT;
    let stats = env.view("stats", json!({})).await?;
    assert_eq!(amount(&stats["burned_by_auction"]), auction_burned);
    assert_eq!(amount(&stats["burned_by_transform"]), cycle_burned);
    let supply = amount(&env.view("ft_total_supply", json!({})).await?);
    assert_eq!(supply, TOTAL_SUPPLY - cycle_burned - auction_burned);

    // 6. The other half is shared pro-rata to what each sculptor burned.
    let before = env.balance(&bob).await?;
    env.call(
        &bob,
        "claim_sculptor_share",
        json!({ "skin_id": 1 }),
        NO_DEPOSIT,
    )
    .await?;
    // Bob burned 10,000 of the 35,000 MOLT sculpted; the pool is 10,000 MOLT.
    let bob_share = 10_000 * 10_000 * MOLT / 35_000;
    assert_eq!(cycle_burned, 35_000 * MOLT);
    assert_eq!(env.balance(&bob).await? - before, bob_share);

    let journal = env.view("journal", json!({ "limit": 2 })).await?;
    assert_eq!(
        (journal[0]["kind"].as_str(), journal[1]["kind"].as_str()),
        (Some("sculptor_claim"), Some("settle"))
    );
    Ok(())
}
