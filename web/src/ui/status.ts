// Global error banner and transaction toasts.
import { escapeHtml } from "../dom";
import type { ErrorReport } from "../errors";

const TOAST_VISIBLE_MS = 6000;

export type ToastKind = "info" | "success" | "error";

export interface StatusPanel {
  showError(report: ErrorReport | null, retrySeconds: number): void;
  toast(kind: ToastKind, text: string): void;
}

export function createStatusPanel(banner: HTMLElement, toasts: HTMLElement): StatusPanel {
  let toastTimer: number | undefined;

  return {
    showError(report, retrySeconds) {
      banner.hidden = report === null;
      banner.innerHTML = report
        ? `<strong>${escapeHtml(report.title)}</strong>
           <span>${escapeHtml(report.detail)}</span>
           <small>Retrying every ${retrySeconds} s.</small>`
        : "";
    },
    toast(kind, text) {
      window.clearTimeout(toastTimer);
      toasts.className = `toast toast-${kind}`;
      toasts.textContent = text;
      toasts.hidden = false;
      toastTimer = window.setTimeout(() => {
        toasts.hidden = true;
      }, TOAST_VISIBLE_MS);
    },
  };
}
