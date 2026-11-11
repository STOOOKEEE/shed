// Supply figures and a cumulative-burn chart rebuilt from the journal.
import { memoRender } from "../dom";
import type { JournalEntry, Stats } from "../contract/types";
import { formatShed, formatShare, shedToNumber, nsToMs } from "../format";
import { chainNowMs } from "../near/clock";

export interface SupplyData {
  stats: Stats;
  journal: JournalEntry[];
}

export interface SupplyPanel {
  render(data: SupplyData): void;
}

interface BurnPoint {
  atMs: number;
  cumulative: bigint;
}

/** Early burns are tiny relative to the supply: show enough digits to see them move. */
const BURNED_SHARE_DIGITS = 4;
const CHART_WIDTH = 600;
const CHART_HEIGHT = 160;
const CHART_PADDING = 8;

/**
 * The journal is a window of recent events, newest first. Walking it backwards from the
 * current total burn gives the exact cumulative burn after each event in that window.
 */
function burnSeries(journal: JournalEntry[], totalBurned: bigint): BurnPoint[] {
  const burns = journal.filter((e) => BigInt(e.burned) > 0n);
  const points: BurnPoint[] = [];
  let cumulative = totalBurned;
  for (const entry of burns) {
    points.push({ atMs: nsToMs(entry.at_ns), cumulative });
    cumulative -= BigInt(entry.burned);
  }
  const oldest = burns.at(-1);
  if (oldest) points.push({ atMs: nsToMs(oldest.at_ns) - 1, cumulative });
  points.reverse();
  // Extend the line to "now" so the chart ends at the present.
  const last = points.at(-1);
  if (last) points.push({ atMs: Math.max(chainNowMs(), last.atMs), cumulative: last.cumulative });
  return points;
}

function chart(points: BurnPoint[]): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || points.length < 3) {
    return `<p class="placeholder">No burn recorded yet.</p>`;
  }
  const maxValue = shedToNumber(last.cumulative) || 1;
  const span = last.atMs - first.atMs || 1;
  const x = (ms: number) => CHART_PADDING + ((ms - first.atMs) / span) * (CHART_WIDTH - 2 * CHART_PADDING);
  const y = (v: bigint) => CHART_HEIGHT - CHART_PADDING - (shedToNumber(v) / maxValue) * (CHART_HEIGHT - 2 * CHART_PADDING);

  // Step line: burn happens at discrete events.
  let path = `M${x(first.atMs).toFixed(1)},${y(first.cumulative).toFixed(1)}`;
  for (const p of points.slice(1)) path += ` H${x(p.atMs).toFixed(1)} V${y(p.cumulative).toFixed(1)}`;
  const baseline = CHART_HEIGHT - CHART_PADDING;
  const area = `${path} V${baseline} H${x(first.atMs).toFixed(1)} Z`;
  const from = new Date(first.atMs).toLocaleString();

  return `
    <figure class="chart">
      <svg viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="Cumulative SHED burned over time">
        <path class="chart-area" d="${area}" />
        <path class="chart-line" d="${path}" />
      </svg>
      <figcaption class="small muted">Cumulative burn since ${from}: ${formatShed(first.cumulative)} → ${formatShed(last.cumulative)} SHED</figcaption>
    </figure>`;
}

function render(root: HTMLElement, { stats, journal }: SupplyData): void {
  const initial = BigInt(stats.initial_supply);
  const current = BigInt(stats.total_supply);
  const burned = initial - current;
  const byTransform = BigInt(stats.burned_by_transform);
  const byAuction = BigInt(stats.burned_by_auction);
  const transformShare = formatShare(byTransform, burned);

  root.innerHTML = `
    <p class="big-number">${formatShare(burned, initial, BURNED_SHARE_DIGITS)} <small>of supply burned</small></p>
    <dl class="facts">
      <dt>Initial supply</dt><dd>${formatShed(initial, 0)} SHED</dd>
      <dt>Current supply</dt><dd>${formatShed(current, 0)} SHED</dd>
      <dt>Burned by sculpting</dt><dd>${formatShed(byTransform)} SHED</dd>
      <dt>Burned by auctions</dt><dd>${formatShed(byAuction)} SHED</dd>
      <dt>Skins minted</dt><dd>${stats.skins_minted}</dd>
      <dt>Airdrop left</dt><dd>${formatShed(stats.airdrop_remaining, 0)} SHED</dd>
    </dl>
    <div class="burn-split" aria-label="Burn split">
      <span class="burn-transform" style="width:${burned > 0n ? transformShare : "0%"}"></span>
    </div>
    <p class="small muted"><span class="dot dot-transform"></span> sculpting ${transformShare}
      <span class="dot dot-auction"></span> auctions ${formatShare(byAuction, burned)}</p>
    ${chart(burnSeries(journal, burned))}`;
}

export function createSupplyPanel(root: HTMLElement): SupplyPanel {
  return { render: memoRender((data: SupplyData) => render(root, data)) };
}
