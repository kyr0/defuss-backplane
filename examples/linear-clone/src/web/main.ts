/** VERIFIED: scripts/e2e.ts drives it in Chromium, Firefox and WebKit. The tracker in the browser: loads the workspace over RPC, renders every view from the store, routes with
 * defuss-dom-router in hash mode, translates the shell with defuss-i18n and wires the scaffold's interactions to
 * actions. Lucide comes from npm and draws the icons after each render, so the page makes no third-party request. */
import { createRouter } from "defuss-dom-router";
import { createDomI18n, createI18n } from "defuss-i18n/core";
import { createIcons, icons } from "lucide";
import type { Fields, Label, Priority, Status } from "../core/issue.ts";
import * as act from "./actions.ts";
import { api, connect } from "./client.ts";
import { fillSelects } from "./dom.ts";
import { df$, toast } from "./env.ts";
import { putIssue, store, subscribe } from "./store.ts";
import { renderCycles } from "./views/cycles.ts";
import { renderInbox } from "./views/inbox.ts";
import { renderIssuePage } from "./views/issue.ts";
import { applyFilter, renderIssues } from "./views/issues.ts";
import { renderProjects } from "./views/projects.ts";

if (document.readyState === "loading") await new Promise((done) => addEventListener("DOMContentLoaded", done, { once: true }));
const app = document.querySelector<HTMLElement>("[data-pm]")!;
const VIEWS = ["my-issues", "inbox", "cycles", "projects"];
/** The section the route shows: a view's ID, or "issue" for the page in `store.page`. */
let current = "issues";

await connect();
const [boot, issues, inbox] = await Promise.all([api().Workspace.bootstrap(), api().Issues.list(), api().Inbox.list()]);
store.boot = boot;
issues.forEach(putIssue);
store.inbox = inbox;

function show() {
  const page = app.querySelector<HTMLElement>("section.pm-issue");
  app.querySelectorAll<HTMLElement>(".pm-view").forEach((section) => {
    section.hidden = current === "issue" ? section !== page : section.id !== current;
  });
  // The sidebar marks the current link, as the scaffold's sync() does.
  const nav = VIEWS.includes(current) ? current : "issues";
  app.querySelectorAll('.sidebar-link[href^="#"]').forEach((a) => {
    const here = a.getAttribute("href") === (nav === "issues" ? "#/" : "#/" + nav) && !(a as HTMLElement).dataset.alias;
    if (here) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  const mobile = document.getElementById("pm-mobile-nav") as HTMLDialogElement | null;
  if (mobile?.open) mobile.close();
}

function render() {
  renderIssues(app);
  renderInbox(app);
  renderCycles(app);
  renderProjects(app);
  app.querySelector("section.pm-issue")?.remove();
  if (store.page) app.querySelector(".pm-views")!.append(renderIssuePage());
  show();
  createIcons({ icons });
}
subscribe(render);
fillSelects(app.querySelector("[data-pm-new]")!, {});

// -- translation: the markup is the catalog; the choice persists, as the theme and the layout do
const savedLocale = df$.store.persisted("vector:locale", "en");
const locale = createI18n({ locale: savedLocale.value });
createDomI18n(df$ as never).bind(app, locale);
df$("[data-app-locale]").each((_i, el) => df$.shadcn.languageSwitcher.bind(el, locale));
locale.subscribe((snapshot) => savedLocale.set(snapshot.locale));

const savedTheme = df$.store.persisted<"" | "dark" | "light">("vector:theme", "");
if (savedTheme.value) document.documentElement.classList.toggle("dark", savedTheme.value === "dark");

// -- routing: the views, and one route per issue (#/issues/ENG-142), whose data loads before it shows
const router = createRouter({
  mode: "hash",
  routes: [
    { id: "issues", path: "/" },
    ...VIEWS.map((id) => ({ id, path: "/" + id })),
    { id: "issue", path: "/issues/:id" },
    { id: "missing", path: "*" },
  ],
  prepare: async ({ to }) => {
    if (to.routeId === "issue") {
      const id = String(to.params.id);
      const found = await act.openPage(id);
      // An issue the tracker does not have (deleted, or a typo) shows the list.
      current = found ? "issue" : "issues";
      if (!found) toast("No issue " + id);
    } else {
      store.page = null;
      current = to.routeId && VIEWS.includes(to.routeId) ? to.routeId : "issues";
    }
    return { commit: render };
  },
});
router.attachLinks(app);

// -- the create dialog
const createDialog = app.querySelector<HTMLDialogElement>("#pm-create")!;
const form = app.querySelector<HTMLFormElement>("[data-pm-new]")!;
function openCreate(status?: string) {
  form.reset();
  (form.elements.namedItem("status") as HTMLSelectElement).value = status || "todo";
  form.querySelector<HTMLElement>(".pm-pill[data-status]")!.dataset.status = status || "todo";
  form.querySelector<HTMLElement>(".pm-pill[data-priority]")!.dataset.priority = "none";
  createDialog.showModal();
  (form.elements.namedItem("title") as HTMLInputElement).focus();
}
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value.trim();
  const draft: Partial<Fields> = {
    title: field("title"),
    description: field("desc"),
    status: field("status") as Status,
    priority: field("priority") as Priority,
    assignee: field("assignee") || null,
    labels: field("label") ? [field("label") as Label] : [],
  };
  const created = await act.create(draft);
  if (!created) return;
  if (document.querySelector<HTMLInputElement>("#pm-new-more")?.checked) {
    (form.elements.namedItem("title") as HTMLInputElement).value = "";
    (form.elements.namedItem("desc") as HTMLTextAreaElement).value = "";
    (form.elements.namedItem("title") as HTMLInputElement).focus();
  } else createDialog.close();
});

