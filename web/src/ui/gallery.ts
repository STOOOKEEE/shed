// Every minted skin, newest first, with the signed-in sculptor's claimable share.
import { actionTarget, escapeHtml, memoRender, svgImage } from "../dom";
import { formatAccount, formatMolt } from "../format";
import type { GalleryData } from "../store";
import type { Skin } from "../contract/types";

export interface GalleryViewData {
  gallery: GalleryData;
  accountId: string | null;
}

export interface GalleryHandlers {
  onPage(page: number): void;
  onClaim(skinId: number): void;
}

export interface GalleryPanel {
  render(data: GalleryViewData): void;
}

function claimLine(skin: Skin, claimable: string | undefined): string {
  if (claimable === undefined || BigInt(claimable) === 0n) return "";
  return `
    <div class="claim">
      <span>Your sculptor share: <strong>${formatMolt(claimable)} MOLT</strong></span>
      <button type="button" class="btn btn-primary" data-action="claim" data-skin-id="${skin.skin_id}">Claim</button>
    </div>`;
}

function card(skin: Skin, data: GalleryViewData): string {
  const status = skin.auction.settled
    ? `<span class="badge">Settled</span>`
    : `<span class="badge badge-live">On auction</span>`;
  const mine = data.accountId === skin.owner_id ? ` <span class="badge badge-live">yours</span>` : "";
  return `
    <article class="card card-small">
      ${svgImage(skin.svg, `Skin #${skin.skin_id}`, "card-img")}
      <div class="card-body">
        <h3>#${skin.skin_id} <small class="muted">cycle ${skin.cycle}</small></h3>
        <p>${status}${mine}</p>
        <p class="small">Owner: ${escapeHtml(formatAccount(skin.owner_id))}</p>
        ${claimLine(skin, data.gallery.claimable[skin.skin_id])}
      </div>
    </article>`;
}

function pager({ page, pageCount }: GalleryData): string {
  if (pageCount <= 1) return "";
  return `
    <nav class="pager" aria-label="Skins pages">
      <button type="button" class="btn" data-action="page" data-page="${page - 1}" ${page === 0 ? "disabled" : ""}>← Newer</button>
      <span>Page ${page + 1} / ${pageCount}</span>
      <button type="button" class="btn" data-action="page" data-page="${page + 1}" ${page + 1 >= pageCount ? "disabled" : ""}>Older →</button>
    </nav>`;
}

export function createGalleryPanel(root: HTMLElement, handlers: GalleryHandlers): GalleryPanel {
  root.addEventListener("click", (event) => {
    const target = actionTarget(event, root);
    if (!target) return;
    if (target.dataset["action"] === "page") handlers.onPage(Number(target.dataset["page"]));
    if (target.dataset["action"] === "claim") handlers.onClaim(Number(target.dataset["skinId"]));
  });

  return {
    render: memoRender((data: GalleryViewData) => {
      root.innerHTML = data.gallery.skins.length
        ? `<div class="cards cards-small">${data.gallery.skins.map((s) => card(s, data)).join("")}</div>${pager(data.gallery)}`
        : `<p class="placeholder">No skin yet. The first one is minted when the first sculpted cycle molts.</p>`;
    }),
  };
}
