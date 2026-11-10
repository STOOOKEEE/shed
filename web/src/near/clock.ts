// Chain time: countdowns follow the block clock, not the browser clock
// (a sandbox fast-forwards, a laptop clock can be skewed).

const NS_PER_MS = 1_000_000n;

let offsetNs = 0n;

/** Records the latest final block timestamp (ns) as "now" on chain. */
export function syncChainClock(chainNowNs: string): void {
  offsetNs = BigInt(chainNowNs) - BigInt(Date.now()) * NS_PER_MS;
}

/** Current chain time in milliseconds, extrapolated from the last sync. */
export function chainNowMs(): number {
  return Date.now() + Number(offsetNs / NS_PER_MS);
}