// -- edits on the issue page, sub-issues and attachments
const pageIssue = () => store.page?.issue;
app.addEventListener("change", (e) => {
  const target = e.target as HTMLElement;
  const select = target.closest<HTMLSelectElement>("section.pm-issue select[data-field]");
  const issue = pageIssue();
  if (select && issue) void act.update(issue.id, { [select.dataset.field!]: select.value || null });
  const sub = target.closest<HTMLInputElement>("input[data-pm-sub]");
  if (sub && issue) void act.toggleSubtask(issue, Number(sub.dataset.pmSub), sub.checked);
  const file = target.closest<HTMLInputElement>("input[data-pm-attach]");
  if (file?.files?.[0] && issue) void act.attach(issue.id, file.files[0]);
  const pill = target.closest<HTMLElement>(".pm-pill");
  if (pill && (target as HTMLSelectElement).name === "status") pill.dataset.status = (target as HTMLSelectElement).value;
  if (pill && (target as HTMLSelectElement).name === "priority") pill.dataset.priority = (target as HTMLSelectElement).value;
});
app.addEventListener("submit", (e) => {
  const target = e.target as HTMLFormElement;
  const issue = pageIssue();
  if (!issue) return;
  if (target.matches("[data-pm-comment]")) {
    e.preventDefault();
    const body = (target.elements.namedItem("body") as HTMLTextAreaElement).value.trim();
    if (body) void act.comment(issue.id, body);
  }
  if (target.matches("[data-pm-sub-new]")) {
    e.preventDefault();
    const title = (target.elements.namedItem("title") as HTMLInputElement).value.trim();
    if (title) void act.addSubtask(issue, title);
  }
});

// -- clicks: navigation, create, layout, theme, inbox, copy, star, files, toasts
app.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const go = target.closest<HTMLElement>("[data-go]");
  if (go) location.hash = go.dataset.go!;
  const create = target.closest<HTMLElement>("[data-pm-create]");
  if (create) openCreate(create.dataset.pmStatus);
  const layout = target.closest<HTMLElement>("[data-pm-layout]");
  if (layout) {
    app.querySelector<HTMLElement>(`.pm-layout .toggle[value="${layout.dataset.pmLayout}"]`)?.click();
    location.hash = "/";
  }
  if (target.closest("[data-pm-theme]")) {
    const dark = document.documentElement.classList.toggle("dark");
    savedTheme.set(dark ? "dark" : "light");
  }
  const note = target.closest<HTMLElement>(".pm-note");
  if (note?.hasAttribute("data-unread")) void act.markRead([note.dataset.note!]);
  if (target.closest("[data-pm-read-all]")) void act.markRead();
  const copy = target.closest("[data-pm-copy]");
  const issue = pageIssue();
  if (copy && issue) {
    navigator.clipboard?.writeText(location.href.split("#")[0] + "#/issues/" + issue.id).catch(() => {});
    toast("Link to " + issue.id + " copied");
  }
  const star = target.closest<HTMLElement>("[data-pm-star]");
  if (star) {
    const on = star.getAttribute("aria-pressed") !== "true";
    star.setAttribute("aria-pressed", String(on));
    toast(on ? "Added to favorites" : "Removed from favorites");
  }
  const download = target.closest<HTMLElement>("[data-pm-download]");
  if (download && issue) void act.download(issue.id, download.dataset.pmDownload!);
  const unattach = target.closest<HTMLElement>("[data-pm-unattach]");
  if (unattach && issue) void act.unattach(issue.id, unattach.dataset.pmUnattach!);
  const t = target.closest<HTMLElement>("[data-toast]");
  if (t) toast(t.dataset.toast!, t.dataset.toastDesc);
});

