/** VERIFIED: scripts/e2e.ts drives it in Chromium, Firefox and WebKit. The client state: the workspace directory,
 * the issues by ID, the viewer's inbox, the open issue page and the shown view. Every rendered region is a defuss-morph
 * `reactive()` binding to `appStore`; actions change the state and call `changed()`, and each region renders again
 * and morphs only what differs. Why one store: a status change shows in the list, the board, the grid, My issues,
 * the cycle and the issue page at once, and focus and typed text survive because morph keeps the nodes. */
import { compareIssues, type Issue } from "../core/issue.ts";
import type { Notification, Person } from "../core/model.ts";
import type { Api } from "../server/api.ts";

export type Boot = Awaited<ReturnType<Api["Workspace"]["bootstrap"]>>;
export type IssuePage = Awaited<ReturnType<Api["Issues"]["get"]>>;
/** A view section's ID, or "issue" for the page in `store.page`. */
export type View = "issues" | "my-issues" | "inbox" | "cycles" | "projects" | "issue";

export const store = {
  boot: undefined as unknown as Boot,
  issues: new Map<string, Issue>(),
  inbox: [] as Notification[],
  /** The open issue page, with the revision its edits are conditional on. */
  page: null as IssuePage | null,
  view: "issues" as View,
  /** The filter field's text; the list and the board show the issues whose ID or title contain it. */
  filter: "",
  /** Issues starred in this tab: the scaffold's favorite button, which only says so in a toast. */
  starred: new Set<string>(),
};

const listeners = new Set<() => void>();
/** The store as defuss-morph's `reactive()` takes it: `subscribe` returns the unsubscribe function. */
export const appStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};
export function changed() {
  for (const listener of listeners) listener();
}

export function putIssue(issue: Issue) {
  store.issues.set(issue.id, issue);
  if (store.page?.issue.id === issue.id) store.page = { ...store.page, issue };
}

export const sortedIssues = () => [...store.issues.values()].sort(compareIssues);
export const person = (id: string | null): Person | undefined => store.boot.people.find((p) => p.id === id);
export const nameOf = (id: string | null) => (id === "system" ? "Vector" : (person(id)?.name ?? "Someone"));
