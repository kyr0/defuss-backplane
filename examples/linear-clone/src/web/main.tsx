/** VERIFIED: scripts/e2e.ts runs the whole journey on it in Chromium and the smoke in Firefox and WebKit. The
 * tracker in the browser: loads the workspace over RPC, binds every rendered region to the store with defuss-morph's
 * `reactive()`, routes with defuss-dom-router in hash mode, translates the shell with defuss-i18n and wires the
 * scaffold's interactions with defuss-query. No code here writes markup by hand: regions are JSX morphed into place,
 * and the shell changes through defuss-query's `attr`, `prop`, `text` and `val`. */
import { createRouter } from "defuss-dom-router";
import { createDomI18n, createI18n } from "defuss-i18n/core";
import { morph } from "defuss-morph";
import df$ from "defuss-query";
import { createIcons } from "lucide";
import type { Fields, Label, Priority, Status } from "../core/issue.ts";
import * as act from "./actions.ts";
import { api, connect } from "./client.ts";
import { toast, ui } from "./env.ts";
import { initials } from "./format.ts";
import { ICONS } from "./icons.tsx";
import { appStore, changed, person, putIssue, store, type View } from "./store.ts";
import { bindCycles } from "./views/cycles.tsx";
import { bindInbox } from "./views/inbox.tsx";
import { bindIssuePage } from "./views/issue.tsx";
import { bindIssues } from "./views/issues.tsx";
import { bindProjects } from "./views/projects.tsx";

if (document.readyState === "loading") await new Promise((done) => df$(document).on("DOMContentLoaded", done));
const app = df$<HTMLElement>("[data-pm]")[0]!;
const VIEWS: View[] = ["my-issues", "inbox", "cycles", "projects"];

await connect();
const [boot, issues, inbox] = await Promise.all([api().Workspace.bootstrap(), api().Issues.list(), api().Inbox.list()]);
store.boot = boot;
issues.forEach(putIssue);
store.inbox = inbox;

// -- the shell: icons once, the viewer, and the create form's people
createIcons({ icons: ICONS });
const me = person(boot.viewer)?.name ?? boot.viewer;
df$("[data-pm-viewer] .avatar-fallback", app).text(initials(me));
df$("[data-pm-viewer-name]", app).text(me);
const form = df$<HTMLFormElement>("[data-pm-new]", app);
morph(form.find('select[name="assignee"]')[0]!, [
  <option value="">Assignee</option>,
  ...boot.people.map((p) => <option value={p.id}>{p.name}</option>),
]);

// -- the regions, each rendered from the store whenever it changes
bindIssues(app);
bindIssuePage(df$<HTMLElement>("#issue", app)[0]!);
bindInbox(app);
bindCycles(app);
bindProjects(app);

/** Shows the route's section and marks its sidebar link, as the scaffold's sync() does. */
function show() {
  df$(".pm-view", app).each((_i, section) => void df$(section).prop("hidden", section.id !== store.view));
  const nav = VIEWS.includes(store.view) ? "#/" + store.view : "#/";
  df$('.sidebar-link[href^="#"]', app).each((_i, a) => {
    const here = a.getAttribute("href") === nav && !(a as HTMLElement).dataset.alias;
    df$(a).attr("aria-current", here ? "page" : null);
  });
  df$<HTMLDialogElement>("#pm-mobile-nav").each((_i, dialog) => void (dialog.open && dialog.close()));
}
appStore.subscribe(show);

// -- translation: the markup is the catalog; the choice persists, as the theme and the layout do
const savedLocale = ui.store.persisted("vector:locale", "en");
const locale = createI18n({ locale: savedLocale.value });
createDomI18n(ui as never).bind(app, locale);
ui("[data-app-locale]").each((_i, el) => ui.shadcn.languageSwitcher.bind(el, locale));
locale.subscribe((snapshot) => savedLocale.set(snapshot.locale));

const root = df$(document.documentElement);
const savedTheme = ui.store.persisted<"" | "dark" | "light">("vector:theme", "");
if (savedTheme.value) root.toggleClass("dark", savedTheme.value === "dark");

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
    let view: View = "issues";
    if (to.routeId === "issue") {
      const id = String(to.params.id);
      // An issue the tracker does not have (deleted, or a typo) shows the list.
      if (await act.openPage(id)) view = "issue";
      else toast("No issue " + id);
    } else if (VIEWS.includes(to.routeId as View)) view = to.routeId as View;
    return {
      commit: () => {
        if (view !== "issue") store.page = null;
        store.view = view;
        changed();
      },
    };
  },
});
router.attachLinks(app);

// -- the create dialog
const dialog = df$<HTMLDialogElement>("#pm-create", app)[0]!;
function openCreate(status = "todo") {
  form[0]!.reset();
  form.find('select[name="status"]').val(status);
  form.find(".pm-pill[data-status]").attr("data-status", status);
  form.find(".pm-pill[data-priority]").attr("data-priority", "none");
  dialog.showModal();
  form.find<HTMLInputElement>('[name="title"]')[0]!.focus();
}
form.on("submit", async (e: Event) => {
  e.preventDefault();
  const data = form.form();
  const field = (name: string) => String(data.get(name) ?? "").trim();
  const created = await act.create({
    title: field("title"),
    description: field("desc"),
    status: field("status") as Status,
    priority: field("priority") as Priority,
    assignee: field("assignee") || null,
    labels: field("label") ? [field("label") as Label] : [],
  } satisfies Partial<Fields>);
  if (!created) return;
  if (df$<HTMLInputElement>("#pm-new-more").prop("checked")) {
    form.find('[name="title"], [name="desc"]').val("");
    form.find<HTMLInputElement>('[name="title"]')[0]!.focus();
  } else dialog.close();
});
form.on("change", (e: Event) => {
  const select = df$(e.target as HTMLSelectElement);
  const name = select.attr("name");
  if (name === "status" || name === "priority") select.closest(".pm-pill").attr("data-" + name, String(select.val()));
});

