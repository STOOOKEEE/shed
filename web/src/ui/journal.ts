// Human-readable log of the latest contract events.
import { escapeHtml, memoRender } from "../dom";
import type { CatalogEntry, JournalEntry } from "../contract/types";
import { formatAccount, formatMolt, timeAgo } from "../format";
import { chainNowMs } from "../near/clock";

const JOURNAL_DISPLAY_LIMIT = 50;

export interface JournalData {
  journal: JournalEntry[];
  catalog: CatalogEntry[];
}

export interface JournalPanel {
  render(data: JournalData): void;
}

function who(entry: JournalEntry): string {
  return `<strong>${escapeHtml(entry.account_id ? formatAccount(entry.account_id) : "someone")}</strong>`;
}

function variantName(entry: JournalEntry, catalog: CatalogEntry[]): string {
  if (entry.slot === null || entry.variant === null) return "?";
  const name = catalog.find((c) => c.slot === entry.slot)?.variants[entry.variant];
  return escapeHtml(name ?? `#${entry.variant}`);
}

function describe(entry: JournalEntry, catalog: CatalogEntry[]): string {
  const amount = `${formatMolt(entry.amount)} MOLT`;
  const skin = entry.skin_id === null ? "a skin" : `skin #${entry.skin_id}`;
  switch (entry.kind) {
    case "transform":
      return `${who(entry)} burned ${amount} → ${escapeHtml(entry.slot ?? "?")} = <em>${variantName(entry, catalog)}</em>`;
    case "molt":
      return entry.skin_id === null
        ? `Cycle ${entry.cycle} closed with no transformation`
        : `Cycle ${entry.cycle} molted into <strong>${skin}</strong> (${amount} burned during the cycle)`;
    case "bid":
      return `${who(entry)} bid ${amount} on ${skin}`;
    case "settle":
      return BigInt(entry.amount) === 0n
        ? `No bid on ${skin}: it goes to top sculptor ${who(entry)}`
        : `Skin #${entry.skin_id ?? "?"} sold to ${who(entry)} for ${amount}, ${formatMolt(entry.burned)} MOLT burned`;
    case "sculptor_claim":
      return `${who(entry)} claimed ${amount} sculptor share from ${skin}`;
    case "airdrop":
      return `${who(entry)} claimed the ${amount} airdrop`;
  }
}

export function createJournalPanel(root: HTMLElement): JournalPanel {
  return {
    render: memoRender(({ journal, catalog }: JournalData) => {
      const entries = journal.slice(0, JOURNAL_DISPLAY_LIMIT);
      root.innerHTML = entries.length
        ? `<ol class="journal">${entries
            .map(
              (e) => `<li class="journal-${e.kind}">
                <span class="journal-time">${timeAgo(e.at_ns, chainNowMs())}</span>
                <span>${describe(e, catalog)}</span></li>`,
            )
            .join("")}</ol>`
        : `<p class="placeholder">Nothing happened yet. Be the first to sculpt.</p>`;
    }),
  };
}
