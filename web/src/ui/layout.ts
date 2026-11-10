// Static page skeleton; panels render into the returned containers.
import { escapeHtml, requireElement } from "../dom";
import type { ErrorReport } from "../errors";

export interface Layout {
  walletBar: HTMLElement;
  banner: HTMLElement;
  toast: HTMLElement;
  heroLive: HTMLElement;
  heroPreview: HTMLElement;
  sculpt: HTMLElement;
  auctions: HTMLElement;
  gallery: HTMLElement;
  supply: HTMLElement;
  journal: HTMLElement;
  footer: HTMLElement;
}

const WAITING = `<p class="placeholder">Waiting for contract data…</p>`;

export function mountLayout(app: HTMLElement): Layout {
  app.innerHTML = `
    <header class="wallet-bar" id="wallet-bar"></header>
    <div class="banner" id="banner" role="alert" hidden></div>
    <div id="toast" role="status" aria-live="polite" hidden></div>
    <main>
      <section class="hero" aria-label="Live mascot">
        <div class="hero-live" id="hero-live">${WAITING}</div>
        <aside class="hero-preview" id="hero-preview"></aside>
      </section>
      <section class="panel" aria-labelledby="sculpt-title">
        <h2 id="sculpt-title" class="tape">Sculpt <small>burn $MOLT to change a trait</small></h2>
        <div id="sculpt">${WAITING}</div>
      </section>
      <section class="panel" aria-labelledby="auctions-title">
        <h2 id="auctions-title" class="tape">Auctions <small>skins of past cycles, bid in $MOLT</small></h2>
        <div id="auctions">${WAITING}</div>
      </section>
      <section class="panel" aria-labelledby="gallery-title">
        <h2 id="gallery-title" class="tape">Shed skins</h2>
        <div id="gallery">${WAITING}</div>
      </section>
      <div class="split">
        <section class="panel" aria-labelledby="supply-title">
          <h2 id="supply-title" class="tape">Supply</h2>
          <div id="supply">${WAITING}</div>
        </section>
        <section class="panel" aria-labelledby="journal-title">
          <h2 id="journal-title" class="tape">Journal</h2>
          <div id="journal">${WAITING}</div>
        </section>
      </div>
    </main>
    <footer class="footer" id="footer"></footer>`;

  const get = (id: string) => requireElement(app, `#${id}`, HTMLElement);
  return {
    walletBar: get("wallet-bar"),
    banner: get("banner"),
    toast: get("toast"),
    heroLive: get("hero-live"),
    heroPreview: get("hero-preview"),
    sculpt: get("sculpt"),
    auctions: get("auctions"),
    gallery: get("gallery"),
    supply: get("supply"),
    journal: get("journal"),
    footer: get("footer"),
  };
}

/** Shown when the app cannot even start (e.g. missing configuration). */
export function renderFatal(app: HTMLElement, report: ErrorReport): void {
  app.innerHTML = `
    <main class="fatal" role="alert">
      <p class="brand-mark">$MOLT</p>
      <p class="badge badge-alert">${escapeHtml(report.title)}</p>
      <p>${escapeHtml(report.detail)}</p>
    </main>`;
}
