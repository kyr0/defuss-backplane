/** VERIFIED: scripts/e2e.ts drives it in Chromium, Firefox and WebKit. The client state: one store of issues by ID, the workspace directory and the viewer's inbox. Views render from it and
 * never keep copies; actions change it and call `changed()`, which re-renders every view. Why one store: a status
 * change shows in the list, the board, the grid, My issues, the cycle and the issue page at once. */
import { compareIssues, type Issue } from "../core/issue.ts";
import type { Notification, Person } from "../core/model.ts";
import type { Api } from "../server/api.ts";

export type Boot = Awaited<ReturnType<Api["Workspace"]["bootstrap"]>>;
export type IssuePage = Awaited<ReturnType<Api["Issues"]["get"]>>;

export const store = {
  boot: undefined as unknown as Boot,
  issues: new Map<string, Issue>(),
  inbox: [] as Notification[],
  /** The open issue page, with the revision its edits are conditional on. */
  page: null as IssuePage | null,
};

const listeners = new Set<() => void>();
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
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
