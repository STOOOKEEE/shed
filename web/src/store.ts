// Loads contract state for the panels; one function per refresh scope.
import type { Auction, CatalogEntry, Config, Exuvia, JournalEntry, Mascot, Skin, Stats } from "./contract/types";
import { syncChainClock } from "./near/clock";
import type { Rpc } from "./near/rpc";

/** Enough history for the burn chart; the journal panel shows the newest slice of it. */
const JOURNAL_FETCH_LIMIT = 200;
const GALLERY_PAGE_SIZE = 12;
/** Upper bound of the exuviae scan (ids 1..EXUVIAE_SCAN_LIMIT). */
const EXUVIAE_SCAN_LIMIT = 200;
/** Exuviae ids probed in parallel per scan round once new tokens show up (the first round probes one id). */
const EXUVIAE_SCAN_BATCH = 6;

export interface AuctionView {
  auction: Auction;
  skin: Skin;
}

export interface Snapshot {
  config: Config;
  catalog: CatalogEntry[];
  mascot: Mascot;
  stats: Stats;
  journal: JournalEntry[];
  auctions: AuctionView[];
}

export interface AccountData {
  accountId: string;
  balance: string;
  airdropClaimed: boolean;
  /** yoctoNEAR deposit the next `transform` needs from this account. */
  transformDeposit: string;
}

export interface GalleryData {
  page: number;
  pageCount: number;
  skins: Skin[];
  /** skin_id → claimable sculptor share (yocto) for the signed-in account. */
  claimable: Record<number, string>;
}

interface StaticData {
  config: Config;
  catalog: CatalogEntry[];
}

export interface Store {
  loadSnapshot(): Promise<Snapshot>;
  loadAccount(accountId: string): Promise<AccountData>;
  loadGallery(page: number, skinsMinted: number, accountId: string | null): Promise<GalleryData>;
  /** Every exuvia, oldest first. Already-loaded tokens are cached: they never change. */
  loadExuviae(): Promise<Exuvia[]>;
}

export function createStore(rpc: Rpc): Store {
  // config() and catalog() never change after deploy.
  let staticData: StaticData | null = null;

  async function loadStatic(): Promise<StaticData> {
    if (!staticData) {
      const [config, catalog] = await Promise.all([rpc.config(), rpc.catalog()]);
      staticData = { config, catalog };
    }
    return staticData;
  }

  // Exuviae are immutable and ids are consecutive from 1: only scan past the last known one.
  const exuviae: Exuvia[] = [];

  async function scanExuviae(): Promise<Exuvia[]> {
    let batchSize = 1;
    while (exuviae.length < EXUVIAE_SCAN_LIMIT) {
      const firstId = exuviae.length + 1;
      const count = Math.min(batchSize, EXUVIAE_SCAN_LIMIT - exuviae.length);
      const batch = await Promise.all(Array.from({ length: count }, (_, i) => rpc.exuvia(firstId + i)));
      const missing = batch.indexOf(null);
      const found = (missing === -1 ? batch : batch.slice(0, missing)).filter((t): t is Exuvia => t !== null);
      exuviae.push(...found);
      if (missing !== -1) break;
      batchSize = EXUVIAE_SCAN_BATCH;
    }
    return [...exuviae];
  }

  // The auction card only shows a skin's id, cycle and image, which never change: fetch each skin once.
  // Live bid state comes from `auctions()` on every refresh.
  const auctionSkins = new Map<number, Skin>();

  async function loadAuctions(): Promise<AuctionView[]> {
    const auctions = await rpc.auctions();
    const missing = auctions.map((a) => a.skin_id).filter((id) => !auctionSkins.has(id));
    const fetched = await Promise.all(missing.map((id) => rpc.skin(id)));
    for (const skin of fetched) if (skin) auctionSkins.set(skin.skin_id, skin);
    return auctions.flatMap((auction) => {
      const skin = auctionSkins.get(auction.skin_id);
      return skin ? [{ auction, skin }] : [];
    });
  }

  return {
    async loadSnapshot() {
      const [chainNowNs, { config, catalog }, mascot, stats, journal, auctions] = await Promise.all([
        rpc.chainTimeNs(),
        loadStatic(),
        rpc.mascot(),
        rpc.stats(),
        rpc.journal(JOURNAL_FETCH_LIMIT),
        loadAuctions(),
      ]);
      syncChainClock(chainNowNs);
      return { config, catalog, mascot, stats, journal, auctions };
    },

    async loadAccount(accountId) {
      const [balance, airdropClaimed, transformDeposit] = await Promise.all([
        rpc.ftBalanceOf(accountId),
        rpc.airdropClaimed(accountId),
        rpc.transformDeposit(accountId),
      ]);
      return { accountId, balance, airdropClaimed, transformDeposit };
    },

    /** Newest skins first: page 0 holds the last GALLERY_PAGE_SIZE minted skins. */
    async loadGallery(page, skinsMinted, accountId) {
      const pageCount = Math.max(1, Math.ceil(skinsMinted / GALLERY_PAGE_SIZE));
      const safePage = Math.min(Math.max(page, 0), pageCount - 1);
      const end = skinsMinted - safePage * GALLERY_PAGE_SIZE;
      const start = Math.max(0, end - GALLERY_PAGE_SIZE);
      const skins = end > 0 ? (await rpc.skins(start, end - start)).reverse() : [];
      const claimable: Record<number, string> = {};
      if (accountId) {
        const amounts = await Promise.all(skins.map((s) => rpc.sculptorClaimable(s.skin_id, accountId)));
        skins.forEach((s, i) => {
          claimable[s.skin_id] = amounts[i] ?? "0";
        });
      }
      return { page: safePage, pageCount, skins, claimable };
    },

    loadExuviae: scanExuviae,
  };
}