// -- clicks on the shell: navigation, create, layout, theme, inbox and the scaffold's toasts
df$(app).on("click", (e: Event) => {
  const target = df$(e.target as HTMLElement);
  const go = target.closest("[data-go]");
  if (go.length) location.hash = go.attr("data-go")!;
  const create = target.closest("[data-pm-create]");
  if (create.length) openCreate(create.attr("data-pm-status") ?? undefined);
  const layout = target.closest("[data-pm-layout]");
  if (layout.length) {
    df$<HTMLButtonElement>(`.pm-layout .toggle[value="${layout.attr("data-pm-layout")}"]`, app)[0]?.click();
    location.hash = "/";
  }
  if (target.closest("[data-pm-theme]").length) {
    const dark = !root.hasClass("dark");
    root.toggleClass("dark", dark);
    savedTheme.set(dark ? "dark" : "light");
  }
  const note = target.closest(".pm-note[data-unread]");
  if (note.length) void act.markRead([note.attr("data-note")!]);
  if (target.closest("[data-pm-read-all]").length) void act.markRead();
  const t = target.closest("[data-toast]");
  if (t.length) toast(t.attr("data-toast")!, t.attr("data-toast-desc") ?? undefined);
});

// -- right-click: the context menu acts on the issue it opened on
let menuIssue: string | null = null;
df$(app).on("contextmenu", (e: Event) => void (menuIssue = df$(e.target as HTMLElement).closest("[data-issue]").attr("data-issue") ?? null), true);
df$("#pm-ctx", app).on("click", (e: Event) => {
  const item = df$(e.target as HTMLElement).closest(".context-menu-item");
  if (!item.length || !menuIssue) return;
  const status = item.attr("data-set-status");
  if (status) void act.update(menuIssue, { status: status as Status });
  const ctx = item.attr("data-ctx");
  if (ctx === "mine") void act.update(menuIssue, { assignee: store.boot.viewer });
  if (ctx === "copy") {
    navigator.clipboard?.writeText(menuIssue).catch(() => {});
    toast("Copied " + menuIssue);
  }
  if (ctx === "delete") void act.remove(menuIssue);
});

// -- the board: native drag and drop between columns
const board = df$(".pm-board", app);
let dragged: string | null = null;
const clearDrag = () => {
  board.find("[data-over]").attr("data-over", null);
  board.find("[data-dragging]").attr("data-dragging", null);
};
board.on("dragstart", (e: Event) => {
  const card = df$(e.target as HTMLElement).closest(".pm-card");
  const transfer = (e as DragEvent).dataTransfer;
  dragged = card.attr("data-issue") ?? null;
  if (!dragged) return;
  transfer?.setData("text/plain", dragged);
  if (transfer) transfer.effectAllowed = "move";
  card.attr("data-dragging", "");
});
board.on("dragend", () => {
  clearDrag();
  dragged = null;
});
board.on("dragover", (e: Event) => {
  const column = df$(e.target as HTMLElement).closest(".pm-col");
  if (!column.length || !dragged) return;
  e.preventDefault();
  board.find(".pm-col[data-over]").filter((c) => c !== column[0]).attr("data-over", null);
  column.attr("data-over", "");
});
board.on("drop", (e: Event) => {
  const column = df$(e.target as HTMLElement).closest(".pm-col");
  if (!column.length || !dragged) return;
  e.preventDefault();
  const id = dragged;
  const status = column.attr("data-status") as Status;
  clearDrag();
  dragged = null;
  if (store.issues.get(id)?.status !== status) void act.update(id, { status });
});

df$("[data-pm-filter]", app).on("input", (e: Event) => {
  store.filter = String(df$(e.target as HTMLInputElement).val() ?? "");
  changed();
});

// -- keyboard: C creates, J / K move through the visible issues, Esc leaves an issue
df$(document).on("keydown", (event: Event) => {
  const e = event as KeyboardEvent;
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  if (df$(e.target as HTMLElement).closest("input, textarea, select, [contenteditable]").length || df$("dialog[open]").length) return;
  const key = e.key.toLowerCase();
  if (key === "c") {
    e.preventDefault();
    openCreate();
  }
  if (key === "j" || key === "k") {
    const items = df$<HTMLElement>(".pm-view:not([hidden]) :is(.pm-row-link, .pm-card)", app).filter((x) => x.checkVisibility());
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[Math.min(items.length - 1, Math.max(0, at < 0 ? 0 : at + (key === "j" ? 1 : -1)))]!.focus();
  }
  if (e.key === "Escape" && store.page) location.hash = "/";
});

// -- the layout (list, board or table) is remembered, fed by the toggles' aria-pressed, as in the scaffold
const savedLayout = ui.store.persisted("vector:layout", "list");
const group = df$(".pm-layout", app);
if (group.length) {
  const pressed = () => group.find('.toggle[aria-pressed="true"]').attr("value") || "list";
  if (savedLayout.value !== pressed()) group.find<HTMLButtonElement>(`.toggle[value="${savedLayout.value}"]`)[0]?.click();
  new MutationObserver(() => savedLayout.set(pressed())).observe(group[0]!, { attributes: true, subtree: true, attributeFilter: ["aria-pressed"] });
}

await router.start();
df$(app).attr("data-ready", "");
