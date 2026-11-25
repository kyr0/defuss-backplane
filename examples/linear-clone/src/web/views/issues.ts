/** VERIFIED: scripts/e2e.ts drives it in Chromium, Firefox and WebKit. The issue list grouped by status, the board, the data grid and My issues, all from the store. */
import { PRIORITIES, STATUSES, type Issue } from "../../core/issue.ts";
import { df$ } from "../env.ts";
import { fillAvatar, initials, LABEL_NAMES, PRIORITY_NAMES, shortDate, stamp, STATUS_NAMES } from "../dom.ts";
import { person, sortedIssues, store } from "../store.ts";

type Row = {
  id: string;
  title: string;
  status: string;
  statusRank: number;
  priority: string;
  prioRank: number;
  assignee: string;
  who: string;
  labels: string;
  due: string;
  dueAt: number;
};

/** The data grid's records: one per issue, with the ranks it sorts by, as the scaffold builds them. */
const records = (issues: Issue[]): Row[] =>
  issues.map((i) => ({
    id: i.id,
    title: i.title,
    status: STATUS_NAMES[i.status],
    statusRank: STATUSES.indexOf(i.status),
    priority: PRIORITY_NAMES[i.priority],
    prioRank: PRIORITIES.indexOf(i.priority),
    assignee: person(i.assignee)?.name ?? "Unassigned",
    who: i.assignee ?? "",
    labels: i.labels.map((l) => LABEL_NAMES[l]).join(", "),
    due: i.due ? shortDate(i.due) : "",
    dueAt: i.due ? Date.parse(i.due) : Number.MAX_SAFE_INTEGER,
  }));

const cell = (el: HTMLElement, html: string, text: string) => {
  el.innerHTML = html;
  el.querySelector(".pm-cell > span:last-child")!.textContent = text;
};
const cells = {
  id: (el: HTMLElement, r: Row) => {
    el.classList.add("pm-id");
    el.textContent = r.id;
  },
  status: (el: HTMLElement, r: Row) =>
    cell(el, `<span class="pm-cell" data-status="${STATUSES[r.statusRank]}"><span class="pm-status" aria-hidden="true"></span><span></span></span>`, r.status),
  priority: (el: HTMLElement, r: Row) =>
    cell(el, `<span class="pm-cell" data-priority="${PRIORITIES[r.prioRank]}"><span class="pm-prio" aria-hidden="true"></span><span></span></span>`, r.priority),
  assignee: (el: HTMLElement, r: Row) => {
    cell(el, '<span class="pm-cell"><span class="avatar pm-assignee" data-size="sm"></span><span></span></span>', r.assignee);
    fillAvatar(el.querySelector(".pm-assignee")!, r.who || null);
  },
};

/** Applies the filter field to the rows and cards, as the scaffold's filter does. */
export function applyFilter(app: HTMLElement) {
  const query = (app.querySelector<HTMLInputElement>("[data-pm-filter]")?.value ?? "").trim().toLowerCase();
  app.querySelectorAll<HTMLElement>(".pm-list .pm-row, .pm-board .pm-card").forEach((r) => {
    r.hidden = !!query && !r.textContent!.toLowerCase().includes(query);
  });
}

export function renderIssues(app: HTMLElement) {
  const issues = sortedIssues();
  for (const status of STATUSES) {
    const mine = issues.filter((i) => i.status === status);
    app.querySelector(`.pm-group[data-status="${status}"] .pm-rows`)?.replaceChildren(...mine.map((i) => stamp("pm-tpl-row", i)));
    app.querySelector(`.pm-col[data-status="${status}"] .pm-cards`)?.replaceChildren(...mine.map((i) => stamp("pm-tpl-card", i)));
  }
  app.querySelectorAll(".pm-group, .pm-col").forEach((g) => {
    const count = g.querySelector(".pm-count");
    if (count) count.textContent = String(g.querySelectorAll("[data-issue]").length);
  });
  const viewer = store.boot.viewer;
  app.querySelector("[data-pm-mine]")?.replaceChildren(...issues.filter((i) => i.assignee === viewer).map((i) => stamp("pm-tpl-row", i)));
  const grid = app.querySelector<HTMLElement & { store?: unknown }>("#pm-grid");
  if (grid?.store && df$.shadcn.dataGrid) df$.shadcn.dataGrid.setSource(grid, records(issues), { cells } as never);
  applyFilter(app);
  // The sidebar's account menu shows the viewer.
  const me = person(viewer)?.name ?? viewer;
  app.querySelectorAll("[data-pm-viewer] .avatar-fallback").forEach((f) => (f.textContent = initials(me)));
  app.querySelectorAll("[data-pm-viewer-name]").forEach((n) => (n.textContent = me));
}
