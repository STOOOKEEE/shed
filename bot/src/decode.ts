// Narrowing of untrusted JSON (RPC and X responses) into typed values. Throws DecodeError on mismatch.

import {
  JOURNAL_KINDS,
  type CatalogSlot,
  type ContractConfig,
  type JournalEntry,
  type JournalKind,
  type Mascot,
  type Skin,
} from "./types.js";

const UINT_STRING = /^\d+$/;

export class DecodeError extends Error {
  override name = "DecodeError";
}

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown, what: string): JsonRecord {
  if (!isRecord(value)) throw new DecodeError(`${what}: expected an object`);
  return value;
}

export function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new DecodeError(`${what}: expected an array`);
  return value;
}

export function str(obj: JsonRecord, key: string, what: string): string {
  const value = obj[key];
  if (typeof value !== "string") throw new DecodeError(`${what}.${key}: expected a string`);
  return value;
}

function optStr(obj: JsonRecord, key: string, what: string): string | null {
  return obj[key] === null || obj[key] === undefined ? null : str(obj, key, what);
}

/** Unsigned integer encoded as a decimal string (U64 / U128). */
function uintStr(obj: JsonRecord, key: string, what: string): string {
  const value = str(obj, key, what);
  if (!UINT_STRING.test(value)) throw new DecodeError(`${what}.${key}: expected an unsigned integer string`);
  return value;
}

function uint(obj: JsonRecord, key: string, what: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new DecodeError(`${what}.${key}: expected an unsigned integer`);
  }
  return value;
}

function optUint(obj: JsonRecord, key: string, what: string): number | null {
  return obj[key] === null || obj[key] === undefined ? null : uint(obj, key, what);
}

function bool(obj: JsonRecord, key: string, what: string): boolean {
  const value = obj[key];
  if (typeof value !== "boolean") throw new DecodeError(`${what}.${key}: expected a boolean`);
  return value;
}

function isJournalKind(value: string): value is JournalKind {
  return (JOURNAL_KINDS as readonly string[]).includes(value);
}

export function decodeJournalEntry(value: unknown, what = "journal entry"): JournalEntry {
  const obj = asRecord(value, what);
  const kind = str(obj, "kind", what);
  if (!isJournalKind(kind)) throw new DecodeError(`${what}.kind: unknown kind "${kind}"`);
  return {
    kind,
    at_ns: uintStr(obj, "at_ns", what),
    cycle: uint(obj, "cycle", what),
    account_id: optStr(obj, "account_id", what),
    amount: uintStr(obj, "amount", what),
    burned: uintStr(obj, "burned", what),
    skin_id: optUint(obj, "skin_id", what),
    slot: optStr(obj, "slot", what),
    variant: optUint(obj, "variant", what),
  };
}

export function decodeJournal(value: unknown): JournalEntry[] {
  return asArray(value, "journal").map((entry, i) => decodeJournalEntry(entry, `journal[${i}]`));
}

export function decodeMascot(value: unknown): Mascot {
  const what = "mascot";
  const obj = asRecord(value, what);
  const faceRaw = obj["face"];
  const face =
    faceRaw === null || faceRaw === undefined
      ? null
      : (() => {
          const f = asRecord(faceRaw, `${what}.face`);
          return { token_id: str(f, "token_id", `${what}.face`), owner_id: str(f, "owner_id", `${what}.face`) };
        })();
  return {
    cycle: uint(obj, "cycle", what),
    svg: str(obj, "svg", what),
    cycle_burned: uintStr(obj, "cycle_burned", what),
    face,
  };
}

export function decodeCatalog(value: unknown): CatalogSlot[] {
  return asArray(value, "catalog").map((entry, i) => {
    const what = `catalog[${i}]`;
    const obj = asRecord(entry, what);
    const variants = asArray(obj["variants"], `${what}.variants`).map((name, j) => {
      if (typeof name !== "string") throw new DecodeError(`${what}.variants[${j}]: expected a string`);
      return name;
    });
    return { slot: str(obj, "slot", what), variants };
  });
}

/** `skin()` returns null for an unknown id. */
export function decodeSkin(value: unknown): Skin | null {
  if (value === null) return null;
  const what = "skin";
  const obj = asRecord(value, what);
  const auction = asRecord(obj["auction"], `${what}.auction`);
  return {
    skin_id: uint(obj, "skin_id", what),
    cycle: uint(obj, "cycle", what),
    svg: str(obj, "svg", what),
    owner_id: str(obj, "owner_id", what),
    auction: {
      ends_at_ns: uintStr(auction, "ends_at_ns", `${what}.auction`),
      settled: bool(auction, "settled", `${what}.auction`),
    },
  };
}

export function decodeContractConfig(value: unknown): ContractConfig {
  return { auction_burn_bps: uint(asRecord(value, "config"), "auction_burn_bps", "config") };
}
