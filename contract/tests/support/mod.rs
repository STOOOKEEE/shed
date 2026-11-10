//! Sandbox helpers shared by the end-to-end test and `examples/local_demo.rs`.

use std::sync::Arc;

use near_api::{AccountId, NearGas, NearToken, NetworkConfig, Signer};
use near_sdk::serde_json::{Value, json};

pub type TestResult<T = ()> = testresult::TestResult<T>;

/// 10^18: one whole MOLT.
pub const MOLT: u128 = 1_000_000_000_000_000_000;
pub const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
pub const NO_DEPOSIT: NearToken = NearToken::from_yoctonear(0);
const NANOS_PER_SECOND: u64 = 1_000_000_000;
const GAS: NearGas = NearGas::from_tgas(300);
const ACCOUNT_BALANCE: NearToken = NearToken::from_near(50);
const FAST_FORWARD_STEP: u64 = 50;

/// Launch parameters of the demo deployments (see README), with a configurable cycle length.
pub const TOTAL_SUPPLY: u128 = 1_000_000_000 * MOLT;
pub const AIRDROP: u128 = 100_000 * MOLT;
pub const BASE_PRICE: u128 = 10_000 * MOLT;
pub const MIN_BID: u128 = 5_000 * MOLT;

pub fn demo_config(holder: &AccountId, cycle_seconds: u64) -> Value {
    let cycle_ns = cycle_seconds * NANOS_PER_SECOND;
    json!({
        "initial_holder": holder,
        "total_supply": TOTAL_SUPPLY.to_string(),
        "airdrop_pool": (1_000 * AIRDROP).to_string(),
        "airdrop_amount": AIRDROP.to_string(),
        "cycle_duration_ns": cycle_ns.to_string(),
        "auction_duration_ns": cycle_ns.to_string(),
        "anti_snipe_ns": (cycle_ns / 4).to_string(),
        "base_transform_price": BASE_PRICE.to_string(),
        "price_growth_bps": 15_000,
        "min_bid": MIN_BID.to_string(),
        "min_bid_increment_bps": 500,
        "auction_burn_bps": 5_000,
    })
}

pub struct Env {
    pub sandbox: near_sandbox::Sandbox,
    pub network: NetworkConfig,
    pub contract: near_api::Contract,
    signer: Arc<Signer>,
}

impl Env {
    /// Starts a sandbox, builds the wasm and deploys MOLT with `demo_config`.
    pub async fn start(cycle_seconds: u64) -> TestResult<Self> {
        let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
        let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
        let signer = Signer::from_secret_key(
            near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
        )?;
        let holder = create_account(&sandbox, "holder").await?;
        let contract_id = create_account(&sandbox, "molt").await?;
        let wasm = std::fs::read(cargo_near_build::build_with_cli(Default::default())?)?;
        near_api::Contract::deploy(contract_id.clone())
            .use_code(wasm)
            .with_init_call(
                "new",
                json!({ "config": demo_config(&holder, cycle_seconds) }),
            )?
            .with_signer(signer.clone())
            .send_to(&network)
            .await?
            .assert_success();
        Ok(Self {
            sandbox,
            network,
            contract: near_api::Contract(contract_id),
            signer,
        })
    }

    pub async fn account(&self, name: &str) -> TestResult<AccountId> {
        create_account(&self.sandbox, name).await
    }

    pub async fn call(
        &self,
        who: &AccountId,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> TestResult {
        self.send(who, method, args, deposit)
            .await?
            .assert_success();
        Ok(())
    }

    /// Like `call`, but the transaction must fail.
    pub async fn call_fails(
        &self,
        who: &AccountId,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> TestResult {
        self.send(who, method, args, deposit)
            .await?
            .assert_failure();
        Ok(())
    }

    async fn send(
        &self,
        who: &AccountId,
        method: &str,
        args: Value,
        deposit: NearToken,
    ) -> TestResult<near_api::types::transaction::result::TransactionResult> {
        Ok(self
            .contract
            .call_function(method, args)
            .transaction()
            .gas(GAS)
            .deposit(deposit)
            .with_signer(who.clone(), self.signer.clone())
            .send_to(&self.network)
            .await?)
    }

    pub async fn view(&self, method: &str, args: Value) -> TestResult<Value> {
        Ok(self
            .contract
            .call_function(method, args)
            .read_only()
            .fetch_from(&self.network)
            .await?
            .data)
    }

    pub async fn balance(&self, who: &AccountId) -> TestResult<u128> {
        Ok(amount(
            &self
                .view("ft_balance_of", json!({ "account_id": who }))
                .await?,
        ))
    }

    /// Registers storage and claims the airdrop (with its storage prepayment).
    pub async fn onboard(&self, who: &AccountId) -> TestResult {
        let bounds = self.view("storage_balance_bounds", json!({})).await?;
        let storage = NearToken::from_yoctonear(amount(&bounds["min"]));
        self.call(
            who,
            "storage_deposit",
            json!({ "registration_only": true }),
            storage,
        )
        .await?;
        let claim_deposit = amount(&self.view("airdrop_deposit", json!({})).await?);
        self.call(
            who,
            "claim_airdrop",
            json!({}),
            NearToken::from_yoctonear(claim_deposit),
        )
        .await
    }

    /// `transform`, attaching the storage prepayment the contract asks for.
    pub async fn sculpt(&self, who: &AccountId, slot: &str, variant: u8) -> TestResult {
        let deposit = self
            .view("transform_deposit", json!({ "account_id": who }))
            .await?;
        self.call(
            who,
            "transform",
            json!({ "slot": slot, "variant": variant }),
            NearToken::from_yoctonear(amount(&deposit)),
        )
        .await
    }

    pub async fn bid(&self, who: &AccountId, skin_id: u32, molt: u128) -> TestResult {
        let args = json!({ "skin_id": skin_id, "amount": (molt * MOLT).to_string() });
        self.call(who, "bid", args, ONE_YOCTO).await
    }

    /// Produces blocks until the clock is `cycles` cycles later (read from the `mascot` view).
    pub async fn wait_cycles(&self, cycles: u64) -> TestResult {
        let cycle_now = |mascot: Value| mascot["cycle"].as_u64().unwrap_or_default();
        let target = cycle_now(self.view("mascot", json!({})).await?) + cycles;
        while cycle_now(self.view("mascot", json!({})).await?) < target {
            self.sandbox.fast_forward(FAST_FORWARD_STEP).await?;
        }
        Ok(())
    }
}

/// Parses a `U128` JSON string.
pub fn amount(value: &Value) -> u128 {
    value
        .as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or_default()
}

async fn create_account(sandbox: &near_sandbox::Sandbox, name: &str) -> TestResult<AccountId> {
    let account_id: AccountId = format!("{name}.sandbox").parse()?;
    sandbox
        .create_account(account_id.clone())
        .initial_balance(ACCOUNT_BALANCE)
        .send()
        .await?;
    Ok(account_id)
}
