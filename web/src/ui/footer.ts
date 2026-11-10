// Footer: contract, immutable parameters, rules, links.
import { escapeHtml, memoRender } from "../dom";
import type { AppConfig } from "../config";
import type { Config } from "../contract/types";
import { formatBps, formatMolt, formatNsDuration, nsToMs } from "../format";

export interface FooterData {
  app: AppConfig;
  config: Config | null;
}

export interface Footer {
  render(data: FooterData): void;
}

const BPS_PER_UNIT = 10_000;

const RULES = [
  "The whole $MOLT supply is minted once. Nothing ever mints again.",
  "Holders burn $MOLT to change one of the mascot's 6 traits. Each change to the same slot in a cycle costs more.",
  "When a cycle ends, its final look is frozen into an NFT skin and auctioned in $MOLT.",
  "Part of the winning bid is burned; the rest is shared pro-rata by the cycle's sculptors. No bid: the top sculptor gets the skin.",
  "Storage is prepaid by callers: the first sculptor of a cycle pays the skin's storage (≈0.074 NEAR), new sculptors ≈0.004 NEAR.",
  "No admin, no pause, no upgrade. Anyone can call molt() to advance time.",
];

function parameters(config: Config): string {
  const rows: Array<[string, string]> = [
    ["Initial holder", escapeHtml(config.initial_holder)],
    ["Total supply", `${formatMolt(config.total_supply, 0)} MOLT`],
    ["Airdrop pool / per account", `${formatMolt(config.airdrop_pool, 0)} / ${formatMolt(config.airdrop_amount)} MOLT`],
    ["Genesis", new Date(nsToMs(config.genesis_ns)).toLocaleString()],
    ["Cycle duration", formatNsDuration(config.cycle_duration_ns)],
    ["Auction duration", formatNsDuration(config.auction_duration_ns)],
    ["Anti-snipe window", formatNsDuration(config.anti_snipe_ns)],
    ["Base transform price", `${formatMolt(config.base_transform_price)} MOLT`],
    ["Price growth per change", `×${config.price_growth_bps / BPS_PER_UNIT}`],
    ["Min bid", `${formatMolt(config.min_bid)} MOLT`],
    ["Min bid increment", formatBps(config.min_bid_increment_bps)],
    ["Auction burn", formatBps(config.auction_burn_bps)],
  ];
  return `<dl class="facts params">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

export function createFooter(root: HTMLElement): Footer {
  return {
    render: memoRender(({ app, config }: FooterData) => {
      // A custom RPC (e.g. local sandbox) has no public explorer.
      const contract = app.readOnly
        ? `${escapeHtml(app.contractId)} via custom RPC ${escapeHtml(app.nodeUrl)}`
        : `<a href="${escapeHtml(`${app.explorerUrl}/address/${encodeURIComponent(app.contractId)}`)}">${escapeHtml(app.contractId)}</a> on ${app.network}`;
      const repoLinks = app.repoUrl
        ? ` · <a href="${escapeHtml(app.repoUrl)}#readme">README</a>
           · <a href="${escapeHtml(app.repoUrl)}/blob/main/docs/design.md">Full rules</a>`
        : "";
      root.innerHTML = `
        <div class="footer-col">
          <h2 class="tape">Rules</h2>
          <ol class="rules">${RULES.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ol>
          <p class="small">Contract ${contract}${repoLinks}</p>
        </div>
        <div class="footer-col">
          <h2 class="tape">No admin key — parameters from config()</h2>
          ${config ? parameters(config) : `<p class="placeholder">config() not loaded.</p>`}
        </div>`;
    }),
  };
}
