// Wallet sign-in and signed contract calls through NEAR Connect.
import { NearConnector, type ConnectorAction } from "@hot-labs/near-connect";
import type { AppConfig } from "../config";
import type { Slot } from "../contract/types";
import type { Rpc } from "./rpc";

type FunctionCallAction = Extract<ConnectorAction, { type: "FunctionCall" }>;

const TGAS = 10n ** 12n;
/** Every state-changing call may first close cycles and settle auctions (SVG rendering, minting): give it room. */
const GAS_FULL = (300n * TGAS).toString();
const GAS_STORAGE_DEPOSIT = (30n * TGAS).toString();
const GAS_AFTER_STORAGE_DEPOSIT = (270n * TGAS).toString();
const ONE_YOCTO = "1";
const NO_DEPOSIT = "0";

export interface WalletService {
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  transform(slot: Slot, variant: number): Promise<void>;
  bid(skinId: number, amountYocto: bigint): Promise<void>;
  claimSculptorShare(skinId: number): Promise<void>;
  claimAirdrop(): Promise<void>;
  shed(): Promise<void>;
}

function functionCall(methodName: string, args: object, gas: string, deposit: string): FunctionCallAction {
  return { type: "FunctionCall", params: { methodName, args, gas, deposit } };
}

/** Some wallets resolve with a failed outcome instead of rejecting: surface it. */
function assertSucceeded(outcome: unknown): void {
  if (typeof outcome !== "object" || outcome === null || !("status" in outcome)) return;
  const { status } = outcome;
  if (typeof status === "object" && status !== null && "Failure" in status) {
    throw new Error(`Transaction failed: ${JSON.stringify(status.Failure)}`);
  }
}

export function createWallet(
  cfg: AppConfig,
  rpc: Rpc,
  onAccountChange: (accountId: string | null) => void,
): WalletService {
  const connector = new NearConnector({ network: cfg.network });
  let accountId: string | null = null;

  function setAccount(next: string | null): void {
    if (next === accountId) return;
    accountId = next;
    onAccountChange(next);
  }

  connector.on("wallet:signIn", ({ accounts }) => setAccount(accounts[0]?.accountId ?? null));
  connector.on("wallet:signOut", () => setAccount(null));
  connector.getConnectedWallet().then(
    ({ accounts }) => setAccount(accounts[0]?.accountId ?? null),
    // No previously connected wallet: stay signed out.
    () => setAccount(null),
  );

  function requireAccount(): string {
    if (!accountId) throw new Error("Sign in with a NEAR wallet first.");
    return accountId;
  }

  async function send(actions: FunctionCallAction[]): Promise<void> {
    const signerId = requireAccount();
    const wallet = await connector.wallet();
    const outcome: unknown = await wallet.signAndSendTransaction({
      signerId,
      receiverId: cfg.contractId,
      actions,
    });
    assertSucceeded(outcome);
  }

  return {
    async signIn() {
      const wallet = await connector.connect();
      const accounts = await wallet.getAccounts();
      setAccount(accounts[0]?.accountId ?? null);
    },
    async signOut() {
      await connector.disconnect();
      setAccount(null);
    },
    async transform(slot, variant) {
      // Read right before signing: the deposit depends on who already sculpted this cycle.
      const deposit = await rpc.transformDeposit(requireAccount());
      await send([functionCall("transform", { slot, variant }, GAS_FULL, deposit)]);
    },
    async bid(skinId, amountYocto) {
      if (amountYocto <= 0n) throw new Error("Bid amount must be positive.");
      await send([
        functionCall("bid", { skin_id: skinId, amount: amountYocto.toString() }, GAS_FULL, ONE_YOCTO),
      ]);
    },
    claimSculptorShare: (skinId) =>
      send([functionCall("claim_sculptor_share", { skin_id: skinId }, GAS_FULL, NO_DEPOSIT)]),
    shed: () => send([functionCall("shed", {}, GAS_FULL, NO_DEPOSIT)]),
    async claimAirdrop() {
      const account = requireAccount();
      const [registration, airdropDeposit] = await Promise.all([
        rpc.storageBalanceOf(account),
        rpc.airdropDeposit(),
      ]);
      if (registration) {
        await send([functionCall("claim_airdrop", {}, GAS_FULL, airdropDeposit)]);
        return;
      }
      const bounds = await rpc.storageBalanceBounds();
      await send([
        functionCall(
          "storage_deposit",
          { account_id: account, registration_only: true },
          GAS_STORAGE_DEPOSIT,
          bounds.min,
        ),
        functionCall("claim_airdrop", {}, GAS_AFTER_STORAGE_DEPOSIT, airdropDeposit),
      ]);
    },
  };
}
