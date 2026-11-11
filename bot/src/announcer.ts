// One poll step: read new journal entries, post molts/settles at once, batch transforms.
//
// Delivery is at-least-once towards the publisher: the cursor is saved after a block's entries
// are handled, so a crash in between may repeat a post, never lose one. A post rejected by X is
// logged and not retried (the bot is cosmetic; retry loops would cost money and spam).

import { composeBatch, composeShed, composeSettle, type ComposeContext } from "./compose.js";
import { entriesAfter, JOURNAL_CAPACITY, mayHaveGap, newestCursor, shouldFlushBatch } from "./events.js";
import { log } from "./log.js";
import type { Post, Publisher } from "./publish.js";
import { renderPng } from "./render.js";
import type { BotState } from "./state.js";
import type { CatalogSlot, JournalEntry, Mascot, Skin } from "./types.js";

const MS_PER_SECOND = 1000;
/** Bounds the state file if X stays unreachable for a long time. */
const MAX_PENDING_TRANSFORMS = 256;

export interface ChainReader {
  journal(limit: number): Promise<JournalEntry[]>;
  mascot(): Promise<Mascot>;
  skin(skinId: number): Promise<Skin | null>;
}

export interface AnnouncerOptions {
  chain: ChainReader;
  publisher: Publisher;
  persist: (state: BotState) => Promise<void>;
  catalog: readonly CatalogSlot[];
  auctionBurnBps: number;
  minPostIntervalSeconds: number;
  compose: ComposeContext;
  now?: () => number;
}

/** State for a first start: cursor on the newest entry, so the existing backlog is not posted. */
export async function freshState(chain: ChainReader): Promise<BotState> {
  return { cursorNs: newestCursor(await chain.journal(JOURNAL_CAPACITY)), lastBatchPostMs: 0, pendingTransforms: [] };
}

export class Announcer {
  private readonly now: () => number;

  constructor(
    private readonly options: AnnouncerOptions,
    private state: BotState,
  ) {
    this.now = options.now ?? Date.now;
  }

  get current(): BotState {
    return this.state;
  }

  async tick(): Promise<void> {
    const journal = await this.options.chain.journal(JOURNAL_CAPACITY);
    if (mayHaveGap(journal, this.state.cursorNs)) {
      log.warn("journal wrapped since last poll: some entries were missed", { cursor_ns: this.state.cursorNs.toString() });
    }
    const fresh = entriesAfter(journal, this.state.cursorNs);
    for (const [i, entry] of fresh.entries()) {
      await this.handle(entry);
      const next = fresh[i + 1];
      // Entries of one block share `at_ns`: move the cursor only once the whole block is done.
      if (next === undefined || next.at_ns !== entry.at_ns) {
        this.state = { ...this.state, cursorNs: BigInt(entry.at_ns) };
        await this.options.persist(this.state);
      }
    }
    await this.flushBatchIfDue();
  }

  private async handle(entry: JournalEntry): Promise<void> {
    switch (entry.kind) {
      case "shed":
      case "settle":
        await this.announceSkin(entry);
        return;
      case "transform": {
        const pending = [...this.state.pendingTransforms, entry];
        if (pending.length > MAX_PENDING_TRANSFORMS) log.warn("pending transforms capped", { dropped: 1 });
        this.state = { ...this.state, pendingTransforms: pending.slice(-MAX_PENDING_TRANSFORMS) };
        return;
      }
      case "bid":
      case "sculptor_claim":
      case "airdrop":
        return;
    }
  }

  private async announceSkin(entry: JournalEntry): Promise<void> {
    if (entry.skin_id === null) {
      log.warn("skin event without skin_id, skipped", { kind: entry.kind, at_ns: entry.at_ns });
      return;
    }
    const skin = await this.options.chain.skin(entry.skin_id);
    if (skin === null) {
      log.warn("skin not found, skipped", { kind: entry.kind, skin_id: entry.skin_id });
      return;
    }
    const text =
      entry.kind === "shed"
        ? composeShed(entry, skin, this.options.auctionBurnBps, this.options.compose)
        : composeSettle(entry, skin, this.options.compose);
    await this.publish({
      kind: entry.kind === "shed" ? "shed" : "settle",
      text,
      png: renderPng(skin.svg),
      meta: { cycle: skin.cycle, skin_id: skin.skin_id, at_ns: entry.at_ns },
    });
  }

  private async flushBatchIfDue(): Promise<void> {
    const { pendingTransforms, lastBatchPostMs } = this.state;
    const now = this.now();
    const intervalMs = this.options.minPostIntervalSeconds * MS_PER_SECOND;
    if (!shouldFlushBatch(pendingTransforms.length, lastBatchPostMs, now, intervalMs)) return;

    const mascot = await this.options.chain.mascot();
    await this.publish({
      kind: "batch",
      text: composeBatch(pendingTransforms, this.options.catalog, mascot.face?.owner_id ?? null, this.options.compose),
      png: renderPng(mascot.svg),
      meta: { cycle: mascot.cycle, changes: pendingTransforms.length },
    });
    this.state = { ...this.state, pendingTransforms: [], lastBatchPostMs: now };
    await this.options.persist(this.state);
  }

  private async publish(post: Post): Promise<void> {
    const sent = await this.options.publisher.publish(post);
    if (!sent) log.warn("post not sent, moving on", { kind: post.kind, ...post.meta });
  }
}
