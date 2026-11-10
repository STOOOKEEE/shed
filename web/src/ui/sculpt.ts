// Trait picker: one row per slot, hover to preview, confirm to burn.
import { actionTarget, escapeHtml, memoRender } from "../dom";
import type { CatalogEntry, Mascot, Slot } from "../contract/types";
import { SLOTS } from "../contract/types";
import { formatMolt, formatNear } from "../format";

export interface SculptData {
  catalog: CatalogEntry[];
  mascot: Mascot;
  /** Signed-in balance (yocto), null when signed out. */
  balance: string | null;
  /** yoctoNEAR deposit the next transform needs, null when signed out. */
  transformDeposit: string | null;
  canSign: boolean;
}

export interface Choice {
  slot: Slot;
  variant: number;
}

export interface SculptHandlers {
  onPreview(choice: Choice | null): void;
  onTransform(choice: Choice): void;
}

export interface SculptPanel {
  render(data: SculptData): void;
}

function readChoice(el: HTMLElement): Choice | null {
  const slot = SLOTS.find((s) => s === el.dataset["slot"]);
  const variant = Number(el.dataset["variant"]);
  return slot && Number.isInteger(variant) ? { slot, variant } : null;
}

function slotRow(entry: CatalogEntry, mascot: Mascot, selected: Choice | null): string {
  const current = mascot.genome[entry.slot];
  const changes = mascot.slot_changes[entry.slot];
  const buttons = entry.variants
    .map((name, variant) => {
      const isCurrent = variant === current;
      const isSelected = selected?.slot === entry.slot && selected.variant === variant;
      const classes = ["variant", isCurrent ? "is-current" : "", isSelected ? "is-selected" : ""].join(" ");
      return `<button type="button" class="${classes}" data-action="select" data-slot="${entry.slot}"
        data-variant="${variant}" aria-pressed="${isSelected}" ${isCurrent ? "disabled title=\"Current look\"" : ""}>
        ${escapeHtml(name)}</button>`;
    })
    .join("");
  return `
    <div class="slot-row">
      <div class="slot-head">
        <h3>${entry.slot}</h3>
        <span class="price">${formatMolt(mascot.slot_prices[entry.slot])} MOLT</span>
        <span class="muted small">${changes} change${changes === 1 ? "" : "s"} this cycle</span>
      </div>
      <div class="variants">${buttons}</div>
    </div>`;
}

const ONE_YOCTO = 1n;

/** Explains a storage prepayment above the 1 yocto security deposit. */
function depositNote(data: SculptData): string {
  if (data.transformDeposit === null || BigInt(data.transformDeposit) <= ONE_YOCTO) return "";
  const reason = BigInt(data.mascot.cycle_burned) === 0n
    ? "first change of this cycle pays for the skin"
    : "new sculptor this cycle";
  return `<span class="muted small">+${formatNear(data.transformDeposit)} NEAR storage prepayment — ${reason}</span>`;
}

function confirmBar(data: SculptData, selected: Choice): string {
  const entry = data.catalog.find((c) => c.slot === selected.slot);
  const name = entry?.variants[selected.variant] ?? `#${selected.variant}`;
  const price = data.mascot.slot_prices[selected.slot];
  const blocker = !data.canSign
    ? "Sign in to sculpt."
    : data.balance !== null && BigInt(data.balance) < BigInt(price)
      ? "Not enough MOLT for this burn."
      : null;
  return `
    <div class="confirm-bar">
      <p>Burn <strong>${formatMolt(price)} MOLT</strong> to set ${escapeHtml(selected.slot)} →
        <strong>${escapeHtml(name)}</strong>${blocker ? ` <span class="warn">${blocker}</span>` : ""}</p>
      <div class="row">
        ${depositNote(data)}
        <button type="button" class="btn btn-primary" data-action="confirm" ${blocker ? "disabled" : ""}>Confirm burn</button>
        <button type="button" class="btn" data-action="cancel">Cancel</button>
      </div>
    </div>`;
}

export function createSculptPanel(root: HTMLElement, handlers: SculptHandlers): SculptPanel {
  let data: SculptData | null = null;
  let selected: Choice | null = null;

  const draw = memoRender((view: { data: SculptData; selected: Choice | null }) => {
    root.innerHTML = `
      <p class="muted">Price grows with every change to the same slot this cycle. Everything you burn counts as
        your contribution to the cycle's skin.</p>
      ${view.data.catalog.map((entry) => slotRow(entry, view.data.mascot, view.selected)).join("")}
      ${view.selected ? confirmBar(view.data, view.selected) : ""}`;
  });

  function redraw(): void {
    if (!data) return;
    // A selection that became the current look (someone else sculpted it) is moot.
    if (selected && data.mascot.genome[selected.slot] === selected.variant) {
      selected = null;
      handlers.onPreview(null);
    }
    draw({ data, selected });
  }

  root.addEventListener("click", (event) => {
    const target = actionTarget(event, root);
    const action = target?.dataset["action"];
    if (!target || !action) return;
    if (action === "select") {
      selected = readChoice(target);
      handlers.onPreview(selected);
    } else if (action === "cancel") {
      selected = null;
      handlers.onPreview(null);
    } else if (action === "confirm" && selected) {
      handlers.onTransform(selected);
    }
    redraw();
  });

  root.addEventListener("mouseover", (event) => {
    const target = actionTarget(event, root);
    if (target?.dataset["action"] === "select") handlers.onPreview(readChoice(target));
  });
  root.addEventListener("mouseleave", () => handlers.onPreview(selected));

  return {
    render(next) {
      data = next;
      redraw();
    },
  };
}
