// Cursor and batching rules over the onchain journal. Pure functions, no I/O.
//
// The cursor is the `at_ns` of the last processed entry. Entries written in the same block share
// a timestamp, but the journal is read at finality "final", so a block is always seen whole:
// "strictly greater than the cursor" never skips nor repeats an entry.

import type { JournalEntry } from "./types.js";

/** Entries kept onchain by the contract (`JOURNAL_CAPACITY`). */
export const JOURNAL_CAPACITY = 64;

/** Entries newer than `cursorNs`, oldest first. `journal` is newest-first, as returned by the contract. */
export function entriesAfter(journal: readonly JournalEntry[], cursorNs: bigint): JournalEntry[] {
  return journal.filter((entry) => BigInt(entry.at_ns) > cursorNs).reverse();
}

/** Cursor to start from on first launch: the newest entry, so no backlog gets posted. */
export function newestCursor(journal: readonly JournalEntry[]): bigint {
  return journal.reduce((max, entry) => (BigInt(entry.at_ns) > max ? BigInt(entry.at_ns) : max), 0n);
}

/**
 * True when a full journal holds nothing at or before the cursor: entries may have been
 * overwritten between two polls.
 */
export function mayHaveGap(journal: readonly JournalEntry[], cursorNs: bigint): boolean {
  if (journal.length < JOURNAL_CAPACITY) return false;
  return journal.every((entry) => BigInt(entry.at_ns) > cursorNs);
}

/** A batch of transforms is posted at most once per interval. */
export function shouldFlushBatch(pendingCount: number, lastPostMs: number, nowMs: number, intervalMs: number): boolean {
  return pendingCount > 0 && nowMs - lastPostMs >= intervalMs;
}
