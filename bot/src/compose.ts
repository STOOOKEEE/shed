// Post texts. English, factual numbers, always within X's 280 weighted characters.

import { capitalize, formatMolt, formatUtc, shortAccount, X_MAX_WEIGHT, X_URL_WEIGHT, xWeight } from "./format.js";
import type { CatalogSlot, JournalEntry, Skin } from "./types.js";

const BPS_PER_PERCENT = 100;
const BULLET = "• ";

export interface ComposeContext {
  publicUrl: string | null;
}

/** Appends the optional link and checks the X length budget. */
function finish(body: string, ctx: ComposeContext): string {
  const text = ctx.publicUrl ? `${body}\n\n${ctx.publicUrl}` : body;
  if (bodyBudget(ctx) < xWeight(body)) throw new Error(`post too long (${xWeight(body)} > ${bodyBudget(ctx)})`);
  return text;
}

/** Weighted characters left for the body once the link (counted as a t.co URL) is reserved. */
function bodyBudget(ctx: ComposeContext): number {
  const separator = "\n\n".length;
  return ctx.publicUrl ? X_MAX_WEIGHT - separator - X_URL_WEIGHT : X_MAX_WEIGHT;
}

export function variantName(catalog: readonly CatalogSlot[], slot: string, variant: number): string {
  return catalog.find((entry) => entry.slot === slot)?.variants[variant] ?? `#${variant}`;
}

export function composeMolt(entry: JournalEntry, skin: Skin, auctionBurnBps: number, ctx: ComposeContext): string {
  const burnPercent = auctionBurnBps / BPS_PER_PERCENT;
  const lines = [
    `🦞 Cycle ${entry.cycle} is over. Skin #${skin.skin_id} is frozen and up for auction.`,
    "",
    `${formatMolt(entry.amount)} $MOLT burned to sculpt this look.`,
    `Bids in $MOLT close ${formatUtc(skin.auction.ends_at_ns)}. ${burnPercent}% of the winning bid burns.`,
  ];
  return finish(lines.join("\n"), ctx);
}

export function composeSettle(entry: JournalEntry, skin: Skin, ctx: ComposeContext): string {
  const owner = shortAccount(entry.account_id ?? skin.owner_id);
  const amount = BigInt(entry.amount);
  if (amount === 0n) {
    return finish(
      `🦞 No bids on Skin #${skin.skin_id} (cycle ${skin.cycle}). It goes to its top sculptor, ${owner}, for free.`,
      ctx,
    );
  }
  const burned = BigInt(entry.burned);
  const lines = [`🔨 Skin #${skin.skin_id} (cycle ${skin.cycle}) sold to ${owner} for ${formatMolt(amount)} $MOLT.`, ""];
  if (burned > 0n) lines.push(`🔥 ${formatMolt(burned)} $MOLT burned forever.`);
  if (amount > burned) lines.push(`${formatMolt(amount - burned)} $MOLT goes to the cycle's sculptors.`);
  return finish(lines.join("\n"), ctx);
}

function describeTransform(entry: JournalEntry, catalog: readonly CatalogSlot[]): string {
  const who = shortAccount(entry.account_id ?? "someone");
  if (entry.slot === null || entry.variant === null) return `${BULLET}${who} reshaped the lobster`;
  return `${BULLET}${who}: ${capitalize(entry.slot)} → ${variantName(catalog, entry.slot, entry.variant)}`;
}

/**
 * Summary of the transforms since the last batch post. When too long, the oldest change lines
 * are folded into "…N earlier" until the text fits.
 */
export function composeBatch(
  transforms: readonly JournalEntry[],
  catalog: readonly CatalogSlot[],
  faceOwner: string | null,
  ctx: ComposeContext,
): string {
  if (transforms.length === 0) throw new Error("composeBatch needs at least one transform");
  const total = transforms.reduce((sum, entry) => sum + BigInt(entry.burned), 0n);
  const count = transforms.length;
  const header = `🦞 The lobster is shedding. ${count} change${count === 1 ? "" : "s"} since the last update:`;
  const footer = [`🔥 ${formatMolt(total)} $MOLT burned.`];
  if (faceOwner) footer.push(`Face NFT now held by ${shortAccount(faceOwner)}.`);
  const changes = transforms.map((entry) => describeTransform(entry, catalog));

  for (let shown = changes.length; shown >= 0; shown -= 1) {
    const hidden = changes.length - shown;
    const list = hidden > 0 ? [`${BULLET}…${hidden} earlier`, ...changes.slice(hidden)] : changes;
    const body = [header, "", ...list, "", ...footer].join("\n");
    if (xWeight(body) <= bodyBudget(ctx)) return finish(body, ctx);
  }
  return finish([header, "", ...footer].join("\n"), ctx);
}