// -- right-click: the context menu acts on the issue it opened on
let menuIssue: string | null = null;
app.addEventListener("contextmenu", (e) => (menuIssue = (e.target as HTMLElement).closest<HTMLElement>("[data-issue]")?.dataset.issue ?? null), true);
app.querySelector("#pm-ctx")!.addEventListener("click", (e) => {
  const item = (e.target as HTMLElement).closest<HTMLElement>(".context-menu-item");
  if (!item || !menuIssue) return;
  if (item.dataset.setStatus) void act.update(menuIssue, { status: item.dataset.setStatus as Status });
  if (item.dataset.ctx === "mine") void act.update(menuIssue, { assignee: store.boot.viewer });
  if (item.dataset.ctx === "copy") {
    navigator.clipboard?.writeText(menuIssue).catch(() => {});
    toast("Copied " + menuIssue);
  }
  if (item.dataset.ctx === "delete") void act.remove(menuIssue);
});

// -- the board: native drag and drop between columns
const board = app.querySelector<HTMLElement>(".pm-board")!;
let dragged: string | null = null;
const clearDrag = () => board.querySelectorAll("[data-over], [data-dragging]").forEach((x) => x.removeAttribute(x.hasAttribute("data-over") ? "data-over" : "data-dragging"));
board.addEventListener("dragstart", (e) => {
  const card = (e.target as HTMLElement).closest<HTMLElement>(".pm-card");
  if (!card) return;
  dragged = card.dataset.issue!;
  e.dataTransfer?.setData("text/plain", dragged);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  card.setAttribute("data-dragging", "");
});
board.addEventListener("dragend", () => {
  clearDrag();
  dragged = null;
});
board.addEventListener("dragover", (e) => {
  const column = (e.target as HTMLElement).closest(".pm-col");
  if (!column || !dragged) return;
  e.preventDefault();
  board.querySelectorAll(".pm-col[data-over]").forEach((c) => c !== column && c.removeAttribute("data-over"));
  column.setAttribute("data-over", "");
});
board.addEventListener("drop", (e) => {
  const column = (e.target as HTMLElement).closest<HTMLElement>(".pm-col");
  if (!column || !dragged) return;
  e.preventDefault();
  const id = dragged;
  clearDrag();
  dragged = null;
  if (store.issues.get(id)?.status !== column.dataset.status) void act.update(id, { status: column.dataset.status as Status });
});

app.querySelector("[data-pm-filter]")?.addEventListener("input", () => applyFilter(app));

// -- keyboard: C creates, J / K move through the visible issues, Esc leaves an issue
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target as HTMLElement;
  if (
    target.closest?.("input, textarea, select, [contenteditable]") ||
    document.querySelector("dialog[open], [role='menu']:popover-open, .context-menu:popover-open, .popover:popover-open")
  )
    return;
  const key = e.key.toLowerCase();
  if (key === "c") {
    e.preventDefault();
    openCreate();
  }
  if (key === "j" || key === "k") {
    const items = [...app.querySelectorAll<HTMLElement>(".pm-view:not([hidden]) :is(.pm-row-link, .pm-card)")].filter((x) => x.checkVisibility());
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[Math.min(items.length - 1, Math.max(0, at < 0 ? 0 : at + (key === "j" ? 1 : -1)))]!.focus();
  }
  if (e.key === "Escape" && store.page) location.hash = "/";
});

// -- the layout (list or board) is remembered, fed by the toggles' aria-pressed, as in the scaffold
const savedLayout = df$.store.persisted("vector:layout", "list");
const group = app.querySelector<HTMLElement>(".pm-layout");
if (group) {
  const pressed = () => group.querySelector<HTMLButtonElement>('.toggle[aria-pressed="true"]')?.value || "list";
  if (savedLayout.value !== pressed()) group.querySelector<HTMLElement>(`.toggle[value="${savedLayout.value}"]`)?.click();
  new MutationObserver(() => savedLayout.set(pressed())).observe(group, { attributes: true, subtree: true, attributeFilter: ["aria-pressed"] });
}

await router.start();
app.dataset.ready = "";
