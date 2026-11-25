/** VERIFIED: scripts/e2e.ts drives it in Chromium, Firefox and WebKit. The viewer's inbox, from the store, worded as the scaffold's notes. */
import type { Notification } from "../../core/model.ts";
import { ago, clone, fillAvatar, PRIORITY_NAMES, shortDate, STATUS_NAMES } from "../dom.ts";
import { nameOf, store } from "../store.ts";

const ICONS: Record<Notification["kind"], string> = {
  comment: "message-square",
  assigned: "user-round",
  status: "circle-dot",
  mention: "at-sign",
  priority: "signal",
  closed: "circle-check",
  due: "calendar",
  overdue: "calendar-x",
};

/** The headline before and after the issue ID, and the small line below it. */
function wording(n: Notification): [string, string, string] {
  const title = store.issues.get(n.issue)?.title ?? "";
  switch (n.kind) {
    case "comment":
      return ["commented on", "", n.detail];
    case "assigned":
      return ["assigned you to", "", title];
    case "status":
      return ["moved to " + (STATUS_NAMES[n.detail as keyof typeof STATUS_NAMES] ?? n.detail), "", title];
    case "mention":
      return ["mentioned you in", "", n.detail];
    case "priority":
      return ["set priority to " + (PRIORITY_NAMES[n.detail as keyof typeof PRIORITY_NAMES] ?? n.detail) + " on", "", title];
    case "closed":
      return ["closed", "", title];
    case "due":
      return ["", "is due today", title];
    case "overdue":
      return ["", "is overdue since " + shortDate(n.detail), title];
  }
}

export const unread = () => store.inbox.filter((n) => !n.read).length;

export function renderInbox(app: HTMLElement) {
  app.querySelector(".pm-notes")?.replaceChildren(
    ...store.inbox.map((n) => {
      const li = clone("pm-tpl-note");
      const link = li.querySelector<HTMLAnchorElement>(".pm-note")!;
      link.href = "#/issues/" + n.issue;
      link.dataset.note = n.id;
      link.toggleAttribute("data-unread", !n.read);
      fillAvatar(li.querySelector(".avatar")!, n.actor);
      li.querySelector(".pm-note-icon")!.innerHTML = `<i data-lucide="${ICONS[n.kind]}"></i>`;
      const [before, after, small] = wording(n);
      const head = li.querySelector(".pm-note-body > span")!;
      const id = document.createElement("span");
      id.className = "pm-id";
      id.textContent = n.issue;
      const who = document.createElement("strong");
      who.textContent = n.actor ? nameOf(n.actor) : "";
      head.replaceChildren(...(n.actor ? [who, " "] : []), ...(before ? [before + " "] : []), id, ...(after ? [" " + after] : []));
      li.querySelector(".pm-note-body > small")!.textContent = small;
      li.querySelector("time")!.textContent = ago(n.at);
      return li;
    }),
  );
  const count = unread();
  app.querySelectorAll<HTMLElement>("[data-pm-unread]").forEach((badge) => {
    badge.textContent = String(count);
    badge.hidden = !count;
  });
}
