import assert from "node:assert/strict";
import { test } from "node:test";
import { Announcer, freshState, type ChainReader } from "../src/announcer.js";
import { entriesAfter, JOURNAL_CAPACITY, mayHaveGap, newestCursor, shouldFlushBatch } from "../src/events.js";
import type { Post, Publisher } from "../src/publish.js";
import type { BotState } from "../src/state.js";
import type { JournalEntry, Mascot, Skin } from "../src/types.js";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges"><rect width="32" height="32" fill="#0b1d36"/></svg>';
const MINUTE_MS = 60_000;

function entry(kind: JournalEntry["kind"], atNs: string, extra: Partial<JournalEntry> = {}): JournalEntry {
  return { kind, at_ns: atNs, cycle: 1, account_id: "a.testnet", amount: "0", burned: "0", skin_id: null, slot: null, variant: null, ...extra };
}

/** Newest-first, like the contract. */
function journalOf(...oldestFirst: JournalEntry[]): JournalEntry[] {
  return [...oldestFirst].reverse();
}

test("entriesAfter keeps entries strictly newer than the cursor, oldest first", () => {
  const journal = journalOf(entry("transform", "10"), entry("transform", "20"), entry("shed", "20"), entry("bid", "30"));
  assert.deepEqual(entriesAfter(journal, 20n).map((e) => e.at_ns), ["30"]);
  assert.deepEqual(entriesAfter(journal, 10n).map((e) => `${e.kind}@${e.at_ns}`), ["transform@20", "shed@20", "bid@30"]);
  assert.equal(entriesAfter(journal, 30n).length, 0);
  assert.equal(entriesAfter(journal, 0n).length, 4);
});

test("newestCursor and gap detection", () => {
  assert.equal(newestCursor([]), 0n);
  assert.equal(newestCursor(journalOf(entry("bid", "5"), entry("bid", "99999999999999999999"))), 99999999999999999999n);
  const full = Array.from({ length: JOURNAL_CAPACITY }, (_, i) => entry("bid", String(100 + i)));
  assert.equal(mayHaveGap(full, 50n), true);
  assert.equal(mayHaveGap(full, 100n), false);
  assert.equal(mayHaveGap(full.slice(1), 50n), false);
});

test("shouldFlushBatch respects the minimum interval", () => {
  assert.equal(shouldFlushBatch(0, 0, 10 * MINUTE_MS, MINUTE_MS), false);
  assert.equal(shouldFlushBatch(2, 0, 10 * MINUTE_MS, MINUTE_MS), true);
  assert.equal(shouldFlushBatch(2, 10 * MINUTE_MS, 10 * MINUTE_MS + 59_999, MINUTE_MS), false);
  assert.equal(shouldFlushBatch(2, 10 * MINUTE_MS, 11 * MINUTE_MS, MINUTE_MS), true);
});

class FakeChain implements ChainReader {
  journalEntries: JournalEntry[] = [];
  async journal(): Promise<JournalEntry[]> {
    return this.journalEntries;
  }
  async mascot(): Promise<Mascot> {
    return { cycle: 2, svg: SVG, cycle_burned: "0", face: { token_id: "face-9", owner_id: "b.testnet" } };
  }
  async skin(skinId: number): Promise<Skin> {
    return { skin_id: skinId, cycle: 1, svg: SVG, owner_id: "b.testnet", auction: { ends_at_ns: "0", settled: false } };
  }
}

class RecordingPublisher implements Publisher {
  posts: Post[] = [];
  async publish(post: Post): Promise<boolean> {
    this.posts.push(post);
    return true;
  }
}

function setup(state: BotState) {
  const chain = new FakeChain();
  const publisher = new RecordingPublisher();
  const saved: BotState[] = [];
  let now = 100 * MINUTE_MS;
  const announcer = new Announcer(
    {
      chain,
      publisher,
      persist: async (s) => {
        saved.push(s);
      },
      catalog: [{ slot: "eyes", variants: ["Round", "Laser"] }],
      auctionBurnBps: 5000,
      minPostIntervalSeconds: 30 * 60,
      compose: { publicUrl: null },
      now: () => now,
    },
    state,
  );
  return { chain, publisher, saved, announcer, advance: (ms: number) => (now += ms) };
}

test("first start sets the cursor to the newest entry: no backlog post", async () => {
  const chain = new FakeChain();
  chain.journalEntries = journalOf(entry("transform", "10"), entry("shed", "20", { skin_id: 1 }));
  const state = await freshState(chain);
  assert.equal(state.cursorNs, 20n);
  const { chain: c2, publisher, announcer } = setup(state);
  c2.journalEntries = chain.journalEntries;
  await announcer.tick();
  assert.equal(publisher.posts.length, 0);
});

test("shed/settle post at once, transforms batch once per interval, others ignored", async () => {
  const { chain, publisher, announcer, advance } = setup({ cursorNs: 0n, lastBatchPostMs: 0, pendingTransforms: [] });
  const t1 = entry("transform", "10", { slot: "eyes", variant: 1, burned: "1000000000000000000000" });
  const t2 = entry("transform", "11", { slot: "eyes", variant: 0, burned: "1000000000000000000000" });
  chain.journalEntries = journalOf(t1, t2, entry("shed", "12", { skin_id: 1, amount: "2000000000000000000000" }), entry("bid", "13"), entry("airdrop", "14"));
  await announcer.tick();
  assert.deepEqual(publisher.posts.map((p) => p.kind), ["shed", "batch"]);
  assert.match(publisher.posts[1]?.text ?? "", /2 changes/);
  assert.equal(announcer.current.cursorNs, 14n);
  assert.equal(announcer.current.pendingTransforms.length, 0);

  // A new transform within the interval is held back…
  chain.journalEntries = journalOf(...chain.journalEntries.slice().reverse(), entry("transform", "20", { slot: "eyes", variant: 1 }));
  advance(10 * MINUTE_MS);
  await announcer.tick();
  assert.equal(publisher.posts.length, 2);
  assert.equal(announcer.current.pendingTransforms.length, 1);

  // …a settle still goes out immediately…
  chain.journalEntries = journalOf(...chain.journalEntries.slice().reverse(), entry("settle", "21", { skin_id: 1, amount: "0" }));
  await announcer.tick();
  assert.deepEqual(publisher.posts.map((p) => p.kind), ["shed", "batch", "settle"]);

  // …and the batch is posted once the interval has elapsed, without re-reading old entries.
  advance(20 * MINUTE_MS);
  await announcer.tick();
  assert.deepEqual(publisher.posts.map((p) => p.kind), ["shed", "batch", "settle", "batch"]);
  assert.match(publisher.posts[3]?.text ?? "", /1 change since/);
  await announcer.tick();
  assert.equal(publisher.posts.length, 4);
});

test("the cursor only moves past a block once all its entries are handled", async () => {
  const { chain, saved, announcer } = setup({ cursorNs: 0n, lastBatchPostMs: 0, pendingTransforms: [] });
  chain.journalEntries = journalOf(entry("shed", "50", { skin_id: 1 }), entry("settle", "50", { skin_id: 0, amount: "0" }), entry("bid", "60"));
  await announcer.tick();
  assert.deepEqual(saved.map((s) => s.cursorNs), [50n, 60n]);
});
