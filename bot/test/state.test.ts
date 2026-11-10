import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadState, parseState, saveState } from "../src/state.js";

test("state round-trips atomically with mode 0600 and no temp file left", async () => {
  const dir = await mkdtemp(join(tmpdir(), "molt-bot-"));
  try {
    const path = join(dir, "nested", "state.json");
    assert.equal(await loadState(path), null);
    const state = { cursorNs: 1793715682354556033n, lastBatchPostMs: 42, pendingTransforms: [] };
    await saveState(path, state);
    assert.deepEqual(await loadState(path), state);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(join(dir, "nested")), ["state.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a hand-written cursor-only state is accepted; garbage is rejected", async () => {
  assert.deepEqual(parseState({ cursor_ns: "0" }), { cursorNs: 0n, lastBatchPostMs: 0, pendingTransforms: [] });
  assert.throws(() => parseState({ cursor_ns: 0 }), /cursor_ns/);
  assert.throws(() => parseState({ cursor_ns: "1", pending_transforms: [{ kind: "nope" }] }), /unknown kind/);
  const dir = await mkdtemp(join(tmpdir(), "molt-bot-"));
  try {
    const path = join(dir, "state.json");
    await writeFile(path, "{not json");
    await assert.rejects(loadState(path), SyntaxError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
