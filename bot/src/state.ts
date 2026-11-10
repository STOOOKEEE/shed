// Bot state on disk: journal cursor + pending transform batch. Writes are atomic (temp + rename).

import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { asArray, asRecord, decodeJournalEntry, DecodeError } from "./decode.js";
import type { JournalEntry } from "./types.js";

const STATE_FILE_MODE = 0o600;
const STATE_DIR_MODE = 0o700;
const UINT_STRING = /^\d+$/;

export interface BotState {
  /** `at_ns` of the newest processed journal entry. */
  cursorNs: bigint;
  /** Epoch ms of the last transform batch post (0 = never). */
  lastBatchPostMs: number;
  /** Transforms seen but not posted yet, oldest first. */
  pendingTransforms: JournalEntry[];
}

interface StateFile {
  cursor_ns: string;
  last_batch_post_ms: number;
  pending_transforms: JournalEntry[];
}

/**
 * Parses a state file. Only `cursor_ns` is required, so an operator can write
 * `{"cursor_ns":"0"}` by hand to replay the current journal once.
 */
export function parseState(raw: unknown): BotState {
  const obj = asRecord(raw, "state");
  const cursor = obj["cursor_ns"];
  if (typeof cursor !== "string" || !UINT_STRING.test(cursor)) {
    throw new DecodeError("state.cursor_ns: expected an unsigned integer string");
  }
  const last = obj["last_batch_post_ms"] ?? 0;
  if (typeof last !== "number" || !Number.isFinite(last) || last < 0) {
    throw new DecodeError("state.last_batch_post_ms: expected a non-negative number");
  }
  const pending = asArray(obj["pending_transforms"] ?? [], "state.pending_transforms").map((entry, i) =>
    decodeJournalEntry(entry, `state.pending_transforms[${i}]`),
  );
  return { cursorNs: BigInt(cursor), lastBatchPostMs: last, pendingTransforms: pending };
}

/** Returns null when the file does not exist (first start). Any other problem throws. */
export async function loadState(path: string): Promise<BotState | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  return parseState(JSON.parse(text));
}

export async function saveState(path: string, state: BotState): Promise<void> {
  const file: StateFile = {
    cursor_ns: state.cursorNs.toString(),
    last_batch_post_ms: state.lastBatchPostMs,
    pending_transforms: state.pendingTransforms,
  };
  await mkdir(dirname(path), { recursive: true, mode: STATE_DIR_MODE });
  const tmp = `${path}.${process.pid}.tmp`;
  const handle = await open(tmp, "w", STATE_FILE_MODE);
  try {
    await handle.writeFile(`${JSON.stringify(file, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, path);
}
