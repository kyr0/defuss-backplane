/** VERIFIED: scripts/e2e.ts edits, comments, uploads and downloads through it. The issue page of the current route:
 * one static section whose content is a `reactive()` region rendered from `store.page`, with JSX event props for the
 * edits. Why not one pre-rendered page per issue, as in the scaffold: the tracker has as many issues as people create,
 * and morph keeps the page's nodes across edits, so a typed comment survives a status change. */
import df$ from "defuss-query";
import { reactive } from "defuss-morph";
import { PRIORITIES, STATUSES } from "../../core/issue.ts";
import type { IssueEvent } from "../../core/model.ts";
import * as act from "../actions.ts";
import { toast } from "../env.ts";
import { ago, PRIORITY_NAMES, shortDate, sizeOf, STATUS_NAMES } from "../format.ts";
import { Icon } from "../icons.tsx";
import { appStore, changed, nameOf, person, sortedIssues, store, type IssuePage } from "../store.ts";
import { Avatar, Labels, ProjectChip } from "./parts.tsx";

/** What an activity event says after the actor's name, as the scaffold's feed words it. */
function eventText(event: IssueEvent) {
  const status = (value: unknown) => STATUS_NAMES[value as keyof typeof STATUS_NAMES] ?? String(value);
  if (event.kind === "created") return "created the issue";
  if (event.kind === "commented") return "commented";
  if (event.kind === "attached") return "attached " + String(event.to);
  if (event.field === "status") return `moved from ${status(event.from)} to ${status(event.to)}`;
  if (event.field === "priority") return "set priority to " + (PRIORITY_NAMES[event.to as keyof typeof PRIORITY_NAMES] ?? event.to);
  if (event.field === "assignee") return event.to ? "assigned to " + nameOf(event.to as string) : "removed the assignee";
  if (event.field === "subtasks") return "updated the sub-issues";
  if (event.field === "cycle") return "moved to another cycle";
  return "changed the " + (event.field ?? "issue");
}

const when = (instant: string) => (ago(instant) === "just now" ? "just now" : ago(instant) + " ago");

/** Activity: events and comments in time order; a comment's own event is the comment. */
const feed = (page: IssuePage) =>
  [
    ...page.events
      .filter((e) => e.kind !== "commented")
      .map((e, i) => ({
        at: e.at,
        node: (
          <li key={"e" + i + e.at} class="pm-event">
            <Icon name="circle-dot" />
            <span>
              <strong>{nameOf(e.actor)}</strong> {eventText(e)}
            </span>
            <time>{when(e.at)}</time>
          </li>
        ),
      })),
    ...page.comments.map((c) => ({
      at: c.createdAt,
      node: (
        <li key={"c" + c.id} class="pm-comment">
          <Avatar who={c.author} />
          <div>
            <p class="pm-comment-head">
              <strong>{person(c.author)?.name ?? c.author}</strong>
              <time>{when(c.createdAt)}</time>
            </p>
            <p>{c.body}</p>
          </div>
        </li>
      ),
    })),
  ]
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .map((f) => f.node);

/** A property row with a select, as the scaffold's: label, then the field with its marker (status dot, priority
 * bars or avatar) before the select. The `selected` option, not the select's value, carries the choice: morph sets
 * attributes before it adds the options. */
