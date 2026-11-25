/** VERIFIED: scripts/e2e.ts drives it in Chromium, Firefox and WebKit. The issue page of the current route: one section stamped from the scaffold's `pm-tpl-issue` for the issue in
 * `store.page`, instead of a pre-rendered page per issue. */
import type { IssueEvent } from "../../core/model.ts";
import { ago, fillAvatar, PRIORITY_NAMES, stamp, STATUS_NAMES } from "../dom.ts";
import { nameOf, person, sortedIssues, store } from "../store.ts";

/** What an activity event says, after the actor's name, as the scaffold's feed words it. */
function eventText(event: IssueEvent) {
  if (event.kind === "created") return "created the issue";
  if (event.kind === "commented") return "commented";
  if (event.kind === "attached") return "attached " + String(event.to);
  if (event.field === "status")
    return `moved from ${STATUS_NAMES[event.from as keyof typeof STATUS_NAMES] ?? event.from} to ${STATUS_NAMES[event.to as keyof typeof STATUS_NAMES] ?? event.to}`;
  if (event.field === "priority") return "set priority to " + (PRIORITY_NAMES[event.to as keyof typeof PRIORITY_NAMES] ?? event.to);
  if (event.field === "assignee") return event.to ? "assigned to " + nameOf(event.to as string) : "removed the assignee";
  if (event.field === "subtasks") return "updated the sub-issues";
  if (event.field === "cycle") return "moved to another cycle";
  return "changed the " + (event.field ?? "issue");
}

const sizeOf = (bytes: number) =>
  new Intl.NumberFormat("en", { style: "unit", unit: bytes < 1e6 ? "kilobyte" : "megabyte", maximumFractionDigits: 1 }).format(
    bytes < 1e6 ? bytes / 1e3 : bytes / 1e6,
  );

/** The page for `store.page`; the caller puts it into the views and shows it. */
export function renderIssuePage() {
  const page = store.page!;
  const { issue } = page;
  const section = stamp("pm-tpl-issue", issue);
  // Selects: options from the directory, values from the issue.
  for (const select of section.querySelectorAll<HTMLSelectElement>('select[data-field="assignee"]')) {
    select.replaceChildren(new Option("Unassigned", ""), ...store.boot.people.map((p) => new Option(p.name, p.id)));
  }
  section.querySelectorAll<HTMLSelectElement>("select[data-field]").forEach((s) => {
    s.value = (issue as unknown as Record<string, string | null>)[s.dataset.field!] ?? "";
  });
  // Sub-issues.
  const subs = section.querySelector("[data-pm-subs]")!;
  subs.replaceChildren(
    ...issue.subtasks.map((sub, index) => {
      const li = document.createElement("li");
      li.innerHTML = '<label><input class="checkbox" type="checkbox" /> </label>';
      const box = li.querySelector("input")!;
      box.checked = sub.done;
      box.dataset.pmSub = String(index);
      li.querySelector("label")!.append(sub.title);
      return li;
    }),
  );
  section.querySelector("[data-pm-sub-count]")!.textContent =
    issue.subtasks.filter((s) => s.done).length + "/" + issue.subtasks.length;
  // Attachments.
  section.querySelector("[data-pm-files]")!.replaceChildren(
    ...page.attachments.map((file) => {
      const li = document.createElement("li");
      const open = document.createElement("button");
      open.className = "btn";
      open.dataset.variant = "link";
      open.dataset.size = "sm";
      open.type = "button";
      open.dataset.pmDownload = file.name;
      open.textContent = file.name;
      const size = document.createElement("small");
      size.textContent = sizeOf(file.size);
      const remove = document.createElement("button");
      remove.className = "btn";
      remove.dataset.variant = "ghost";
      remove.dataset.size = "icon-sm";
      remove.type = "button";
      remove.dataset.pmUnattach = file.name;
      remove.setAttribute("aria-label", "Remove " + file.name);
      remove.innerHTML = '<i data-lucide="x"></i>';
      li.append(open, size, remove);
      return li;
    }),
  );
  // Activity: events and comments in time order.
  const feed = [
    ...page.events.filter((e) => e.kind !== "commented").map((e) => ({ at: e.at, node: eventNode(e) })),
    ...page.comments.map((c) => ({ at: c.createdAt, node: commentNode(c.author, c.body, c.createdAt) })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  section.querySelector(".pm-feed")!.replaceChildren(...feed.map((f) => f.node));
  const me = section.querySelector(".pm-comment-form .avatar");
  if (me) fillAvatar(me, store.boot.viewer);
  // Previous and next follow the list order.
  const order = sortedIssues().map((i) => i.id);
  const at = order.indexOf(issue.id);
  section.querySelector("[data-pm-prev]")?.setAttribute("href", "#/issues/" + (order[at - 1] ?? issue.id));
  section.querySelector("[data-pm-next]")?.setAttribute("href", "#/issues/" + (order[at + 1] ?? issue.id));
  return section;
}

function eventNode(event: IssueEvent) {
  const li = document.createElement("li");
  li.className = "pm-event";
  li.innerHTML = '<i data-lucide="circle-dot"></i><span><strong></strong> </span><time></time>';
  li.querySelector("strong")!.textContent = nameOf(event.actor);
  li.querySelector("span")!.append(eventText(event));
  li.querySelector("time")!.textContent = ago(event.at) === "just now" ? "just now" : ago(event.at) + " ago";
  return li;
}

function commentNode(author: string, body: string, at: string) {
  const li = document.createElement("li");
  li.className = "pm-comment";
  li.innerHTML =
    '<span class="avatar pm-mini" data-size="sm"></span><div><p class="pm-comment-head"><strong></strong><time></time></p><p></p></div>';
  fillAvatar(li.querySelector(".avatar")!, author);
  li.querySelector("strong")!.textContent = person(author)?.name ?? author;
  li.querySelector("time")!.textContent = ago(at) === "just now" ? "just now" : ago(at) + " ago";
  li.querySelector("p:last-child")!.textContent = body;
  return li;
}

