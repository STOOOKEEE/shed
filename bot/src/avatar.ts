// Keeps the bot account's profile picture equal to the live mascot.
// One upload at most per AVATAR_MIN_INTERVAL_MS: a fight over the look must not hammer the X API.

import { log } from "./log.js";
import { renderPng } from "./render.js";
import type { Mascot } from "./types.js";

export const AVATAR_MIN_INTERVAL_MS = 60_000;

export interface AvatarUpdater {
  /** Resolves true when the new picture is live. Never throws for remote (X) failures. */
  update(png: Buffer): Promise<boolean>;
}

export interface MascotReader {
  mascot(): Promise<Mascot>;
}

export class AvatarSync {
  /** SVG currently shown as the profile picture (null until the first successful upload). */
  private syncedSvg: string | null = null;
  private lastAttemptMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly chain: MascotReader,
    private readonly updater: AvatarUpdater,
    private readonly now: () => number = Date.now,
  ) {}

  async tick(): Promise<void> {
    const now = this.now();
    if (now - this.lastAttemptMs < AVATAR_MIN_INTERVAL_MS) return;
    const { svg, cycle } = await this.chain.mascot();
    if (svg === this.syncedSvg) return;
    this.lastAttemptMs = now;
    if (await this.updater.update(renderPng(svg))) {
      this.syncedSvg = svg;
      log.info("profile picture updated to the live mascot", { cycle });
    } else {
      log.warn("profile picture not updated, will retry", { cycle });
    }
  }
}
