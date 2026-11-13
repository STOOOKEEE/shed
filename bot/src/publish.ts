// Where posts and profile pictures go: `out/` files in dry-run mode, the X API otherwise.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AvatarUpdater } from "./avatar.js";
import { log } from "./log.js";
import type { XClient } from "./x.js";

export type PostKind = "shed" | "settle" | "batch";

export interface Post {
  kind: PostKind;
  text: string;
  png: Buffer;
  /** Context for logs and dry-run files (cycle, skin id, …). */
  meta: Record<string, string | number | null>;
}

export interface Publisher {
  /** Resolves true when the post went out. Never throws for remote (X) failures. */
  publish(post: Post): Promise<boolean>;
}

/** Writes `<outDir>/<timestamp>-<n>-<kind>.json` and `.png`; never touches the network. */
export class DryRunPublisher implements Publisher {
  private sequence = 0;

  constructor(private readonly outDir: string) {}

  async publish(post: Post): Promise<boolean> {
    await mkdir(this.outDir, { recursive: true });
    this.sequence += 1;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `${stamp}-${String(this.sequence).padStart(3, "0")}-${post.kind}`;
    const pngPath = join(this.outDir, `${name}.png`);
    const jsonPath = join(this.outDir, `${name}.json`);
    await writeFile(pngPath, post.png);
    await writeFile(jsonPath, `${JSON.stringify({ kind: post.kind, text: post.text, meta: post.meta, png: `${name}.png` }, null, 2)}\n`);
    log.info("dry-run post written", { kind: post.kind, file: jsonPath, text: post.text, ...post.meta });
    return true;
  }
}

export class XPublisher implements Publisher {
  constructor(private readonly client: XClient) {}

  async publish(post: Post): Promise<boolean> {
    const mediaId = await this.client.uploadPng(post.png);
    if (mediaId === null) log.warn("posting without image after media upload failure", { kind: post.kind });
    const postId = await this.client.createPost(post.text, mediaId);
    if (postId === null) return false;
    log.info("posted to X", { kind: post.kind, post_id: postId, ...post.meta });
    return true;
  }
}

/** Overwrites `<outDir>/avatar.png`; never touches the network. */
export class DryRunAvatarUpdater implements AvatarUpdater {
  constructor(private readonly outDir: string) {}

  async update(png: Buffer): Promise<boolean> {
    await mkdir(this.outDir, { recursive: true });
    const path = join(this.outDir, "avatar.png");
    await writeFile(path, png);
    log.info("dry-run profile picture written", { file: path });
    return true;
  }
}

export class XAvatarUpdater implements AvatarUpdater {
  constructor(private readonly client: XClient) {}

  update(png: Buffer): Promise<boolean> {
    return this.client.updateProfileImage(png);
  }
}
