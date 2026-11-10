// Live mascot, cycle clock, molt trigger, and the sculpt preview next to it.
import { actionTarget, escapeHtml, memoRender, svgImage } from "../dom";
import type { Mascot, Slot } from "../contract/types";
import type { ErrorReport } from "../errors";
import { formatAccount, formatMolt } from "../format";
import { countdownHtml } from "./countdown";

export interface HeroData {
  mascot: Mascot;
  canSign: boolean;
}

export interface PreviewData {
  slot: Slot;
  variantName: string;
  price: string;
  /** null while the preview SVG is loading. */
  svg: string | null;
}

export interface HeroPanel {
  render(data: HeroData): void;
  renderPreview(preview: PreviewData | null): void;
  renderUnavailable(report: ErrorReport, retrySeconds: number): void;
}

function moltControls(mascot: Mascot, canSign: boolean): string {
  if (!mascot.molt_pending) {
    return `<p class="hero-clock">Molts in ${countdownHtml(mascot.cycle_ends_at_ns, "now")}</p>`;
  }
  return `
    <p class="badge badge-alert">Molt pending</p>
    <p class="muted">The cycle is over. Anyone can close it: the look freezes into a skin and its auction opens.</p>
    <button class="btn btn-primary" data-action="molt" ${canSign ? "" : "disabled"}>Trigger molt</button>
    ${canSign ? "" : `<p class="muted small">Sign in to trigger it.</p>`}`;
}

function renderMascot(root: HTMLElement, { mascot, canSign }: HeroData): void {
  const top = mascot.top_sculptor
    ? `${escapeHtml(formatAccount(mascot.top_sculptor.account_id))} (${formatMolt(mascot.top_sculptor.burned)} MOLT)`
    : "nobody yet";
  root.innerHTML = `
    <figure class="mascot-frame">
      ${svgImage(mascot.svg, `MOLT mascot, cycle ${mascot.cycle}`, "mascot-img")}
      <figcaption class="stamp">Live</figcaption>
    </figure>
    <div class="hero-meta">
      <p class="kicker">Cycle</p>
      <p class="hero-cycle">#${mascot.cycle}</p>
      ${moltControls(mascot, canSign)}
      <dl class="facts">
        <dt>Burned this cycle</dt><dd>${formatMolt(mascot.cycle_burned)} MOLT</dd>
        <dt>Top sculptor</dt><dd>${top}</dd>
      </dl>
    </div>`;
}

function renderPreview(root: HTMLElement, preview: PreviewData | null): void {
  root.classList.toggle("is-active", preview !== null);
  if (!preview) {
    root.innerHTML = `<p class="placeholder">Hover a variant below to preview it here.</p>`;
    return;
  }
  const image = preview.svg
    ? svgImage(preview.svg, `Preview: ${preview.slot} set to ${preview.variantName}`, "mascot-img")
    : `<div class="mascot-img loading">rendering…</div>`;
  root.innerHTML = `
    <figure class="mascot-frame preview-frame">
      ${image}
      <figcaption class="stamp stamp-alt">Preview</figcaption>
    </figure>
    <p class="preview-caption">${escapeHtml(preview.slot)} → <strong>${escapeHtml(preview.variantName)}</strong>
      <span class="muted">· burns ${formatMolt(preview.price)} MOLT</span></p>`;
}

export function createHeroPanel(live: HTMLElement, previewRoot: HTMLElement, onMolt: () => void): HeroPanel {
  live.addEventListener("click", (event) => {
    if (actionTarget(event, live)?.dataset["action"] === "molt") onMolt();
  });
  const drawMascot = memoRender((data: HeroData) => renderMascot(live, data));
  const drawPreview = memoRender((preview: PreviewData | null) => renderPreview(previewRoot, preview));
  drawPreview(null);

  return {
    render: drawMascot,
    renderPreview: drawPreview,
    renderUnavailable(report, retrySeconds) {
      drawMascot.reset();
      live.innerHTML = `
        <div class="unavailable">
          <p class="badge badge-alert">${escapeHtml(report.title)}</p>
          <p>${escapeHtml(report.detail)}</p>
          <p class="muted small">Retrying every ${retrySeconds} s.</p>
        </div>`;
    },
  };
}
