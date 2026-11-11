//! Starts a local NEAR sandbox, deploys SHED with 10-minute cycles, plays a few rounds
//! (airdrop, sculpting, a shed, bids, a slot fight) and keeps the node running so the web app
//! can read it. Run: `cargo run --example local_demo`, then start the web app with the printed
//! variables.

/// Shared with the end-to-end test; the demo does not use every helper.
#[allow(dead_code)]
#[path = "../tests/support/mod.rs"]
mod support;

use near_sdk::serde_json::json;
use support::{Env, NO_DEPOSIT, TestResult};

const CYCLE_SECONDS: u64 = 600;

#[tokio::main]
async fn main() -> TestResult {
    println!("Starting sandbox, building and deploying SHED…");
    let env = Env::start(CYCLE_SECONDS).await?;
    let alice = env.account("alice").await?;
    let bob = env.account("bob").await?;
    let carol = env.account("carol").await?;

    println!("Cycle 1: airdrop and sculpting");
    for who in [&alice, &bob, &carol] {
        env.onboard(who).await?;
    }
    env.sculpt(&alice, "shell", 2).await?;
    env.sculpt(&bob, "headgear", 4).await?;
    env.sculpt(&carol, "eyes", 1).await?;
    env.sculpt(&alice, "background", 5).await?;
    env.sculpt(&bob, "pattern", 1).await?;

    println!("Cycle 2: skin #1 goes to auction, then a fight over the shell");
    env.wait_cycles(1).await?;
    env.call(&carol, "shed", json!({}), NO_DEPOSIT).await?;
    env.bid(&carol, 1, 20_000).await?;
    env.bid(&alice, 1, 30_000).await?;
    env.sculpt(&bob, "shell", 1).await?;
    env.sculpt(&carol, "shell", 6).await?;
    env.sculpt(&bob, "shell", 1).await?;
    env.sculpt(&alice, "claws", 3).await?;

    println!("\nSandbox running (read-only for the web app). Start it with:");
    println!(
        "  cd web && VITE_CONTRACT_ID={} VITE_NODE_URL={} npm run dev",
        env.contract.0, env.sandbox.rpc_addr
    );
    println!("Press Ctrl-C to stop.");
    tokio::signal::ctrl_c().await?;
    Ok(())
}
