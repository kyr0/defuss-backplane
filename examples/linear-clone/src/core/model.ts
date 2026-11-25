/** VERIFIED: the workspace's documents besides issues and cycles, one backplane db bucket each (tests/workspace.test.ts). */
export type Person = { id: string; name: string };
export type Team = { id: string; name: string; next: number };
export type Project = {
  id: string;
  name: string;
  /** A Lucide icon name. */
  icon: string;
  health: "on" | "risk" | "off" | "done";
  lead: string | null;
  target: string | null;
};
export type Comment = { id: string; issue: string; author: string; body: string; createdAt: string };
export type IssueEvent = {
  id: string;
  issue: string;
  actor: string;
  kind: "created" | "changed" | "commented" | "attached";
  field?: string;
  from?: unknown;
  to?: unknown;
  at: string;
};
/** An inbox item. `detail` holds the comment text, the new status or priority, or the due date. */
export type Notification = {
  id: string;
  person: string;
  kind: "comment" | "assigned" | "status" | "mention" | "priority" | "closed" | "due" | "overdue";
  issue: string;
  actor: string | null;
  detail: string;
  read: boolean;
  at: string;
};
