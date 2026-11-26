/** VERIFIED: tests/workspace.test.ts checks against a real daemon the workspace's documents, cached statistics, attachments
 * and audit log, all in defuss-backplane under the app `linear-clone` and one tenant per workspace. This module is the
 * only one that imports `defuss-backplane/client`. Why the backplane rather than a database of the app's own: the app
 * keeps no state, so restarting or moving it loses nothing, and agents reach the same data over the backplane's MCP. */
import { BackplaneError, connectBackplane, type UploadBody } from "defuss-backplane/client";
import { daysBetween, localDate } from "../core/dates.ts";
import { issueId } from "../core/ids.ts";
import {
  applyPatch,
  type Change,
  type Issue,
  InvalidInput,
  isStarted,
  type Patch,
  validateComment,
  validateDraft,
  validateFileName,
  validatePatch,
} from "../core/issue.ts";
import type { Comment, IssueEvent, Notification, Person, Project, Team } from "../core/model.ts";
import { type Seed, shiftSeed } from "../core/seed.ts";
import { type Cycle, type CycleStats, cycleStats } from "../core/stats.ts";
import { createLog } from "./log.ts";

export const APP = "linear-clone";
/** VERIFIED: the backplane README says a query returns at most 1,000 rows. */
const PAGE = 1000;
const STATS_TTL_MS = 5 * 60_000;
const NUMBER_ATTEMPTS = 100;

type Versioned<T> = { found: false; revision: null } | { found: true; value: T; revision: string };
type Query = {
  filters?: { field: string; op: "eq"; value: unknown }[];
  sorters?: { field: string; direction: "asc" | "desc" }[];
  offset?: number;
  limit?: number;
};
/** A db bucket as this module uses it; the client's generic `db<T>` requires an index signature the models lack. */
type Bucket<T> = {
  get(id: string): Promise<T | null>;
  getVersioned(id: string): Promise<Versioned<T>>;
  insert(doc: Partial<T>): Promise<string>;
  update(id: string, patch: Partial<T>, options?: { ifRevision?: string | null }): Promise<boolean>;
  delete(id: string, options?: { ifRevision?: string | null }): Promise<boolean>;
  query(request?: Query): Promise<{ rows: T[] }>;
};

/** A missing issue, person, project or cycle. */
export class NotFound extends Error {
  override name = "NotFound";
}

export const isCode = (error: unknown, code: string) => error instanceof BackplaneError && error.code === code;

export type Attachment = { name: string; size: number; revision: string; mtimeMs: number };
export type Workspace = Awaited<ReturnType<typeof openWorkspace>>;

