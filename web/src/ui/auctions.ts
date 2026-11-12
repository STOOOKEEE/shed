// Open auctions: one card per skin with a bid form.
import { actionTarget, escapeHtml, memoRender, svgImage } from "../dom";
import { formatAccount, formatBps, formatShed, nsToMs } from "../format";
import type { AuctionView } from "../store";
import { chainNowMs } from "../near/clock";
import { countdownHtml } from "./countdown";

export interface AuctionsData {
  auctions: AuctionView[];
  auctionBurnBps: number;
  canSign: boolean;
}

export interface AuctionsHandlers {
  onBid(skinId: number, amountText: string): void;
  onShed(): void;
}

export interface AuctionsPanel {
  render(data: AuctionsData): void;
}

interface CardView {
  view: AuctionView;
  ended: boolean;
}

function bidForm(view: AuctionView, canSign: boolean): string {
  const { auction } = view;
  return `
    <form class="bid-form" data-skin-id="${auction.skin_id}">
      <label class="sr-only" for="bid-${auction.skin_id}">Bid in SHED</label>
      <input id="bid-${auction.skin_id}" name="amount" inputmode="decimal" autocomplete="off"
        placeholder="${formatShed(auction.min_next_bid)}" ${canSign ? "" : "disabled"} />
      <button type="submit" class="btn btn-primary" ${canSign ? "" : "disabled"}>Bid</button>
    </form>
    ${canSign ? "" : `<p class="muted small">Sign in to bid.</p>`}`;
}

function card({ view, ended }: CardView, canSign: boolean): string {
  const { auction, skin } = view;
  const leader = auction.highest_bid && auction.highest_bidder
    ? `${formatShed(auction.highest_bid)} SHED <span class="muted">by ${escapeHtml(formatAccount(auction.highest_bidder))}</span>`
    : `<span class="muted">No bids yet — the top sculptor gets it for free</span>`;
  const action = ended
    ? `<p class="badge badge-alert">Ended — awaiting settlement</p>
       <button type="button" class="btn" data-action="shed" ${canSign ? "" : "disabled"}>Settle (shed)</button>`
    : bidForm(view, canSign);
  return `
    <article class="card">
      ${svgImage(skin.svg, `Skin #${skin.skin_id}`, "card-img")}
      <div class="card-body">
        <h3>Skin #${skin.skin_id} <small class="muted">cycle ${skin.cycle}</small></h3>
        <dl class="facts">
          <dt>Highest bid</dt><dd>${leader}</dd>
          <dt>Ends in</dt><dd>${countdownHtml(auction.ends_at_ns, "ended")}</dd>
          <dt>Min next bid</dt><dd>${formatShed(auction.min_next_bid)} SHED</dd>
        </dl>
        ${action}
      </div>
    </article>`;
}

export function createAuctionsPanel(root: HTMLElement, handlers: AuctionsHandlers): AuctionsPanel {
  const draw = memoRender((view: { cards: CardView[]; canSign: boolean; auctionBurnBps: number }) => {
    // Keep whatever the user was typing across refreshes.
    const typed = new Map<string, string>();
    root.querySelectorAll<HTMLInputElement>("input[name=amount]").forEach((input) => typed.set(input.id, input.value));

    root.innerHTML = view.cards.length
      ? `<p class="muted">Outbid tokens are refunded at once. Raising your own highest bid only escrows the difference. A bid near the end extends the auction.
           ${formatBps(view.auctionBurnBps)} of the winning bid is burned, the rest goes to the cycle's sculptors.</p>
         <div class="cards">${view.cards.map((c) => card(c, view.canSign)).join("")}</div>`
      : `<p class="placeholder">No open auction. A skin appears here when a cycle with at least one transformation sheds.</p>`;

    root.querySelectorAll<HTMLInputElement>("input[name=amount]").forEach((input) => {
      input.value = typed.get(input.id) ?? "";
    });
  });

  root.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const skinId = Number(form.dataset["skinId"]);
    const amount = form.elements.namedItem("amount");
    if (Number.isInteger(skinId) && amount instanceof HTMLInputElement) handlers.onBid(skinId, amount.value);
  });
  root.addEventListener("click", (event) => {
    if (actionTarget(event, root)?.dataset["action"] === "shed") handlers.onShed();
  });

  return {
    render(data) {
      const now = chainNowMs();
      draw({
        cards: data.auctions.map((view) => ({ view, ended: nsToMs(view.auction.ends_at_ns) <= now })),
        canSign: data.canSign,
        auctionBurnBps: data.auctionBurnBps,
      });
    },
  };
}
