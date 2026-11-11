// Top bar: brand, network, account, SHED balance, airdrop.
import { actionTarget, escapeHtml, memoRender } from "../dom";
import { formatAccount, formatShed } from "../format";
import type { AccountData } from "../store";
import type { Network } from "../config";

export interface WalletBarData {
  network: Network;
  readOnly: boolean;
  accountId: string | null;
  account: AccountData | null;
  /** Airdrop amount (yocto) when the pool can still pay it, else null. */
  airdropAmount: string | null;
}

export interface WalletBarHandlers {
  onSignIn(): void;
  onSignOut(): void;
  onClaimAirdrop(): void;
}

export interface WalletBar {
  render(data: WalletBarData): void;
}

function accountSection(data: WalletBarData): string {
  if (data.readOnly) return `<span class="badge">Read-only · custom RPC</span>`;
  if (!data.accountId) return `<button type="button" class="btn btn-primary" data-action="sign-in">Sign in</button>`;
  const balance = data.account ? `${formatShed(data.account.balance)} SHED` : "…";
  const airdrop =
    data.account && !data.account.airdropClaimed && data.airdropAmount
      ? `<button type="button" class="btn btn-primary" data-action="airdrop">Claim ${formatShed(data.airdropAmount, 0)} SHED airdrop</button>`
      : "";
  return `
    <span class="account" title="${escapeHtml(data.accountId)}">${escapeHtml(formatAccount(data.accountId))}</span>
    <span class="balance">${balance}</span>
    ${airdrop}
    <button type="button" class="btn" data-action="sign-out">Sign out</button>`;
}

export function createWalletBar(root: HTMLElement, handlers: WalletBarHandlers): WalletBar {
  root.addEventListener("click", (event) => {
    const action = actionTarget(event, root)?.dataset["action"];
    if (action === "sign-in") handlers.onSignIn();
    if (action === "sign-out") handlers.onSignOut();
    if (action === "airdrop") handlers.onClaimAirdrop();
  });

  return {
    render: memoRender((data: WalletBarData) => {
      root.innerHTML = `
        <a class="brand" href="#" aria-label="SHED home"><span class="brand-mark">$SHED</span>
          <span class="brand-tag">the memecoin that sheds its skins</span></a>
        <div class="wallet-actions">
          ${data.readOnly ? "" : `<span class="badge badge-net">${data.network}</span>`}
          ${accountSection(data)}
        </div>`;
    }),
  };
}