export async function openWorkspace(options: {
  port: number;
  apiKey: string;
  workspace: string;
  timeZone: string;
  now?: () => Date;
}) {
  const client = await connectBackplane({ app: APP, port: options.port, apiKey: options.apiKey });
  const tenant = client.tenant(options.workspace);
  const now = options.now ?? (() => new Date());
  const today = () => localDate(now(), options.timeZone);
  const bucket = <T>(name: string) => tenant.db(name) as unknown as Bucket<T>;
  const people = bucket<Person>("people");
  const teams = bucket<Team>("teams");
  const issues = bucket<Issue>("issues");
  const comments = bucket<Comment>("comments");
  const events = bucket<IssueEvent>("events");
  const projects = bucket<Project>("projects");
  const cycles = bucket<Cycle>("cycles");
  const notifications = bucket<Notification>("notifications");
  const stats = tenant.cache("stats");
  const files = tenant.vfs("attachments");
  const auditLog = tenant.logs();

  async function all<T>(from: Bucket<T>, request: Query = {}) {
    const rows: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = (await from.query({ ...request, offset, limit: PAGE })).rows;
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  }
  const where = (field: string, value: unknown) => [{ field, op: "eq" as const, value }];
  /** Inserts a document with a fixed ID; false when it exists, which makes seeding and the digest repeatable. */
  async function insertOnce<T>(into: Bucket<T>, doc: Partial<T>) {
    try {
      await into.insert(doc);
      return true;
    } catch (error) {
      if (isCode(error, "ALREADY_EXISTS")) return false;
      throw error;
    }
  }
  /** Workspace audit events go to the tenant's log, apart from the service's own lines in the app log. */
  const audit = (message: string, context: Record<string, unknown>) =>
    auditLog.write([{ level: "info", message, context }]);
  const forgetStats = (...ids: (string | null)[]) =>
    Promise.all([...new Set(ids.filter((id): id is string => !!id))].map((id) => stats.delete("stats:" + id)));
  const notify = (item: Omit<Notification, "id" | "read" | "at">) =>
    notifications.insert({ ...item, read: false, at: now().toISOString() });
  const record = (event: Omit<IssueEvent, "id" | "at">) => events.insert({ ...event, at: now().toISOString() });

  async function checkReferences(fields: Patch) {
    const lookups = [
      ["assignee", people],
      ["project", projects],
      ["cycle", cycles],
    ] as const;
    for (const [field, from] of lookups) {
      const id = fields[field];
      if (id && !(await (from as Bucket<unknown>).get(id))) throw new InvalidInput(field, "has no document " + id);
    }
  }

  /** The team's next issue number, reserved with a revision check; concurrent creates retry until each wins once. */
  async function nextNumber(team: string) {
    for (let attempt = 1; attempt <= NUMBER_ATTEMPTS; attempt++) {
      const current = await teams.getVersioned(team);
      if (!current.found) throw new InvalidInput("team", "has no document " + team);
      try {
        await teams.update(team, { next: current.value.next + 1 }, { ifRevision: current.revision });
        return current.value.next;
      } catch (error) {
        if (!isCode(error, "REVISION_CONFLICT")) throw error;
        await Bun.sleep(Math.random() * Math.min(attempt, 10) * 5);
      }
    }
    throw new Error("No issue number after " + NUMBER_ATTEMPTS + " attempts");
  }

  async function sideEffects(issue: Issue, changes: Change[], actor: string) {
    const tasks: Promise<unknown>[] = changes.map((c) =>
      record({ issue: issue.id, actor, kind: "changed", field: c.field, from: c.from, to: c.to }),
    );
    const others = (person: string | null) => (person && person !== actor ? person : null);
    for (const c of changes) {
      const person = others(issue.assignee);
      if (c.field === "assignee" && person)
        tasks.push(notify({ person, kind: "assigned", issue: issue.id, actor, detail: issue.title }));
      if ((c.field === "status" || c.field === "priority") && person)
        tasks.push(notify({ person, kind: c.field, issue: issue.id, actor, detail: String(c.to) }));
    }
    const moved = changes.find((c) => c.field === "status");
    tasks.push(
      moved
        ? audit("issue moved", { issue: issue.id, actor, from: moved.from, to: moved.to })
        : audit("issue changed", { issue: issue.id, actor, fields: changes.map((c) => c.field) }),
    );
    await Promise.all(tasks);
  }

  async function getIssue(id: string) {
    const current = await issues.getVersioned(id);
    if (!current.found) throw new NotFound("No issue " + id);
    return { issue: current.value, revision: current.revision };
  }

  /** Every attachment of an issue, page by page. */
  async function listFiles(issue: string): Promise<Attachment[]> {
    const found: Attachment[] = [];
    let after: string | null = null;
    do {
      const page = await files.list({ prefix: issue + "/", after });
      for (const o of page.objects)
        found.push({ name: o.key.slice(issue.length + 1), size: o.size, revision: o.revision, mtimeMs: o.mtimeMs });
      after = page.nextAfter;
    } while (after);
    return found;
  }

  const key = (issue: string, name: string) => issue + "/" + name;

  const log = createLog(client.logs());

  /** Links a person to an auth subject, creating the person with `name` when the ID is new. */
  async function link(person: string, subject: string, name: string) {
    if (typeof person !== "string" || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(person))
      throw new InvalidInput("person", "A person ID has 1 to 48 lowercase letters, digits and -");
    if ((await people.get(person)) === null) await people.insert({ id: person, name, subject });
    else await people.update(person, { subject });
  }

  return {
    log,
    today,
    /** Sign-in, agent keys and callback checks of this workspace's tenant, through the backplane, and the person each
     * signed-in subject acts as. */
    members: {
      configure: client.auth.configure,
      /** The defuss-serve plugin that forwards the browser's /auth/* to the backplane. */
      proxy: client.auth.proxy,
      authenticate: (authorization: string) => tenant.auth.authenticate(authorization),
      verifyCallback: client.callbacks.verify,
      async personOf(subject: string) {
        return (await people.query({ filters: where("subject", subject), limit: 1 })).rows[0] ?? null;
      },
      /** Gives a person a sign-in: the account is created when the email is new; the password applies to a new
       * account only. */
      async add(input: { email: string; password: string; person: string; name?: string }) {
        const member = await tenant.auth.addMember({ email: input.email, password: input.password });
        await link(input.person, member.subjectId, input.name ?? input.person);
        return { person: input.person, subjectId: member.subjectId, created: member.created };
      },
      /** An agent's API key, acting as a person of its own (`agent-<name>` unless `person` is given). The key is
       * returned once. */
      async addAgent(input: { name: string; person?: string }) {
        const person = input.person ?? "agent-" + input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const key = await tenant.auth.createApiKey({ name: input.name });
        await link(person, key.subjectId, input.name);
        return { person, id: key.id, key: key.key, expiresAt: key.expiresAt };
      },
    },
    /** People, teams, projects and cycles, for the browser's first render. */
    async directory() {
      const [p, t, pr, c] = await Promise.all([all(people), all(teams), all(projects), all(cycles)]);
      return { people: p, teams: t, projects: pr, cycles: c };
    },
    issues: {
      list: () => all(issues, { sorters: [{ field: "number", direction: "desc" }] }),
      byCycle: (cycle: string) => all(issues, { filters: where("cycle", cycle) }),
      get: getIssue,
      async create(input: unknown, actor: string, team = "ENG") {
        const draft = validateDraft(input);
        await checkReferences(draft);
        const at = now().toISOString();
        const number = await nextNumber(team);
        const issue: Issue = {
          id: issueId(team, number),
          team,
          number,
          ...draft,
          createdAt: at,
          updatedAt: at,
          startedAt: isStarted(draft.status) ? at : null,
          completedAt: draft.status === "done" ? at : null,
        };
        await issues.insert(issue);
        const assignee = issue.assignee && issue.assignee !== actor ? issue.assignee : null;
        await Promise.all([
          forgetStats(issue.cycle),
          record({ issue: issue.id, actor, kind: "created" }),
          audit("issue created", { issue: issue.id, actor }),
          assignee && notify({ person: assignee, kind: "assigned", issue: issue.id, actor, detail: issue.title }),
        ]);
        return getIssue(issue.id);
      },
      /** Applies a patch. With `ifRevision`, a concurrent change fails with REVISION_CONFLICT; without, the patch
       * applies to the latest version. Returns the stored issue and its revision. */
      async update(id: string, input: unknown, actor: string, ifRevision?: string) {
        const patch = validatePatch(input);
        await checkReferences(patch);
        for (let attempt = 1; ; attempt++) {
          const current = await getIssue(id);
          const { issue, changes } = applyPatch(current.issue, patch, now());
          if (!changes.length) return current;
          const stored: Partial<Issue> = Object.fromEntries(changes.map((c) => [c.field, c.to]));
          try {
            await issues.update(
              id,
              { ...stored, updatedAt: issue.updatedAt, startedAt: issue.startedAt, completedAt: issue.completedAt },
              { ifRevision: ifRevision ?? current.revision },
            );
          } catch (error) {
            if (!ifRevision && attempt < 5 && isCode(error, "REVISION_CONFLICT")) continue;
            throw error;
          }
          await Promise.all([forgetStats(current.issue.cycle, issue.cycle), sideEffects(issue, changes, actor)]);
          return getIssue(id);
        }
      },
      async remove(id: string, actor: string, ifRevision?: string) {
        const { issue, revision } = await getIssue(id);
        await issues.delete(id, { ifRevision: ifRevision ?? revision });
        const [own, history, objects] = await Promise.all([
          all(comments, { filters: where("issue", id) }),
          all(events, { filters: where("issue", id) }),
          listFiles(id),
        ]);
        await Promise.all([
          ...own.map((c) => comments.delete(c.id)),
          ...history.map((e) => events.delete(e.id)),
          ...objects.map((o) => files.delete(key(id, o.name))),
          forgetStats(issue.cycle),
          audit("issue deleted", { issue: id, actor }),
        ]);
      },
    },
    comments: {
      list: (issue: string) => all(comments, { filters: where("issue", issue), sorters: [{ field: "createdAt", direction: "asc" }] }),
      async add(issueId: string, author: string, input: unknown) {
        const body = validateComment(input);
        const { issue } = await getIssue(issueId);
        const comment: Comment = { id: "", issue: issueId, author, body, createdAt: now().toISOString() };
        comment.id = await comments.insert({ issue: issueId, author, body, createdAt: comment.createdAt });
        await Promise.all([
          record({ issue: issueId, actor: author, kind: "commented" }),
          issue.assignee && issue.assignee !== author
            ? notify({ person: issue.assignee, kind: "comment", issue: issueId, actor: author, detail: body })
            : null,
        ]);
        return comment;
      },
    },
    events: {
      /** In time order. Events of the same millisecond have no stored order, so the creation goes first and the rest
       * keep the query's order. VERIFIED: with a test clock that stands still, the order of such events varied. */
      list: async (issue: string) =>
        (await all(events, { filters: where("issue", issue), sorters: [{ field: "at", direction: "asc" }] })).sort(
          (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : Number(b.kind === "created") - Number(a.kind === "created")),
        ),
    },
    inbox: {
      list: (person: string) =>
        all(notifications, { filters: where("person", person), sorters: [{ field: "at", direction: "desc" }] }),
      /** Marks the person's items read, or only `ids`; returns how many changed. */
      async markRead(person: string, ids?: string[]) {
        const items = (await all(notifications, { filters: where("person", person) })).filter(
          (n) => !n.read && (!ids || ids.includes(n.id)),
        );
        await Promise.all(items.map((n) => notifications.update(n.id, { read: true })));
        return items.length;
      },
      /** Inserts items with fixed IDs, skipping those that exist; returns how many were new. */
      async add(items: Notification[]) {
        let added = 0;
        for (const item of items) if (await insertOnce(notifications, item)) added++;
        return added;
      },
    },
    cycles: {
      list: () => all(cycles, { sorters: [{ field: "number", direction: "asc" }] }),
      /** Inserts a cycle with a fixed ID; false when it exists. */
      create: (cycle: Cycle) => insertOnce(cycles, cycle),
      async close(id: string) {
        await cycles.update(id, { closed: true });
        await forgetStats(id);
      },
      /** The cycle's statistics, from the cache when an earlier call stored them and no issue write cleared them. */
      async stats(id: string): Promise<CycleStats> {
        const cached = await stats.get("stats:" + id);
        if (cached.hit) return cached.value as CycleStats;
        const cycle = await cycles.get(id);
        if (!cycle) throw new NotFound("No cycle " + id);
        const value = cycleStats(cycle, await all(issues, { filters: where("cycle", id) }), today(), options.timeZone);
        await stats.set("stats:" + id, value, STATS_TTL_MS);
        return value;
      },
    },
    attachments: {
      async upload(issue: string, name: unknown, body: UploadBody, actor: string): Promise<Attachment> {
        const file = validateFileName(name);
        await getIssue(issue);
        const stored = await files.upload(key(issue, file), body);
        await record({ issue, actor, kind: "attached", to: file });
        return { name: file, size: stored.size, revision: stored.revision, mtimeMs: stored.mtimeMs };
      },
      download: async (issue: string, name: unknown) => files.download(key(issue, validateFileName(name))),
      list: listFiles,
      remove: async (issue: string, name: unknown) => files.delete(key(issue, validateFileName(name))),
    },
    /** Fills an empty workspace with the demo, its dates moved to today. The team goes in last: a start that stops
     * halfway leaves no team, and the next start completes the rest, skipping documents that exist. */
    async seed(seed: Seed) {
      if ((await teams.query({ limit: 1 })).rows.length) return false;
      // Dates move by whole days; instants by the time since noon of the seed's day, so "12m ago" stays 12 minutes.
      const demo = shiftSeed(seed, daysBetween(seed.today, today()), now().getTime() - Date.parse(seed.today + "T12:00:00Z"));
      const groups: [Bucket<never>, object[]][] = [
        [people as Bucket<never>, demo.people],
        [projects as Bucket<never>, demo.projects],
        [cycles as Bucket<never>, demo.cycles],
        [issues as Bucket<never>, demo.issues],
        [comments as Bucket<never>, demo.comments],
        [events as Bucket<never>, demo.events],
        [notifications as Bucket<never>, demo.notifications],
        [teams as Bucket<never>, demo.teams],
      ];
      for (const [into, docs] of groups) for (const doc of docs) await insertOnce(into, doc as never);
      return true;
    },
    /** The scheduler queue the schedules live in. */
    scheduler: tenant.scheduler("jobs"),
    close: () => log.close(),
  };
}
