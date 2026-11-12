// Typed, wallet-free view calls against the SHED contract.
import { JsonRpcProvider } from "near-api-js";
import type { AppConfig } from "../config";
import * as decode from "../contract/decode";
import type {
  Auction,
  CatalogEntry,
  Config,
  Exuvia,
  JournalEntry,
  Mascot,
  Skin,
  Slot,
  Stats,
  StorageBalance,
  StorageBalanceBounds,
} from "../contract/types";

const RPC_RETRY_OPTIONS = { retries: 2, wait: 250, backoff: 2 };

export interface Rpc {
  config(): Promise<Config>;
  catalog(): Promise<CatalogEntry[]>;
  mascot(): Promise<Mascot>;
  previewSvg(slot: Slot, variant: number): Promise<string>;
  skin(skinId: number): Promise<Skin | null>;
  skins(fromIndex: number, limit: number): Promise<Skin[]>;
  auctions(): Promise<Auction[]>;
  sculptorClaimable(skinId: number, accountId: string): Promise<string>;
  stats(): Promise<Stats>;
  journal(limit: number): Promise<JournalEntry[]>;
  airdropClaimed(accountId: string): Promise<boolean>;
  ftBalanceOf(accountId: string): Promise<string>;
  storageBalanceOf(accountId: string): Promise<StorageBalance | null>;
  storageBalanceBounds(): Promise<StorageBalanceBounds>;
  /** Timestamp (ns) of the latest final block. */
  chainTimeNs(): Promise<string>;
  /** Exact yoctoNEAR deposit `transform` needs from this account right now (storage prepayment). */
  transformDeposit(accountId: string): Promise<string>;
  /** Exuvia NFT by id ("1", "2", … consecutive), null past the last one. */
  exuvia(tokenId: number): Promise<Exuvia | null>;
  /** yoctoNEAR deposit `claim_airdrop` needs (storage prepayment). */
  airdropDeposit(): Promise<string>;
}

export function createRpc(cfg: AppConfig): Rpc {
  const provider = new JsonRpcProvider({ url: cfg.nodeUrl }, RPC_RETRY_OPTIONS);

  async function viewOn<T>(
    contractId: string,
    method: string,
    args: Record<string, unknown>,
    decoder: decode.Decoder<T>,
  ): Promise<T> {
    const raw: unknown = await provider.callFunction({ contractId, method, args });
    return decoder(raw, `${method}()`);
  }

  function view<T>(method: string, args: Record<string, unknown>, decoder: decode.Decoder<T>): Promise<T> {
    return viewOn(cfg.contractId, method, args, decoder);
  }

  async function chainTimeNs(): Promise<string> {
    const block: unknown = await provider.viewBlock({ finality: "final" });
    return decode.blockTimestampNs(block, "block()");
  }

  return {
    chainTimeNs,
    config: () => view("config", {}, decode.config),
    catalog: () => view("catalog", {}, decode.array(decode.catalogEntry)),
    mascot: () => view("mascot", {}, decode.mascot),
    previewSvg: (slot, variant) => view("preview_svg", { slot, variant }, decode.string),
    skin: (skinId) => view("skin", { skin_id: skinId }, decode.nullable(decode.skin)),
    skins: (fromIndex, limit) => view("skins", { from_index: fromIndex, limit }, decode.array(decode.skin)),
    auctions: () => view("auctions", {}, decode.array(decode.auction)),
    sculptorClaimable: (skinId, accountId) =>
      view("sculptor_claimable", { skin_id: skinId, account_id: accountId }, decode.uintString),
    stats: () => view("stats", {}, decode.stats),
    journal: (limit) => view("journal", { limit }, decode.array(decode.journalEntry)),
    airdropClaimed: (accountId) => view("airdrop_claimed", { account_id: accountId }, decode.boolean),
    ftBalanceOf: (accountId) => view("ft_balance_of", { account_id: accountId }, decode.uintString),
    storageBalanceOf: (accountId) =>
      view("storage_balance_of", { account_id: accountId }, decode.nullable(decode.storageBalance)),
    storageBalanceBounds: () => view("storage_balance_bounds", {}, decode.storageBalanceBounds),
    transformDeposit: (accountId) => view("transform_deposit", { account_id: accountId }, decode.uintString),
    exuvia: (tokenId) =>
      viewOn(cfg.exuviaeId, "exuviae_nft_token", { token_id: String(tokenId) }, decode.nullable(decode.exuvia)),
    airdropDeposit: () => view("airdrop_deposit", {}, decode.uintString),
  };
}
