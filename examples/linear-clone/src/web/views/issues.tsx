/** VERIFIED: scripts/e2e.ts drives the list, the board, the grid and My issues. The issue list grouped by status,
 * the board, the data grid and My issues, each a `reactive()` region rendered from the store. Rows and cards are
 * keyed by issue ID, so a status change moves the one node to its new group instead of rebuilding the list. */
import { morph, reactive } from "defuss-morph";
import { type Issue, PRIORITIES, STATUSES } from "../../core/issue.ts";
import { ui } from "../env.ts";
import { LABEL_NAMES, PRIORITY_NAMES, shortDate, STATUS_NAMES } from "../format.ts";
import { appStore, person, sortedIssues, store } from "../store.ts";
import { Avatar, Labels, ProjectChip } from "./parts.tsx";

/** Whether the filter field's text is in the issue's ID or title, as the scaffold's placeholder says. */
const matches = (issue: Issue) => {
  const query = store.filter.trim().toLowerCase();
  return !query || issue.id.toLowerCase().includes(query) || issue.title.toLowerCase().includes(query);
};

const dataOf = (issue: Issue) => ({
  "data-issue": issue.id,
  "data-status": issue.status,
  "data-priority": issue.priority,
  "data-assignee": issue.assignee ?? "",
  "data-context-menu": "pm-ctx",
});

export const IssueRow = ({ issue, filtered = false }: { issue: Issue; filtered?: boolean }) => (
  <li key={issue.id} class="pm-row" {...dataOf(issue)} hidden={filtered && !matches(issue)}>
    <a class="pm-row-link" href={"#/issues/" + issue.id} data-router-link="">
      <span class="pm-prio" aria-hidden="true"></span>
      <span class="sr-only">{PRIORITY_NAMES[issue.priority]}</span>
      <span class="pm-id">{issue.id}</span>
      <span class="pm-status" aria-hidden="true"></span>
      <span class="pm-title">{issue.title}</span>
      <span class="pm-labels">
        <Labels labels={issue.labels} />
      </span>
      <span class="pm-project">
        <ProjectChip project={issue.project} />
      </span>
      <time class="pm-date">{shortDate(issue.due)}</time>
      <Avatar who={issue.assignee} class="pm-assignee" />
    </a>
  </li>
);

export const IssueCard = ({ issue }: { issue: Issue }) => (
  <a
    key={issue.id}
    class="pm-card"
    href={"#/issues/" + issue.id}
    data-router-link=""
    draggable="true"
    {...dataOf(issue)}
    hidden={!matches(issue)}
  >
    <span class="pm-card-top">
      <span class="pm-id">{issue.id}</span>
      <Avatar who={issue.assignee} class="pm-assignee" />
    </span>
    <span class="pm-card-title">
      <span class="pm-status" aria-hidden="true"></span>
      <span>{issue.title}</span>
    </span>
    <span class="pm-card-meta">
      <span class="pm-prio" aria-hidden="true"></span>
      <span>
        <Labels labels={issue.labels} />
      </span>
    </span>
  </a>
);

type Row = { id: string; title: string; status: string; statusRank: number; priority: string; prioRank: number; assignee: string; who: string; labels: string; due: string; dueAt: number };

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

/** The grid's custom cells, morphed into the cell elements the grid hands over. */
const cells = {
  id: (el: HTMLElement, r: Row) => morph(el, <span class="pm-id">{r.id}</span>),
  status: (el: HTMLElement, r: Row) =>
    morph(
      el,
      <span class="pm-cell" data-status={STATUSES[r.statusRank]}>
        <span class="pm-status" aria-hidden="true"></span>
        <span>{r.status}</span>
      </span>,
    ),
  priority: (el: HTMLElement, r: Row) =>
    morph(
      el,
      <span class="pm-cell" data-priority={PRIORITIES[r.prioRank]}>
        <span class="pm-prio" aria-hidden="true"></span>
        <span>{r.priority}</span>
      </span>,
    ),
  assignee: (el: HTMLElement, r: Row) =>
    morph(
      el,
      <span class="pm-cell">
        <Avatar who={r.who || null} class="pm-assignee" />
        <span>{r.assignee}</span>
      </span>,
    ),
};

/** Binds every issue region of the page to the store. */
export function bindIssues(app: HTMLElement) {
  for (const status of STATUSES) {
    const mine = () => sortedIssues().filter((i) => i.status === status);
    const rows = app.querySelector(`.pm-group[data-status="${status}"] .pm-rows`);
    if (rows) reactive({ store: appStore, render: () => mine().map((issue) => <IssueRow issue={issue} filtered />) }, rows);
    const cards = app.querySelector(`.pm-col[data-status="${status}"] .pm-cards`);
    if (cards) reactive({ store: appStore, render: () => mine().map((issue) => <IssueCard issue={issue} />) }, cards);
    const counts = app.querySelectorAll(`:is(.pm-group, .pm-col)[data-status="${status}"] .pm-count`);
    reactive({ store: appStore, render: () => String(mine().length) }, counts);
  }
  const mine = app.querySelector("[data-pm-mine]");
  if (mine)
    reactive(
      { store: appStore, render: () => sortedIssues().filter((i) => i.assignee === store.boot.viewer).map((issue) => <IssueRow issue={issue} />) },
      mine,
    );
  const grid = app.querySelector<HTMLElement & { store?: unknown }>("#pm-grid");
  const fillGrid = () => {
    if (grid?.store && ui.shadcn.dataGrid) ui.shadcn.dataGrid.setSource(grid, records(sortedIssues()), { cells } as never);
  };
  fillGrid();
  appStore.subscribe(fillGrid);
}
