// Text formatting shared by post templates: amounts, accounts, times, X length counting.

const MOLT_DECIMALS = 18n;
const YOCTO_PER_MOLT = 10n ** MOLT_DECIMALS;
const NS_PER_MS = 1_000_000n;
const THOUSANDS_GROUP = /\B(?=(\d{3})+(?!\d))/g;
const MAX_ACCOUNT_CHARS = 28;
const ACCOUNT_HEAD_CHARS = 14;
const ACCOUNT_TAIL_CHARS = 10;

/** X counts every link as this many characters (t.co wrapping). */
export const X_URL_WEIGHT = 23;
export const X_MAX_WEIGHT = 280;
/**
 * twitter-text v3 weighting: code points in these ranges weigh 1, everything else
 * (CJK, emoji, …) weighs 2.
 */
const LIGHT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

/** yocto-MOLT → whole MOLT with thousands separators ("12,345"); "<1" for dust. */
export function formatMolt(yocto: string | bigint): string {
  const value = BigInt(yocto);
  const whole = value / YOCTO_PER_MOLT;
  if (whole === 0n && value > 0n) return "<1";
  return whole.toString().replace(THOUSANDS_GROUP, ",");
}

/** Keeps long (e.g. implicit 64-hex) account ids readable: "0123456789abcd…6789abcdef". */
export function shortAccount(accountId: string): string {
  if (accountId.length <= MAX_ACCOUNT_CHARS) return accountId;
  return `${accountId.slice(0, ACCOUNT_HEAD_CHARS)}…${accountId.slice(-ACCOUNT_TAIL_CHARS)}`;
}

/** Nanosecond timestamp → "2026-11-03 14:05 UTC". */
export function formatUtc(ns: string | bigint): string {
  const iso = new Date(Number(BigInt(ns) / NS_PER_MS)).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Post length as X counts it, for text that contains no URL. */
export function xWeight(text: string): number {
  let weight = 0;
  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0) ?? 0;
    weight += LIGHT_RANGES.some(([lo, hi]) => code >= lo && code <= hi) ? 1 : 2;
  }
  return weight;
}
