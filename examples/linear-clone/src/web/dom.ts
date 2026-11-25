/** VERIFIED: scripts/e2e.ts drives it in Chromium, Firefox and WebKit. DOM helpers shared by the views: names, avatars, dates and stamping the scaffold's templates. Issues, statuses and
 * times stay English, as in the scaffold; defuss-i18n translates the shell. */
import type { Issue, Label, Priority, Status } from "../core/issue.ts";
import { person, store } from "./store.ts";

export const STATUS_NAMES: Record<Status, string> = {
  backlog: "Backlog",
  todo: "Todo",
  progress: "In Progress",
  review: "In Review",
  done: "Done",
};
export const PRIORITY_NAMES: Record<Priority, string> = {
  none: "No priority",
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};
export const LABEL_NAMES: Record<Label, string> = {
  bug: "Bug",
  feature: "Feature",
  improvement: "Improvement",
  design: "Design",
  performance: "Performance",
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

/** Fills an `.avatar` with the person's initials, or marks it unassigned. */
export function fillAvatar(avatar: Element, who: string | null) {
  const p = person(who);
  avatar.toggleAttribute("data-none", !p);
  if (!p) {
    avatar.innerHTML = '<span class="sr-only">Unassigned</span>';
    return;
  }
  const fallback = document.createElement("span");
  fallback.className = "avatar-fallback";
  fallback.textContent = initials(p.name);
  fallback.title = p.name;
  avatar.replaceChildren(fallback);
}

export function labelBadges(labels: readonly Label[]) {
  return labels.map((label) => {
    const badge = document.createElement("span");
    badge.className = "badge pm-label";
    badge.dataset.variant = "outline";
    badge.dataset.label = label;
    badge.innerHTML = '<span class="pm-dot"></span>';
    badge.append(LABEL_NAMES[label]);
    return badge;
  });
}

/** `Oct 3` for 2026-10-03, without the time zone moving the day. */
export const shortDate = (date: string | null) =>
  date ? new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—";

/** `12m`, `3h`, `2d`, `1w` before now, as the scaffold's inbox shows; `just now` under a minute. */
export function ago(instant: string, now = Date.now()) {
  const minutes = Math.floor((now - Date.parse(instant)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m";
  if (minutes < 1440) return Math.floor(minutes / 60) + "h";
  if (minutes < 10_080) return Math.floor(minutes / 1440) + "d";
  return Math.floor(minutes / 10_080) + "w";
}

/** A project chip: its icon and name, empty when the issue has no project. */
export function fillProject(chip: Element, project: string | null) {
  const p = store.boot.projects.find((x) => x.id === project);
  chip.replaceChildren();
  if (!p) return;
  const icon = document.createElement("i");
  icon.dataset.lucide = p.icon;
  chip.append(icon, p.name);
}

/** A clone of one of the scaffold's templates. */
export function clone(id: string) {
  const template = document.getElementById(id) as HTMLTemplateElement | null;
  if (!template) throw new Error("No template " + id);
  return template.content.firstElementChild!.cloneNode(true) as HTMLElement;
}

/** An issue's row, card or page: the template with the issue's data, as the scaffold's `stamp` fills it. */
export function stamp(id: "pm-tpl-row" | "pm-tpl-card" | "pm-tpl-issue", issue: Issue) {
  const node = clone(id);
  for (const el of [node, ...node.querySelectorAll<HTMLElement>("[data-issue]")])
    Object.assign(el.dataset, { issue: issue.id, status: issue.status, priority: issue.priority, assignee: issue.assignee ?? "" });
  if (node.id) node.id = issue.id;
  node.querySelectorAll('a[href="#/issues/ENG-000"]').forEach((a) => a.setAttribute("href", "#/issues/" + issue.id));
  if (node.getAttribute("href") === "#/issues/ENG-000") node.setAttribute("href", "#/issues/" + issue.id);
  node.querySelectorAll('[aria-labelledby^="ENG-000"], [id^="ENG-000"]').forEach((el) => {
    if (el.id) el.id = el.id.replace("ENG-000", issue.id);
    const by = el.getAttribute("aria-labelledby");
    if (by) el.setAttribute("aria-labelledby", by.replace("ENG-000", issue.id));
  });
  if (node.matches("section")) node.setAttribute("aria-label", issue.id);
  const each = (field: string, fn: (el: HTMLElement) => void) => node.querySelectorAll<HTMLElement>(`[data-f="${field}"]`).forEach(fn);
  each("id", (el) => (el.textContent = issue.id));
  each("title", (el) => (el.textContent = issue.title));
  each("labels", (el) => el.replaceChildren(...labelBadges(issue.labels)));
  each("prio", (el) => (el.textContent = PRIORITY_NAMES[issue.priority]));
  each("due", (el) => (el.textContent = shortDate(issue.due)));
  each("project-chip", (el) => fillProject(el, issue.project));
  each("cycle", (el) => {
    const cycle = store.boot.cycles.find((c) => c.id === issue.cycle);
    el.textContent = cycle ? "Cycle " + cycle.number : "—";
  });
  each("desc", (el) => {
    const paragraphs = (issue.description || "No description yet.").split(/\n{2,}/).map((text) => {
      const p = document.createElement("p");
      p.textContent = text;
      return p;
    });
    el.replaceChildren(...paragraphs);
  });
  node.querySelectorAll(".pm-assignee").forEach((avatar) => fillAvatar(avatar, issue.assignee));
  return node;
}

/** Fills the status, priority and assignee selects of a form or page and selects the issue's values. */
export function fillSelects(root: ParentNode, values: Partial<Record<"status" | "priority" | "assignee", string>>) {
  for (const select of root.querySelectorAll<HTMLSelectElement>('select[data-field="assignee"], select[name="assignee"]')) {
    const first = select.options[0]?.cloneNode(true) as HTMLOptionElement | undefined;
    select.replaceChildren(...(first ? [first] : []));
    for (const p of store.boot.people) select.add(new Option(p.name, p.id));
  }
  for (const [field, value] of Object.entries(values))
    root.querySelectorAll<HTMLSelectElement>(`select[data-field="${field}"]`).forEach((s) => (s.value = value ?? ""));
}