function Select(props: { field: string; label: string; value: string; options: [string, string][]; lead: unknown }) {
  const { field, label, value, options, lead } = props;
  const id = "issue-l-" + field;
  return (
    <div class="pm-prop">
      <span class="pm-prop-label" id={id}>
        {label}
      </span>
      <span class="pm-prop-field">
        {lead}
        <select
      class="select"
      data-field={field}
      aria-labelledby={id}
      onChange={(e: Event) => void act.update(store.page!.issue.id, { [field]: df$(e.target as HTMLSelectElement).val() || null })}
    >
          {options.map(([v, text]) => (
            <option value={v} selected={v === value}>
              {text}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

/** Reads a form's single text field, clears it and hands the trimmed text on. */
const submitText = (name: string, then: (text: string) => void) => (e: Event) => {
  e.preventDefault();
  const field = df$(e.target as HTMLFormElement).find(`[name="${name}"]`);
  const text = String(field.val() ?? "").trim();
  if (!text) return;
  field.val("");
  then(text);
};

export function IssuePageView({ page }: { page: IssuePage }) {
  const { issue } = page;
  const order = sortedIssues().map((i) => i.id);
  const at = order.indexOf(issue.id);
  const cycle = store.boot.cycles.find((c) => c.id === issue.cycle);
  const done = issue.subtasks.filter((s) => s.done).length;
  const copy = () => {
    navigator.clipboard?.writeText(location.href.split("#")[0] + "#/issues/" + issue.id).catch(() => {});
    toast("Link to " + issue.id + " copied");
  };
  const starred = store.starred.has(issue.id);
  const star = () => {
    if (starred) store.starred.delete(issue.id);
    else store.starred.add(issue.id);
    changed();
    toast(starred ? "Removed from favorites" : "Added to favorites");
  };
  return [
    <header class="pm-head">
      <button class="sidebar-trigger" type="button" data-sidebar-trigger="pm-sidebar" aria-label="Toggle sidebar">
        <Icon name="panel-left" />
      </button>
      <button class="sidebar-trigger pm-mobile-trigger" type="button" data-sidebar-mobile="pm-mobile-nav" aria-label="Open navigation">
        <Icon name="menu" />
      </button>
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <ol class="breadcrumb-list">
          <li class="breadcrumb-item">
            <a class="breadcrumb-link" href="#/" data-router-link="">
              Engineering
            </a>
          </li>
          <li class="breadcrumb-separator" aria-hidden="true">
            ›
          </li>
          <li class="breadcrumb-item">
            <span class="breadcrumb-page" aria-current="page">
              {issue.id}
            </span>
          </li>
        </ol>
      </nav>
      <span class="pm-spacer"></span>
      <a class="btn" data-variant="ghost" data-size="icon-sm" href={"#/issues/" + (order[at - 1] ?? issue.id)} data-router-link="" aria-label="Previous issue" data-pm-prev="">
        <Icon name="chevron-up" />
      </a>
      <a class="btn" data-variant="ghost" data-size="icon-sm" href={"#/issues/" + (order[at + 1] ?? issue.id)} data-router-link="" aria-label="Next issue" data-pm-next="">
        <Icon name="chevron-down" />
      </a>
      <button class="btn" data-variant="ghost" data-size="icon-sm" type="button" aria-label="Copy issue link" onClick={copy}>
        <Icon name="link" />
      </button>
      <button class="btn pm-star" data-variant="ghost" data-size="icon-sm" type="button" aria-pressed={String(starred)} aria-label="Favorite" onClick={star}>
        <Icon name="star" />
      </button>
    </header>,
    <div class="pm-issue-body">
      <article class="pm-issue-main">
        <h1 class="pm-issue-title">{issue.title}</h1>
        <div class="pm-issue-desc">{(issue.description || "No description yet.").split(/\n{2,}/).map((text) => <p>{text}</p>)}</div>
        <section class="pm-sub" aria-labelledby="issue-sub">
          <h2 id="issue-sub">
            Sub-issues <span class="pm-sub-count" data-pm-sub-count="">{done + "/" + issue.subtasks.length}</span>
          </h2>
          <ul class="pm-sub-list" data-pm-subs="">
            {issue.subtasks.map((sub, index) => (
              <li key={"s" + index}>
                <label>
                  <input
                    class="checkbox"
                    type="checkbox"
                    data-pm-sub={String(index)}
                    checked={sub.done}
                    onChange={(e: Event) => void act.toggleSubtask(issue.id, index, (e.target as HTMLInputElement).checked)}
                  />{" "}
                  {sub.title}
                </label>
              </li>
            ))}
          </ul>
          <form class="pm-sub-form" data-pm-sub-new="" onSubmit={submitText("title", (title) => void act.addSubtask(issue.id, title))}>
            <input class="input" name="title" placeholder="Add a sub-issue…" aria-label="Sub-issue" autocomplete="off" required />
          </form>
        </section>
        <section class="pm-files" aria-labelledby="issue-files">
          <h2 id="issue-files">Attachments</h2>
          <ul class="pm-file-list" data-pm-files="">
            {page.attachments.map((file) => (
              <li key={file.name}>
                <button class="btn" data-variant="link" data-size="sm" type="button" data-pm-download={file.name} onClick={() => void act.download(issue.id, file.name)}>
                  {file.name}
                </button>
                <small>{sizeOf(file.size)}</small>
                <button
                  class="btn"
                  data-variant="ghost"
                  data-size="icon-sm"
                  type="button"
                  aria-label={"Remove " + file.name}
                  data-pm-unattach={file.name}
                  onClick={() => void act.unattach(issue.id, file.name)}
                >
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
          <input
            class="file-input"
            type="file"
            data-pm-attach=""
            aria-label="Attach a file"
            onChange={(e: Event) => {
              const input = e.target as HTMLInputElement;
              const file = input.files?.[0];
              if (file) void act.attach(issue.id, file).finally(() => df$(input).val(""));
            }}
          />
        </section>
        <section class="pm-activity" aria-labelledby="issue-act">
          <h2 id="issue-act">Activity</h2>
          <ol class="pm-feed">{feed(page)}</ol>
          <form class="pm-comment-form" data-pm-comment="" onSubmit={submitText("body", (body) => void act.comment(issue.id, body))}>
            <Avatar who={store.boot.viewer} />
            <div class="textarea-group">
              <textarea class="textarea" data-rows="1" data-max-rows="6" name="body" placeholder="Leave a comment…" aria-label="Comment"></textarea>
              <div class="textarea-group-actions">
                <button class="btn" data-size="sm" type="submit">
                  Comment
                </button>
              </div>
            </div>
          </form>
        </section>
      </article>
      <aside class="pm-props" aria-label="Properties">
        <Select
          field="status"
          label="Status"
          value={issue.status}
          options={STATUSES.map((s) => [s, STATUS_NAMES[s]])}
          lead={<span class="pm-status" aria-hidden="true"></span>}
        />
        <Select
          field="priority"
          label="Priority"
          value={issue.priority}
          options={PRIORITIES.map((p) => [p, PRIORITY_NAMES[p]])}
          lead={<span class="pm-prio" aria-hidden="true"></span>}
        />
        <Select
          field="assignee"
          label="Assignee"
          value={issue.assignee ?? ""}
          options={[["", "Unassigned"], ...store.boot.people.map((p): [string, string] => [p.id, p.name])]}
          lead={<Avatar who={issue.assignee} class="pm-assignee" />}
        />
        <div class="pm-prop">
          <span class="pm-prop-label">Labels</span>
          <span class="pm-prop-value">
            <Labels labels={issue.labels} />
          </span>
        </div>
        <div class="pm-prop">
          <span class="pm-prop-label">Project</span>
          <span class="pm-prop-value">
            <ProjectChip project={issue.project} />
          </span>
        </div>
        <div class="pm-prop">
          <span class="pm-prop-label">Cycle</span>
          <span class="pm-prop-value">
            <Icon name="refresh-cw" />
            <span>{cycle ? "Cycle " + cycle.number : "—"}</span>
          </span>
        </div>
        <div class="pm-prop">
          <span class="pm-prop-label">Due date</span>
          <span class="pm-prop-value">
            <Icon name="calendar" />
            <span>{shortDate(issue.due)}</span>
          </span>
        </div>
      </aside>
    </div>,
  ];
}

/** Binds the issue section: its content from `store.page`, its data attributes (which the styles read) likewise. */
export function bindIssuePage(section: HTMLElement) {
  reactive({ store: appStore, render: () => (store.page ? <IssuePageView page={store.page} /> : []) }, section);
  const sync = () => {
    const issue = store.page?.issue;
    df$(section)
      .attr("data-issue", issue?.id ?? null)
      .attr("data-status", issue?.status ?? null)
      .attr("data-priority", issue?.priority ?? null)
      .attr("data-assignee", issue ? (issue.assignee ?? "") : null)
      .attr("aria-label", issue?.id ?? "Issue");
  };
  sync();
  appStore.subscribe(sync);
}
