// Small DOM helpers shared by the panels.

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * Renders contract-provided SVG through an <img> data URI: scripts and event
 * handlers inside the SVG never run, and its ids/styles cannot leak into the page.
 */
export function svgImage(svg: string, alt: string, className = ""): string {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return `<img class="${escapeHtml(className)}" src="${src}" alt="${escapeHtml(alt)}" decoding="async" />`;
}

const SVG_DATA_URI_PREFIX = "data:image/svg+xml;";

/**
 * Renders a contract-provided SVG data URI (e.g. NFT `media`) through an <img>.
 * Anything that is not an inline SVG data URI (remote URL, other scheme) is refused.
 */
export function svgDataUriImage(dataUri: string | null, alt: string, className = ""): string {
  if (dataUri === null || !dataUri.startsWith(SVG_DATA_URI_PREFIX)) {
    return `<div class="${escapeHtml(className)} loading">no image</div>`;
  }
  return `<img class="${escapeHtml(className)}" src="${escapeHtml(dataUri)}" alt="${escapeHtml(alt)}" decoding="async" />`;
}

export function requireElement<T extends Element>(root: ParentNode, selector: string, type: new () => T): T {
  const found = root.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Missing element ${selector}`);
  return found;
}

/** The closest ancestor (or self) carrying `data-action`, scoped to `root`. */
export function actionTarget(event: Event, root: Element): HTMLElement | null {
  if (!(event.target instanceof Element)) return null;
  const target = event.target.closest<HTMLElement>("[data-action]");
  return target && root.contains(target) ? target : null;
}

export interface MemoRender<T> {
  (data: T): void;
  /** Forces the next call to render, e.g. after the container was overwritten. */
  reset(): void;
}

/** Re-renders only when the serialized input changed (keeps focus, hover and inputs stable). */
export function memoRender<T>(render: (data: T) => void): MemoRender<T> {
  let lastKey: string | null = null;
  const draw = (data: T): void => {
    const key = JSON.stringify(data);
    if (key === lastKey) return;
    lastKey = key;
    render(data);
  };
  return Object.assign(draw, {
    reset: () => {
      lastKey = null;
    },
  });
}
