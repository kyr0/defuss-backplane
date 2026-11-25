/** VERIFIED: the issue model and its rules, one definition for the server, which validates every write, and the browser, which
 * sorts and counts with the same ranks. Why here and not in the API layer: the browser imports this module, so both
 * sides cannot drift apart. */
import { isDate } from "./dates.ts";

/** VERIFIED: the scaffold's statuses and priorities, in its rank order (`RANK` in the scaffold script). */
export const STATUSES = ["backlog", "todo", "progress", "review", "done"] as const;
export const PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
/** VERIFIED: the scaffold's labels. */
export const LABELS = ["bug", "feature", "improvement", "design", "performance"] as const;

export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Label = (typeof LABELS)[number];
export type Subtask = { title: string; done: boolean };

export type Issue = {
  id: string;
  team: string;
  number: number;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  /** A person ID, or null when unassigned. */
  assignee: string | null;
  labels: Label[];
  project: string | null;
  cycle: string | null;
  /** A calendar date, `YYYY-MM-DD`. */
  due: string | null;
  subtasks: Subtask[];
  /** ISO instants. `startedAt` is set while the status is past `todo`, `completedAt` while it is `done`. */
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

/** VERIFIED: the scaffold counts `progress`, `review` and `done` as started. */
export const isStarted = (status: Status) => status !== "backlog" && status !== "todo";

/** What a caller may set. */
export type Fields = Pick<
  Issue,
  "title" | "description" | "status" | "priority" | "assignee" | "labels" | "project" | "cycle" | "due" | "subtasks"
>;
export type Draft = Fields;
export type Patch = Partial<Fields>;

export const LIMITS = { title: 200, description: 10_000, labels: LABELS.length, subtasks: 50, comment: 5000, fileName: 200 } as const;
/** A reference to a person, project or cycle document. */
const REFERENCE = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** A rejected input; `field` names the key, so a form can mark it. */
export class InvalidInput extends Error {
  constructor(
    readonly field: string,
    readonly detail: string,
  ) {
    super(field + ": " + detail);
    this.name = "InvalidInput";
  }
}

function text(field: string, value: unknown, max: number, required: boolean) {
  if (typeof value !== "string") throw new InvalidInput(field, "must be a string");
  const trimmed = value.trim();
  if (required && !trimmed) throw new InvalidInput(field, "must not be empty");
  if (trimmed.length > max) throw new InvalidInput(field, "must have at most " + max + " characters");
  return trimmed;
}

function oneOf<T extends string>(field: string, value: unknown, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) throw new InvalidInput(field, "must be one of " + allowed.join(", "));
  return value as T;
}

function reference(field: string, value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || !REFERENCE.test(value))
    throw new InvalidInput(field, "must be null or an ID of lowercase letters, digits and dashes");
  return value;
}

const parsers: { [K in keyof Fields]: (value: unknown) => Fields[K] } = {
  title: (v) => text("title", v, LIMITS.title, true),
  description: (v) => text("description", v, LIMITS.description, false),
  status: (v) => oneOf("status", v, STATUSES),
  priority: (v) => oneOf("priority", v, PRIORITIES),
  assignee: (v) => reference("assignee", v),
  labels: (v) => {
    if (!Array.isArray(v)) throw new InvalidInput("labels", "must be an array");
    const labels = v.map((label) => oneOf("labels", label, LABELS));
    if (new Set(labels).size !== labels.length) throw new InvalidInput("labels", "must not repeat a label");
    return labels;
  },
  project: (v) => reference("project", v),
  cycle: (v) => reference("cycle", v),
  due: (v) => {
    if (v !== null && !isDate(v)) throw new InvalidInput("due", "must be null or a date YYYY-MM-DD");
    return v as string | null;
  },
  subtasks: (v) => {
    if (!Array.isArray(v) || v.length > LIMITS.subtasks)
      throw new InvalidInput("subtasks", "must be an array of at most " + LIMITS.subtasks);
    return v.map((s: unknown) => {
      const item = s as Record<string, unknown> | null;
      if (!item || typeof item !== "object" || typeof item.done !== "boolean")
        throw new InvalidInput("subtasks", "each subtask has a title and done");
      return { title: text("subtasks", item.title, LIMITS.title, true), done: item.done };
    });
  },
};

function record(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InvalidInput("input", "must be an object");
  const entries = Object.entries(input);
  const unknown = entries.find(([key]) => !Object.hasOwn(parsers, key));
  if (unknown) throw new InvalidInput(unknown[0], "is not an issue field");
  return entries as [keyof Fields, unknown][];
}

/** A new issue's fields: `title` is required; every other field has its scaffold default. */
export function validateDraft(input: unknown): Draft {
  const draft: Draft = {
    title: "",
    description: "",
    status: "todo",
    priority: "none",
    assignee: null,
    labels: [],
    project: null,
    cycle: null,
    due: null,
    subtasks: [],
  };
  const fields = record(input);
  if (!fields.some(([key]) => key === "title")) throw new InvalidInput("title", "is required");
  for (const [key, value] of fields) (draft as Record<string, unknown>)[key] = parsers[key](value);
  return draft;
}

/** A change to an existing issue: one or more fields. */
export function validatePatch(input: unknown): Patch {
  const fields = record(input);
  if (!fields.length) throw new InvalidInput("input", "must change at least one field");
  const patch: Patch = {};
  for (const [key, value] of fields) (patch as Record<string, unknown>)[key] = parsers[key](value);
  return patch;
}

export type Change = { field: keyof Fields; from: unknown; to: unknown };

/** The issue after a validated patch, and the fields that changed, for the activity feed. */
export function applyPatch(issue: Issue, patch: Patch, now: Date): { issue: Issue; changes: Change[] } {
  const changes: Change[] = [];
  const next: Issue = { ...issue };
  for (const [key, value] of Object.entries(patch) as [keyof Fields, unknown][]) {
    if (JSON.stringify(issue[key]) === JSON.stringify(value)) continue;
    changes.push({ field: key, from: issue[key], to: value });
    (next as Record<string, unknown>)[key] = value;
  }
  if (!changes.length) return { issue, changes };
  next.updatedAt = now.toISOString();
  if (next.status === "done" && issue.status !== "done") next.completedAt = next.updatedAt;
  if (next.status !== "done") next.completedAt = null;
  if (isStarted(next.status) && !isStarted(issue.status)) next.startedAt = next.updatedAt;
  if (!isStarted(next.status)) next.startedAt = null;
  return { issue: next, changes };
}

/** List order: by status rank, then priority rank, then the newest issue first. */
export function compareIssues(a: Pick<Issue, "status" | "priority" | "number">, b: typeof a) {
  return (
    STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) ||
    PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) ||
    b.number - a.number
  );
}

export function validateComment(body: unknown) {
  return text("body", body, LIMITS.comment, true);
}

/** An attachment's file name, which becomes the last part of its object key, so it holds no slash. */
export function validateFileName(name: unknown) {
  const value = text("name", name, LIMITS.fileName, true);
  const control = [...value].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);
  if (control || value.includes("/") || value.includes("\\") || value === "." || value === "..")
    throw new InvalidInput("name", "must not contain slashes or control characters, nor be . or ..");
  return value;
}
