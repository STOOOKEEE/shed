import "./style.css";
import { loadConfig, type AppConfig } from "./config";
import { requireElement } from "./dom";
import { describeError } from "./errors";
import { formatMolt, parseMolt } from "./format";
import { createRpc } from "./near/rpc";
import { createWallet, type WalletService } from "./near/wallet";
import { createStore, type AccountData, type GalleryData, type Snapshot } from "./store";
import { createAuctionsPanel } from "./ui/auctions";
import { startCountdownTicker } from "./ui/countdown";
import { createFooter } from "./ui/footer";
import { createGalleryPanel } from "./ui/gallery";
import { createHeroPanel } from "./ui/hero";
import { createJournalPanel } from "./ui/journal";
import { mountLayout, renderFatal } from "./ui/layout";
import { createSculptPanel, type Choice } from "./ui/sculpt";
import { createStatusPanel } from "./ui/status";
import { createSupplyPanel } from "./ui/supply";
import { createWalletBar } from "./ui/walletBar";

const REFRESH_SECONDS = 10;
const REFRESH_INTERVAL_MS = REFRESH_SECONDS * 1000;

function start(app: HTMLElement, cfg: AppConfig): void {
  const rpc = createRpc(cfg);
  const store = createStore(rpc);
  const layout = mountLayout(app);
  const status = createStatusPanel(layout.banner, layout.toast);

  let snapshot: Snapshot | null = null;
  let accountId: string | null = null;
  let account: AccountData | null = null;
  let gallery: GalleryData | null = null;
  let galleryPage = 0;
  let busy = false;

  const wallet: WalletService | null = cfg.readOnly
    ? null
    : createWallet(cfg, rpc, (next) => {
        accountId = next;
        account = null;
        renderAll();
        refresh();
      });

  // ---- Refresh loop -------------------------------------------------------

  let inFlight: Promise<void> | null = null;
  let queued = false;

  function refresh(): void {
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = loadAll().finally(() => {
      inFlight = null;
      if (queued) {
        queued = false;
        refresh();
      }
    });
  }

  async function loadAll(): Promise<void> {
    try {
      snapshot = await store.loadSnapshot();
      status.showError(null, REFRESH_SECONDS);
    } catch (error) {
      const report = describeError(error, cfg);
      // Without any data the hero shows the error; with stale data a banner flags it.
      if (snapshot) status.showError(report, REFRESH_SECONDS);
      else hero.renderUnavailable(report, REFRESH_SECONDS);
      renderAll();
      return;
    }
    // Account and gallery are secondary: a failure is reported but the main views stay live.
    const id = accountId;
    try {
      const [nextAccount, nextGallery] = await Promise.all([
        id ? store.loadAccount(id) : Promise.resolve(null),
        store.loadGallery(galleryPage, snapshot.stats.skins_minted, id),
      ]);
      account = nextAccount;
      gallery = nextGallery;
      galleryPage = nextGallery.page;
    } catch (error) {
      status.showError(describeError(error, cfg), REFRESH_SECONDS);
    }
    renderAll();
  }

  // ---- Wallet actions -----------------------------------------------------

  async function runTx(label: string, action: (w: WalletService) => Promise<void>): Promise<void> {
    if (!wallet) {
      status.toast("error", "Read-only mode: signing is disabled when VITE_NODE_URL is set.");
      return;
    }
    if (busy) {
      status.toast("info", "A transaction is already waiting for your wallet.");
      return;
    }
    busy = true;
    document.body.classList.add("is-busy");
    status.toast("info", `${label}: confirm in your wallet…`);
    try {
      await action(wallet);
      status.toast("success", `${label}: done.`);
    } catch (error) {
      const report = describeError(error, cfg);
      status.toast("error", `${label} failed — ${report.title}: ${report.detail}`);
    } finally {
      busy = false;
      document.body.classList.remove("is-busy");
      refresh();
    }
  }

  function signIn(): void {
    wallet?.signIn().catch((error: unknown) => {
      const report = describeError(error, cfg);
      status.toast("error", `Sign in failed — ${report.title}: ${report.detail}`);
    });
  }

  function signOut(): void {
    wallet?.signOut().catch((error: unknown) => {
      const report = describeError(error, cfg);
      status.toast("error", `Sign out failed — ${report.detail}`);
    });
  }

  function bid(skinId: number, amountText: string): void {
    const view = snapshot?.auctions.find((a) => a.auction.skin_id === skinId);
    if (!view) return;
    const minNext = BigInt(view.auction.min_next_bid);
    let amount: bigint;
    try {
      amount = amountText.trim() === "" ? minNext : parseMolt(amountText);
    } catch (error) {
      status.toast("error", describeError(error, cfg).detail);
      return;
    }
    if (amount < minNext) {
      status.toast("error", `Minimum next bid is ${formatMolt(minNext)} MOLT.`);
      return;
    }
    if (account && amount > BigInt(account.balance)) {
      status.toast("error", `Not enough MOLT: you hold ${formatMolt(account.balance)}.`);
      return;
    }
    void runTx(`Bid ${formatMolt(amount)} MOLT on skin #${skinId}`, (w) => w.bid(skinId, amount));
  }

  // ---- Sculpt preview -----------------------------------------------------

  const previewCache = new Map<string, string>();
  let previewRequest = 0;

  async function showPreview(choice: Choice | null): Promise<void> {
    const requestId = ++previewRequest;
    if (!choice || !snapshot) {
      hero.renderPreview(null);
      return;
    }
    const { mascot, catalog } = snapshot;
    const preview = {
      slot: choice.slot,
      variantName: catalog.find((c) => c.slot === choice.slot)?.variants[choice.variant] ?? `#${choice.variant}`,
      price: mascot.slot_prices[choice.slot],
    };
    const key = `${JSON.stringify(mascot.genome)}:${choice.slot}:${choice.variant}`;
    const cached = previewCache.get(key);
    hero.renderPreview({ ...preview, svg: cached ?? null });
    if (cached) return;
    try {
      const svg = await rpc.previewSvg(choice.slot, choice.variant);
      previewCache.set(key, svg);
      if (requestId === previewRequest) hero.renderPreview({ ...preview, svg });
    } catch (error) {
      if (requestId !== previewRequest) return;
      hero.renderPreview(null);
      status.toast("error", `Preview unavailable — ${describeError(error, cfg).detail}`);
    }
  }

  // ---- Panels -------------------------------------------------------------

  const walletBar = createWalletBar(layout.walletBar, {
    onSignIn: signIn,
    onSignOut: signOut,
    onClaimAirdrop: () => void runTx("Claim airdrop", (w) => w.claimAirdrop()),
  });
  const hero = createHeroPanel(layout.heroLive, layout.heroPreview, () => void runTx("Molt", (w) => w.molt()));
  const sculpt = createSculptPanel(layout.sculpt, {
    onPreview: (choice) => void showPreview(choice),
    onTransform: ({ slot, variant }) => void runTx(`Sculpt ${slot}`, (w) => w.transform(slot, variant)),
  });
  const auctions = createAuctionsPanel(layout.auctions, {
    onBid: bid,
    onMolt: () => void runTx("Molt", (w) => w.molt()),
  });
  const galleryPanel = createGalleryPanel(layout.gallery, {
    onPage: (page) => {
      galleryPage = page;
      refresh();
    },
    onClaim: (skinId) => void runTx(`Claim share of skin #${skinId}`, (w) => w.claimSculptorShare(skinId)),
  });
  const supply = createSupplyPanel(layout.supply);
  const journal = createJournalPanel(layout.journal);
  const footer = createFooter(layout.footer);

  function renderAll(): void {
    const canSign = wallet !== null && accountId !== null;
    const currentAccount = account?.accountId === accountId ? account : null;
    const config = snapshot?.config ?? null;
    const airdropOpen =
      snapshot !== null &&
      config !== null &&
      BigInt(config.airdrop_amount) > 0n &&
      BigInt(snapshot.stats.airdrop_remaining) >= BigInt(config.airdrop_amount);

    walletBar.render({
      network: cfg.network,
      readOnly: cfg.readOnly,
      accountId,
      account: currentAccount,
      airdropAmount: airdropOpen && config ? config.airdrop_amount : null,
    });
    footer.render({ app: cfg, config });
    if (!snapshot) return;

    hero.render({ mascot: snapshot.mascot, canSign });
    sculpt.render({
      catalog: snapshot.catalog,
      mascot: snapshot.mascot,
      balance: currentAccount?.balance ?? null,
      transformDeposit: currentAccount?.transformDeposit ?? null,
      canSign,
    });
    auctions.render({ auctions: snapshot.auctions, auctionBurnBps: snapshot.config.auction_burn_bps, canSign });
    if (gallery) galleryPanel.render({ gallery, accountId });
    supply.render({ stats: snapshot.stats, journal: snapshot.journal });
    journal.render({ journal: snapshot.journal, catalog: snapshot.catalog });
  }

  renderAll();
  refresh();
  setInterval(refresh, REFRESH_INTERVAL_MS);
  startCountdownTicker(app);
}

const app = requireElement(document, "#app", HTMLElement);
try {
  start(app, loadConfig(import.meta.env));
} catch (error) {
  renderFatal(app, describeError(error));
}
