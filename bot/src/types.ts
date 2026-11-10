// Contract view shapes, restricted to the fields the bot reads.

export const JOURNAL_KINDS = ["transform", "molt", "bid", "settle", "sculptor_claim", "airdrop"] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

export interface JournalEntry {
  kind: JournalKind;
  /** Block timestamp in nanoseconds (U64 string). */
  at_ns: string;
  cycle: number;
  account_id: string | null;
  /** yocto-MOLT (U128 string). */
  amount: string;
  burned: string;
  skin_id: number | null;
  slot: string | null;
  variant: number | null;
}

export interface Mascot {
  cycle: number;
  svg: string;
  cycle_burned: string;
  face: { token_id: string; owner_id: string } | null;
}

export interface CatalogSlot {
  slot: string;
  variants: string[];
}

export interface Skin {
  skin_id: number;
  cycle: number;
  svg: string;
  owner_id: string;
  auction: { ends_at_ns: string; settled: boolean };
}

/** Immutable launch parameters (`config()`), subset. */
export interface ContractConfig {
  auction_burn_bps: number;
}
