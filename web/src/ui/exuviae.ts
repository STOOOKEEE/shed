// Exuviae: the permanent carapaces left by dethroned face holders, newest first.
import { actionTarget, escapeHtml, memoRender, svgDataUriImage } from "../dom";
import type { Exuvia } from "../contract/types";
import { formatAccount } from "../format";

const PAGE_SIZE = 12;

export interface ExuviaeData {
  /** Oldest first, as scanned from the contract. */
  exuviae: Exuvia[];
  accountId: string | null;
}

export interface ExuviaePanel {
  render(data: ExuviaeData): void;
}

function card(exuvia: Exuvia, accountId: string | null): string {
  const { title, description, media } = exuvia.metadata;
  const name = title ?? `Exuvia #${exuvia.token_id}`;
  const mine = accountId === exuvia.owner_id ? ` <span class="badge badge-live">yours</span>` : "";
  return `
    <article class="card card-small${mine ? " is-mine" : ""}">
      ${svgDataUriImage(media, name, "card-img")}
      <div class="card-body">
        <h3>${escapeHtml(name)}${mine}</h3>
        <p class="small">Owner: ${escapeHtml(formatAccount(exuvia.owner_id))}</p>
        ${description ? `<p class="small muted">${escapeHtml(description)}</p>` : ""}
      </div>
    </article>`;
}

function pager(page: number, pageCount: number): string {
  if (pageCount <= 1) return "";
  return `
    <nav class="pager" aria-label="Exuviae pages">
      <button type="button" class="btn" data-action="page" data-page="${page - 1}" ${page === 0 ? "disabled" : ""}>← Newer</button>
      <span>Page ${page + 1} / ${pageCount}</span>
      <button type="button" class="btn" data-action="page" data-page="${page + 1}" ${page + 1 >= pageCount ? "disabled" : ""}>Older →</button>
    </nav>`;
}

export function createExuviaePanel(root: HTMLElement): ExuviaePanel {
  let data: ExuviaeData | null = null;
  let page = 0;

  const draw = memoRender((view: { data: ExuviaeData; page: number }) => {
    const { exuviae, accountId } = view.data;
    if (exuviae.length === 0) {
      root.innerHTML = `<p class="placeholder">No exuvia yet. When someone reshapes the mascot, the previous face holder
        keeps its carapace here forever.</p>`;
      return;
    }
    const pageCount = Math.ceil(exuviae.length / PAGE_SIZE);
    const newestFirst = [...exuviae].reverse();
    const shown = newestFirst.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE);
    root.innerHTML = `
      <div class="cards cards-small">${shown.map((e) => card(e, accountId)).join("")}</div>
      ${pager(view.page, pageCount)}`;
  });

  function redraw(): void {
    if (!data) return;
    const pageCount = Math.max(1, Math.ceil(data.exuviae.length / PAGE_SIZE));
    page = Math.min(Math.max(page, 0), pageCount - 1);
    draw({ data, page });
  }

  root.addEventListener("click", (event) => {
    const target = actionTarget(event, root);
    if (target?.dataset["action"] !== "page") return;
    page = Number(target.dataset["page"]);
    redraw();
  });

  return {
    render(next) {
      data = next;
      redraw();
    },
  };
}
