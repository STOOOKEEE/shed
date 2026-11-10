// Number, amount and time formatting. Amounts are bigint-exact.

const MOLT_DECIMALS = 18;
const YOCTO_PER_MOLT = 10n ** BigInt(MOLT_DECIMALS);
const DEFAULT_FRACTION_DIGITS = 2;
const NS_PER_MS = 1_000_000n;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const BPS_PER_PERCENT = 100;

export class AmountInputError extends Error {
  override name = "AmountInputError";
}

/** yocto-MOLT → "1,500.25" (truncated, never rounded up). */
export function formatMolt(yocto: string | bigint, fractionDigits = DEFAULT_FRACTION_DIGITS): string {
  const value = BigInt(yocto);
  const abs = value < 0n ? -value : value;
  const sign = value < 0n ? "-" : "";
  const whole = (abs / YOCTO_PER_MOLT).toLocaleString("en-US");
  const fraction = (abs % YOCTO_PER_MOLT)
    .toString()
    .padStart(MOLT_DECIMALS, "0")
    .slice(0, fractionDigits)
    .replace(/0+$/, "");
  if (abs > 0n && whole === "0" && fraction === "") return `${sign}<0.${"0".repeat(Math.max(fractionDigits - 1, 0))}1`;
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** "1,500.5" (MOLT units, user input) → yocto-MOLT. */
export function parseMolt(input: string): bigint {
  const cleaned = input.trim().replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) throw new AmountInputError("Enter an amount like 1500 or 1500.5");
  const [, whole = "0", fraction = ""] = match;
  if (fraction.length > MOLT_DECIMALS) throw new AmountInputError(`At most ${MOLT_DECIMALS} decimals.`);
  return BigInt(whole) * YOCTO_PER_MOLT + BigInt(fraction.padEnd(MOLT_DECIMALS, "0"));
}

const NEAR_DECIMALS = 24;
const YOCTO_PER_NEAR = 10n ** BigInt(NEAR_DECIMALS);
const NEAR_FRACTION_DIGITS = 3;

/** yoctoNEAR → "0.074" (rounded up so a prepayment is never understated). */
export function formatNear(yocto: string | bigint): string {
  const step = 10n ** BigInt(NEAR_DECIMALS - NEAR_FRACTION_DIGITS);
  const rounded = ((BigInt(yocto) + step - 1n) / step) * step;
  const whole = rounded / YOCTO_PER_NEAR;
  const fraction = (rounded % YOCTO_PER_NEAR).toString().padStart(NEAR_DECIMALS, "0").slice(0, NEAR_FRACTION_DIGITS);
  return `${whole}.${fraction}`.replace(/\.?0+$/, "");
}

/** Approximate MOLT value as a float, for charts only. */
export function moltToNumber(yocto: bigint): number {
  return Number(yocto / 10n ** 12n) / 1e6;
}

export function nsToMs(ns: string): number {
  return Number(BigInt(ns) / NS_PER_MS);
}

/** 93784s → "1d 02h 03m 04s"; leading zero units are dropped. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / SECONDS_PER_DAY);
  const hours = Math.floor((s % SECONDS_PER_DAY) / SECONDS_PER_HOUR);
  const minutes = Math.floor((s % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = s % SECONDS_PER_MINUTE;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

export function formatNsDuration(ns: string): string {
  return formatDuration(nsToMs(ns) / MS_PER_SECOND);
}

/** Remaining time until a nanosecond timestamp, or null once it has passed. */
export function countdown(endsAtNs: string, nowMs: number): string | null {
  const remainingMs = nsToMs(endsAtNs) - nowMs;
  return remainingMs > 0 ? formatDuration(remainingMs / MS_PER_SECOND) : null;
}

export function timeAgo(atNs: string, nowMs: number): string {
  const seconds = (nowMs - nsToMs(atNs)) / MS_PER_SECOND;
  return seconds < SECONDS_PER_MINUTE ? "just now" : `${formatDuration(seconds).split(" ")[0]} ago`;
}

export function formatBps(bps: number): string {
  return `${bps / BPS_PER_PERCENT}%`;
}

/** part / whole as "12.34%" using exact integer math (truncated). */
export function formatShare(part: bigint, whole: bigint, fractionDigits = DEFAULT_FRACTION_DIGITS): string {
  if (whole === 0n) return "0%";
  const unit = 10 ** fractionDigits;
  const scaled = (part * 100n * BigInt(unit)) / whole;
  return `${(Number(scaled) / unit).toFixed(fractionDigits)}%`;
}

const IMPLICIT_ACCOUNT_LENGTH = 64;
const SHORT_HEAD = 6;
const SHORT_TAIL = 4;

/** Shortens 64-char implicit accounts; named accounts are kept as-is. */
export function formatAccount(accountId: string): string {
  return accountId.length >= IMPLICIT_ACCOUNT_LENGTH
    ? `${accountId.slice(0, SHORT_HEAD)}…${accountId.slice(-SHORT_TAIL)}`
    : accountId;
}
