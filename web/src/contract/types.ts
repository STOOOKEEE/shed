// Contract JSON interface (authoritative, mirrors the Rust contract).
export type Slot = "background" | "shell" | "pattern" | "eyes" | "claws" | "headgear";
export type PerSlot<T> = Record<Slot, T>;
export type Genome = PerSlot<number>;
export interface Config { initial_holder: string; total_supply: string; airdrop_pool: string; airdrop_amount: string; cycle_duration_ns: string; auction_duration_ns: string; anti_snipe_ns: string; base_transform_price: string; price_growth_bps: number; min_bid: string; min_bid_increment_bps: number; auction_burn_bps: number; genesis_ns: string }
export interface CatalogEntry { slot: Slot; variants: string[] }
export interface Sculptor { account_id: string; burned: string }
/** Live face NFT of the current mascot, worn by whoever changed it last. */
export interface Face { token_id: string; owner_id: string }
export interface Mascot { cycle: number; cycle_ends_at_ns: string; shed_pending: boolean; genome: Genome; svg: string; slot_prices: PerSlot<string>; slot_changes: PerSlot<number>; cycle_burned: string; top_sculptor: Sculptor | null; face: Face | null }
export interface Auction { skin_id: number; ends_at_ns: string; highest_bidder: string | null; highest_bid: string | null; min_next_bid: string; settled: boolean }
export interface Skin { skin_id: number; cycle: number; genome: Genome; svg: string; owner_id: string; auction: Auction }
export interface Stats { initial_supply: string; total_supply: string; burned_by_transform: string; burned_by_auction: string; skins_minted: number; airdrop_remaining: string }
export type JournalKind = "transform" | "shed" | "bid" | "settle" | "sculptor_claim" | "airdrop";
export interface JournalEntry { kind: JournalKind; at_ns: string; cycle: number; account_id: string | null; amount: string; burned: string; skin_id: number | null; slot: Slot | null; variant: number | null }

export const SLOTS: readonly Slot[] = ["background", "shell", "pattern", "eyes", "claws", "headgear"];
export const JOURNAL_KINDS: readonly JournalKind[] = ["transform", "shed", "bid", "settle", "sculptor_claim", "airdrop"];

// Exuviae collection (NEP-171 token + NEP-177 metadata): one permanent NFT per dethroned face holder.
export interface ExuviaMetadata { title: string | null; description: string | null; media: string | null; issued_at: string | null }
export interface Exuvia { token_id: string; owner_id: string; metadata: ExuviaMetadata }

// Standard NEP-145 storage management shapes.
export interface StorageBalance { total: string; available: string }
export interface StorageBalanceBounds { min: string; max: string | null }
