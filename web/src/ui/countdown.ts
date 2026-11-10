// Live countdowns: panels emit placeholders, one ticker updates them all every second.
import { escapeHtml } from "../dom";
import { countdown } from "../format";
import { chainNowMs } from "../near/clock";

const TICK_MS = 1000;

export function countdownHtml(endsAtNs: string, endedLabel: string): string {
  const label = escapeHtml(endedLabel);
  return `<span class="countdown" data-ends-ns="${escapeHtml(endsAtNs)}" data-ended-label="${label}">${
    escapeHtml(countdown(endsAtNs, chainNowMs()) ?? endedLabel)
  }</span>`;
}

export function startCountdownTicker(root: HTMLElement): void {
  setInterval(() => {
    root.querySelectorAll<HTMLElement>("[data-ends-ns]").forEach((el) => {
      const endsAtNs = el.dataset["endsNs"];
      if (endsAtNs === undefined) return;
      el.textContent = countdown(endsAtNs, chainNowMs()) ?? el.dataset["endedLabel"] ?? "";
    });
  }, TICK_MS);
}
