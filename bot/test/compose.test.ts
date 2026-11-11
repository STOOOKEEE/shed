import assert from "node:assert/strict";
import { test } from "node:test";
import { composeBatch, composeShed, composeSettle, variantName } from "../src/compose.js";
import { formatShed, formatUtc, shortAccount, X_MAX_WEIGHT, X_URL_WEIGHT, xWeight } from "../src/format.js";
import type { CatalogSlot, JournalEntry, Skin } from "../src/types.js";

const SHED = 10n ** 18n;
const CATALOG: CatalogSlot[] = [
  { slot: "eyes", variants: ["Round", "Sleepy", "Angry", "Googly", "Laser", "Dead"] },
  { slot: "headgear", variants: ["None", "Crown", "Party Hat"] },
];
const SKIN: Skin = {
  skin_id: 7,
  cycle: 3,
  svg: "<svg/>",
  owner_id: "shed.testnet",
  auction: { ends_at_ns: "1793715858137215975", settled: false },
};
const NO_LINK = { publicUrl: null };
const LINK = { publicUrl: "https://shed.example.com/a/very/long/path/that/x/counts/as/twenty-three" };

function entry(overrides: Partial<JournalEntry>): JournalEntry {
  return {
    kind: "transform",
    at_ns: "1",
    cycle: 3,
    account_id: "alice.testnet",
    amount: (10_000n * SHED).toString(),
    burned: (10_000n * SHED).toString(),
    skin_id: null,
    slot: "eyes",
    variant: 4,
    ...overrides,
  };
}

/** Weight as X counts it: the trailing link weighs 23. */
function postWeight(text: string, link: string | null): number {
  return link ? xWeight(text.slice(0, -link.length)) + X_URL_WEIGHT : xWeight(text);
}

test("amounts are whole SHED with thousands separators", () => {
  assert.equal(formatShed(0n), "0");
  assert.equal(formatShed(SHED / 2n), "<1");
  assert.equal(formatShed(999n * SHED + SHED - 1n), "999");
  assert.equal(formatShed(1_234_567n * SHED), "1,234,567");
  assert.equal(formatShed("1000000000000000000000000000"), "1,000,000,000");
});

test("helpers: utc time, account shortening, variant names, X weight", () => {
  assert.equal(formatUtc("1793715858137215975"), "2026-11-03 14:24 UTC");
  assert.equal(shortAccount("alice.near"), "alice.near");
  const implicit = "a".repeat(30) + "b".repeat(34);
  assert.equal(shortAccount(implicit), `${"a".repeat(14)}…${"b".repeat(10)}`);
  assert.equal(variantName(CATALOG, "eyes", 4), "Laser");
  assert.equal(variantName(CATALOG, "eyes", 99), "#99");
  assert.equal(xWeight("abc"), 3);
  assert.equal(xWeight("🦞"), 2);
});

test("shed post announces the frozen skin and the auction", () => {
  const text = composeShed(entry({ kind: "shed", amount: (20_000n * SHED).toString(), skin_id: 7 }), SKIN, 5000, NO_LINK);
  assert.match(text, /^🦞 Cycle 3 is over\. Skin #7 is frozen and up for auction\./);
  assert.match(text, /20,000 \$SHED burned/);
  assert.match(text, /close 2026-11-03 14:24 UTC\. 50% of the winning bid burns\./);
  assert.ok(xWeight(text) <= X_MAX_WEIGHT);
});

test("settle post: sold with burn and sculptor share", () => {
  const text = composeSettle(
    entry({ kind: "settle", account_id: "bob.testnet", amount: (6_000n * SHED).toString(), burned: (3_000n * SHED).toString(), skin_id: 7 }),
    SKIN,
    NO_LINK,
  );
  assert.match(text, /Skin #7 \(cycle 3\) sold to bob\.testnet for 6,000 \$SHED/);
  assert.match(text, /3,000 \$SHED burned forever/);
  assert.match(text, /3,000 \$SHED goes to the cycle's sculptors/);
});

test("settle post: no bid goes to the top sculptor", () => {
  const text = composeSettle(entry({ kind: "settle", account_id: "carol.testnet", amount: "0", burned: "0", skin_id: 7 }), SKIN, NO_LINK);
  assert.match(text, /No bids on Skin #7.*top sculptor, carol\.testnet, for free/);
  assert.doesNotMatch(text, /burned/);
});

test("batch post lists who changed what, total burned and face holder", () => {
  const text = composeBatch(
    [entry({}), entry({ account_id: "bob.testnet", slot: "headgear", variant: 1, burned: (15_000n * SHED).toString() })],
    CATALOG,
    "bob.testnet",
    NO_LINK,
  );
  assert.match(text, /2 changes since the last update/);
  assert.match(text, /• alice\.testnet: Eyes → Laser/);
  assert.match(text, /• bob\.testnet: Headgear → Crown/);
  assert.match(text, /25,000 \$SHED burned/);
  assert.match(text, /Face NFT now held by bob\.testnet/);
});

test("batch post folds old changes to stay within 280 weighted chars, link included", () => {
  const longName = `${"x".repeat(60)}.near`;
  const many = Array.from({ length: 40 }, (_, i) => entry({ account_id: i % 2 ? longName : "alice.testnet", at_ns: String(i + 1) }));
  for (const ctx of [NO_LINK, LINK]) {
    const text = composeBatch(many, CATALOG, longName, ctx);
    assert.ok(postWeight(text, ctx.publicUrl) <= X_MAX_WEIGHT, `weight ${postWeight(text, ctx.publicUrl)}`);
    assert.match(text, /40 changes/);
    assert.match(text, /…\d+ earlier/);
    assert.match(text, /400,000 \$SHED burned/);
    if (ctx.publicUrl) assert.ok(text.endsWith(`\n\n${ctx.publicUrl}`));
  }
});

test("every template fits with worst-case 64-char accounts and huge amounts", () => {
  const worst = "z".repeat(64);
  const huge = (10n ** 27n).toString();
  const texts = [
    composeShed(entry({ kind: "shed", amount: huge, skin_id: 4294967295 }), { ...SKIN, skin_id: 4294967295, cycle: 4294967295 }, 5000, LINK),
    composeSettle(entry({ kind: "settle", account_id: worst, amount: huge, burned: huge.slice(0, -1), skin_id: 1 }), SKIN, LINK),
    composeSettle(entry({ kind: "settle", account_id: worst, amount: "0", burned: "0", skin_id: 1 }), SKIN, LINK),
    composeBatch([entry({ account_id: worst, burned: huge })], CATALOG, worst, LINK),
  ];
  for (const text of texts) assert.ok(postWeight(text, LINK.publicUrl) <= X_MAX_WEIGHT, text);
});
