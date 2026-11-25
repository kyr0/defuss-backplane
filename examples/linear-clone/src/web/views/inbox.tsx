/** VERIFIED: scripts/e2e.ts reads and marks the inbox. The viewer's inbox as a `reactive()` region, worded as the
 * scaffold's notes, and the unread badges beside it. */
import { reactive } from "defuss-morph";
import df$ from "defuss-query";
import type { Notification } from "../../core/model.ts";
import { ago, PRIORITY_NAMES, shortDate, STATUS_NAMES } from "../format.ts";
import { Icon } from "../icons.tsx";
import { appStore, nameOf, store } from "../store.ts";
import { Avatar } from "./parts.tsx";

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

/** The headline's words before and after the issue ID, and the small line below it. */
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

export function Note({ note }: { note: Notification }) {
  const [before, after, small] = wording(note);
  return (
    <li key={note.id}>
      <a class="pm-note" href={"#/issues/" + note.issue} data-router-link="" data-note={note.id} data-unread={!note.read}>
        <span class="pm-note-av">
          <Avatar who={note.actor} />
          <span class="pm-note-icon">
            <Icon name={ICONS[note.kind]} />
          </span>
        </span>
        <span class="pm-note-body">
          <span>
            {note.actor ? [<strong>{nameOf(note.actor)}</strong>, " "] : []}
            {before ? before + " " : ""}
            <span class="pm-id">{note.issue}</span>
            {after ? " " + after : ""}
          </span>
          <small>{small}</small>
        </span>
        <time>{ago(note.at)}</time>
      </a>
    </li>
  );
}

export function bindInbox(app: HTMLElement) {
  const notes = app.querySelector(".pm-notes");
  if (notes) reactive({ store: appStore, render: () => store.inbox.map((note) => <Note note={note} />) }, notes);
  const badges = app.querySelectorAll<HTMLElement>("[data-pm-unread]");
  reactive({ store: appStore, render: () => String(unread()) }, badges);
  const hide = () => void df$(badges).prop("hidden", !unread());
  hide();
  appStore.subscribe(hide);
}
