// Runtime validation of RPC results: `unknown` in, typed values out.
import {
  JOURNAL_KINDS,
  SLOTS,
  type Auction,
  type CatalogEntry,
  type Config,
  type JournalEntry,
  type JournalKind,
  type Mascot,
  type PerSlot,
  type Sculptor,
  type Skin,
  type Slot,
  type Stats,
  type StorageBalance,
  type StorageBalanceBounds,
} from "./types";

export class DecodeError extends Error {
  override name = "DecodeError";
}

export type Decoder<T> = (value: unknown, path: string) => T;

function fail(path: string, expected: string, value: unknown): never {
  const got = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  throw new DecodeError(`${path}: expected ${expected}, got ${got}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "object", value);
  return Object.fromEntries(Object.entries(value));
}

export const string: Decoder<string> = (value, path) => (typeof value === "string" ? value : fail(path, "string", value));

export const number: Decoder<number> = (value, path) =>
  typeof value === "number" && Number.isFinite(value) ? value : fail(path, "number", value);

export const boolean: Decoder<boolean> = (value, path) => (typeof value === "boolean" ? value : fail(path, "boolean", value));

/** Unsigned integer encoded as a decimal string (U128 / U64). */
export const uintString: Decoder<string> = (value, path) =>
  typeof value === "string" && /^\d+$/.test(value) ? value : fail(path, "unsigned integer string", value);

export function nullable<T>(decode: Decoder<T>): Decoder<T | null> {
  return (value, path) => (value === null || value === undefined ? null : decode(value, path));
}

export function array<T>(decode: Decoder<T>): Decoder<T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) fail(path, "array", value);
    return value.map((item: unknown, i: number) => decode(item, `${path}[${i}]`));
  };
}

export const slot: Decoder<Slot> = (value, path) => SLOTS.find((s) => s === value) ?? fail(path, "slot name", value);

const journalKind: Decoder<JournalKind> = (value, path) =>
  JOURNAL_KINDS.find((k) => k === value) ?? fail(path, "journal kind", value);

/** Typed field access on a JSON object. */
function fields(value: unknown, path: string) {
  const obj = record(value, path);
  return <T>(key: string, decode: Decoder<T>): T => decode(obj[key], `${path}.${key}`);
}

function perSlot<T>(decode: Decoder<T>): Decoder<PerSlot<T>> {
  return (value, path) => {
    const f = fields(value, path);
    return {
      background: f("background", decode),
      shell: f("shell", decode),
      pattern: f("pattern", decode),
      eyes: f("eyes", decode),
      claws: f("claws", decode),
      headgear: f("headgear", decode),
    };
  };
}

export const config: Decoder<Config> = (value, path) => {
  const f = fields(value, path);
  return {
    initial_holder: f("initial_holder", string),
    total_supply: f("total_supply", uintString),
    airdrop_pool: f("airdrop_pool", uintString),
    airdrop_amount: f("airdrop_amount", uintString),
    cycle_duration_ns: f("cycle_duration_ns", uintString),
    auction_duration_ns: f("auction_duration_ns", uintString),
    anti_snipe_ns: f("anti_snipe_ns", uintString),
    base_transform_price: f("base_transform_price", uintString),
    price_growth_bps: f("price_growth_bps", number),
    min_bid: f("min_bid", uintString),
    min_bid_increment_bps: f("min_bid_increment_bps", number),
    auction_burn_bps: f("auction_burn_bps", number),
    genesis_ns: f("genesis_ns", uintString),
  };
};

export const catalogEntry: Decoder<CatalogEntry> = (value, path) => {
  const f = fields(value, path);
  return { slot: f("slot", slot), variants: f("variants", array(string)) };
};

const sculptor: Decoder<Sculptor> = (value, path) => {
  const f = fields(value, path);
  return { account_id: f("account_id", string), burned: f("burned", uintString) };
};

export const mascot: Decoder<Mascot> = (value, path) => {
  const f = fields(value, path);
  return {
    cycle: f("cycle", number),
    cycle_ends_at_ns: f("cycle_ends_at_ns", uintString),
    molt_pending: f("molt_pending", boolean),
    genome: f("genome", perSlot(number)),
    svg: f("svg", string),
    slot_prices: f("slot_prices", perSlot(uintString)),
    slot_changes: f("slot_changes", perSlot(number)),
    cycle_burned: f("cycle_burned", uintString),
    top_sculptor: f("top_sculptor", nullable(sculptor)),
  };
};

export const auction: Decoder<Auction> = (value, path) => {
  const f = fields(value, path);
  return {
    skin_id: f("skin_id", number),
    ends_at_ns: f("ends_at_ns", uintString),
    highest_bidder: f("highest_bidder", nullable(string)),
    highest_bid: f("highest_bid", nullable(uintString)),
    min_next_bid: f("min_next_bid", uintString),
    settled: f("settled", boolean),
  };
};

export const skin: Decoder<Skin> = (value, path) => {
  const f = fields(value, path);
  return {
    skin_id: f("skin_id", number),
    cycle: f("cycle", number),
    genome: f("genome", perSlot(number)),
    svg: f("svg", string),
    owner_id: f("owner_id", string),
    auction: f("auction", auction),
  };
};

export const stats: Decoder<Stats> = (value, path) => {
  const f = fields(value, path);
  return {
    initial_supply: f("initial_supply", uintString),
    total_supply: f("total_supply", uintString),
    burned_by_transform: f("burned_by_transform", uintString),
    burned_by_auction: f("burned_by_auction", uintString),
    skins_minted: f("skins_minted", number),
    airdrop_remaining: f("airdrop_remaining", uintString),
  };
};

export const journalEntry: Decoder<JournalEntry> = (value, path) => {
  const f = fields(value, path);
  return {
    kind: f("kind", journalKind),
    at_ns: f("at_ns", uintString),
    cycle: f("cycle", number),
    account_id: f("account_id", nullable(string)),
    amount: f("amount", uintString),
    burned: f("burned", uintString),
    skin_id: f("skin_id", nullable(number)),
    slot: f("slot", nullable(slot)),
    variant: f("variant", nullable(number)),
  };
};

/** `header.timestamp_nanosec` of an RPC block response. */
export const blockTimestampNs: Decoder<string> = (value, path) => {
  const header = fields(value, path)("header", (v, p) => fields(v, p));
  return header("timestamp_nanosec", uintString);
};

export const storageBalance: Decoder<StorageBalance> = (value, path) => {
  const f = fields(value, path);
  return { total: f("total", uintString), available: f("available", uintString) };
};

export const storageBalanceBounds: Decoder<StorageBalanceBounds> = (value, path) => {
  const f = fields(value, path);
  return { min: f("min", uintString), max: f("max", nullable(uintString)) };
};
