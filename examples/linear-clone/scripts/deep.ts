/** VERIFIED: scripts/e2e-deep.ts runs it in `make e2e` and `make e2e-live`. The tracker's documented behavior, once
 * through defuss-rpc and once through MCP, in a workspace of its own: validation of every issue field, defaults and
 * timestamps, revisions and conflicts, comments, subtasks, the inbox items that assignments, status and priority
 * changes and comments create, the due digest and the cycle rollover that the backplane's scheduler calls, marking
 * read, cycle statistics through their cache, attachments up to and above 25 MiB, and removal with everything an
 * issue owns. The backplane client checks what the app stored, as an agent would inspect it. Why one scenario for two
 * transports instead of two suites: two copies drift, and a behavior one transport gets wrong then fails a step
 * instead of going untested. VERIFIED by tests/api.test.ts: MCP reports a failed call by its HTTP status only, so the
 * code and field of a refusal are checked over RPC, and the status over both. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { connectBackplane } from "defuss-backplane/client";
import { createRpcContext } from "defuss-rpc/client";
import { parseFault } from "../src/core/faults.ts";
import type { Api } from "../src/server/api.ts";

/** The deep suite's workspace: a backplane tenant no person works in. */
export const DEEP_TENANT = "_e2e_test_linear-clone";
/** VERIFIED: MAX_ATTACHMENT_BYTES in src/server/server.ts, which this script does not import: that module needs Bun. */
const LIMIT = 25 * 1024 * 1024;
const DAY = 86_400_000;
/** The workspace's buckets, as src/server/workspace.ts opens them. */
const BUCKETS = ["people", "teams", "issues", "comments", "events", "projects", "cycles", "notifications"];

export type Backplane = { port: number; apiKey: string };
export type DeepResult = { via: string; step: string; ok: boolean; ms: number; error?: string };
type Any = Record<string, any>; // oxlint-disable-line no-explicit-any
type Call = (name: string, ...args: unknown[]) => Promise<Any>;

class Fault extends Error {
  status: number;
  code: string | undefined;
  field: string | undefined;
  constructor(status: number, code?: string, field?: string) {
    super(status + " " + (code ?? "") + (field ? "(" + field + ")" : ""));
    this.status = status;
    this.code = code;
    this.field = field;
  }
}
/** The fault of a failed defuss-rpc call, which carries `status` and the body. */
function rpcFault(error: unknown) {
  const e = error as { status?: number; body?: string; message?: string };
  if (typeof e.status !== "number") return error;
  const f = parseFault(e.body ?? e.message ?? "");
  return new Fault(e.status, f.code, f.field);
}
/** A call must fail with `status`; over RPC also with `code` and `field`. */
async function rejects(call: Promise<unknown>, status: number, code?: string, field?: string) {
  const e = await call.then(
    () => null,
    (x: unknown) => x,
  );
  assert.ok(e instanceof Fault, "a fault, got " + (e === null ? "a value" : String(e)));
  assert.equal(e.status, status, String(e));
  if (e.code !== undefined && code) assert.deepEqual([e.code, e.field], [code, field], String(e));
}
const day = (today: string, offset: number) => new Date(Date.parse(today) + offset * DAY).toISOString().slice(0, 10);
const pick = (value: Any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, value[k]]));
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Deletes every document, cached statistic and attachment of a deep-suite workspace, and terminates its schedules.
 * It refuses any tenant outside `_e2e_test_`, so a wrong argument cannot reach a person's workspace. */
export async function wipeWorkspace(backplane: Backplane, tenant: string, schedules: boolean) {
  if (!tenant.startsWith("_e2e_test_")) throw new Error("Refusing to wipe the workspace " + tenant);
  const t = (await connectBackplane({ app: "linear-clone", ...backplane })).tenant(tenant);
  const deleted: Record<string, number> = {};
  for (const name of BUCKETS) {
    const db = t.db(name);
    deleted[name] = 0;
    for (let rows = (await db.query({ limit: 1000 })).rows; rows.length; rows = (await db.query({ limit: 1000 })).rows)
      for (const row of rows) {
        if (name === "cycles") await t.cache("stats").delete("stats:" + row.id);
        await db.delete(row.id as string);
        deleted[name]++;
      }
  }
  const files = t.vfs("attachments");
  deleted.attachments = 0;
  for (let page = await files.list({ limit: 1000 }); page.objects.length; page = await files.list({ limit: 1000 }))
    for (const o of page.objects) {
      await files.delete(o.key);
      deleted.attachments++;
    }
  if (schedules) await t.scheduler("jobs").terminate({ all: true }, { cause: "deep suite end" });
  return deleted;
}

export async function deepCheck(o: { baseUrl: string; mcpConfig: string; backplane: Backplane; viewer: string }): Promise<DeepResult[]> {
  const { mcpServers } = JSON.parse(await readFile(o.mcpConfig, "utf8")) as {
    mcpServers: Record<string, { type: string; url: string; headers?: Record<string, string> }>;
  };
  const entry = mcpServers["linear-clone"];
  assert.equal(entry?.type, "http", "the MCP config has an http entry for linear-clone");
  // The agent's key from the MCP config signs both transports in as the same person.
  const headers = entry.headers ?? {};
  const agent = new Client({ name: "deep", version: "1" });
  await agent.connect(new StreamableHTTPClientTransport(new URL(entry.url), { requestInit: { headers } }));
  const ctx = createRpcContext({ baseUrl: o.baseUrl, headers });
  const client = (await ctx.getRpcClient<Api>()) as unknown as Record<string, Record<string, (...args: unknown[]) => Promise<Any>>>;
  const tenant = (await connectBackplane({ app: "linear-clone", ...o.backplane })).tenant(DEEP_TENANT);
  const used = { rpc: new Set<string>(), mcp: new Set<string>() };
  const rpc: Call = async (name, ...args) => {
    used.rpc.add(name);
    const [namespace, method] = name.split(".") as [string, string];
    try {
      return await client[namespace]![method]!(...args);
    } catch (error) {
      throw rpcFault(error);
    }
  };
  const mcp: Call = async (name, ...args) => {
    used.mcp.add(name);
    const r = await agent.callTool({ name, arguments: { args } });
    if (!r.isError) return (r.structuredContent as { value: Any }).value;
    throw new Fault(Number(/HTTP (\d{3})/.exec(JSON.stringify(r.content))?.[1]));
  };
  const upload = (issue: string, name: string, bytes: Uint8Array) =>
    ctx
      .uploadComplete<Any>("attachment", bytes, { uploadId: issue + "." + randomUUID(), originalFilename: name, progress: false })
      .catch((e: unknown) => {
        throw rpcFault(e);
      });
  const download = (issue: string, name: string) =>
    ctx.download("attachment", undefined, { downloadId: issue + "/" + name, headers }).then(
      (file) => new Uint8Array(file.data as unknown as ArrayBuffer),
      (e: unknown) => {
        throw rpcFault(e);
      },
    );
  const notes = tenant.db("notifications");
  /** The inbox items of an issue, for every person, read from the backplane as an agent would. */
  const itemsOf = async (issue: string) =>
    (await notes.query({ filters: [{ field: "issue", op: "eq", value: issue }], limit: 1000 })).rows
      .map((n) => [n.person, n.kind, n.actor, n.detail].join(" "))
      .sort();

  const results: DeepResult[] = [];
  const steps = (via: string) => {
    let failed = false;
    return async (step: string, run: () => Promise<void>) => {
      if (failed) return;
      const started = Date.now();
      try {
        await run();
        results.push({ via, step, ok: true, ms: Date.now() - started });
      } catch (error) {
        failed = true;
        results.push({ via, step, ok: false, ms: Date.now() - started, error: String((error as Error)?.stack ?? error).slice(0, 1500) });
      }
    };
  };
  let today = "";

  async function scenario(via: "rpc" | "mcp", call: Call) {
    const step = steps(via);
    const tag = "deep " + via;
    const v = o.viewer;
    let a = {} as Any;
    await step("bootstrap returns the workspace, the viewer, today and the seeded directory", async () => {
      const b = await call("Workspace.bootstrap");
      assert.deepEqual([b.workspace, b.viewer, b.timeZone], [DEEP_TENANT, v, "UTC"]);
      today = b.today;
      assert.ok(Math.abs(Date.parse(today) - Date.parse(new Date().toISOString().slice(0, 10))) <= DAY, today);
      assert.deepEqual(b.people.map((p: Any) => p.id).sort(), ["anna", "aron", "hannah", "marco", "priya", "sophie"]);
      assert.deepEqual(b.teams.map((t: Any) => t.id), ["ENG"]);
      assert.ok(b.projects.some((p: Any) => p.id === "board-view"));
      const running = b.cycles.find((c: Any) => c.id === "eng-24");
      assert.ok(running && running.start <= today && today <= running.end, "the seeded cycle runs today");
    });
    await step("create refuses each invalid field with INVALID_INPUT naming the field", async () => {
      const t = { title: tag };
      const cases: [string, unknown][] = [
        ["title", {}],
        ["title", { title: "  " }],
        ["title", { title: "x".repeat(201) }],
        ["title", { title: 5 }],
        ["description", { ...t, description: "x".repeat(10_001) }],
        ["status", { ...t, status: "doing" }],
        ["priority", { ...t, priority: "p0" }],
        ["assignee", { ...t, assignee: "No Body" }],
        ["assignee", { ...t, assignee: "nobody" }],
        ["labels", { ...t, labels: "bug" }],
        ["labels", { ...t, labels: ["ux"] }],
        ["labels", { ...t, labels: ["bug", "bug"] }],
        ["project", { ...t, project: "none-such" }],
        ["cycle", { ...t, cycle: "eng-0" }],
        ["due", { ...t, due: "tomorrow" }],
        ["subtasks", { ...t, subtasks: Array.from({ length: 51 }, () => ({ title: "s", done: false })) }],
        ["subtasks", { ...t, subtasks: [{ title: "s" }] }],
        ["color", { ...t, color: "red" }],
        ["input", "text"],
        ["input", [t]],
      ];
      for (const [field, draft] of cases) await rejects(call("Issues.create", draft), 400, "INVALID_INPUT", field);
    });
    await step("create fills the defaults, trims, numbers issues in order and stamps start and completion", async () => {
      a = await call("Issues.create", { title: `  ${tag} a  ` });
      assert.match(a.issue.id, /^ENG-\d+$/);
      assert.deepEqual(
        pick(a.issue, ["team", "title", "description", "status", "priority", "assignee", "labels", "project", "cycle", "due", "subtasks", "startedAt", "completedAt"]),
        { team: "ENG", title: tag + " a", description: "", status: "todo", priority: "none", assignee: null, labels: [], project: null, cycle: null, due: null, subtasks: [], startedAt: null, completedAt: null },
      );
      const full = {
        title: tag + " b",
        description: "steps",
        status: "done",
        priority: "urgent",
        assignee: v,
        labels: ["bug", "design"],
        project: "board-view",
        cycle: "eng-24",
        due: today,
        subtasks: [{ title: "one", done: false }],
      };
      const b = await call("Issues.create", full);
      assert.deepEqual(pick(b.issue, Object.keys(full)), full);
      assert.equal(b.issue.number, a.issue.number + 1);
      assert.ok(b.issue.startedAt && b.issue.completedAt);
      const page = await call("Issues.get", a.issue.id);
      assert.deepEqual([page.issue, page.revision, page.comments, page.attachments], [a.issue, a.revision, [], []]);
      assert.deepEqual(page.events.map((e: Any) => [e.kind, e.actor]), [["created", v]]);
      const ids = (await call("Issues.list")).map((i: Any) => i.id);
      assert.ok(ids.indexOf(b.issue.id) < ids.indexOf(a.issue.id) && ids.indexOf(b.issue.id) >= 0, "the list is newest first");
    });
    await step("update patches, keeps the revision when nothing changes, and refuses a stale revision", async () => {
      const subtasks = [{ title: "s1", done: true }, { title: "s2", done: false }];
      const started = await call("Issues.update", a.issue.id, { status: "progress", subtasks }, a.revision);
      assert.deepEqual([started.issue.status, started.issue.subtasks, started.issue.completedAt], ["progress", subtasks, null]);
      assert.ok(started.issue.startedAt);
      assert.notEqual(started.revision, a.revision);
      assert.equal((await call("Issues.update", a.issue.id, { status: "progress" }, started.revision)).revision, started.revision);
      await rejects(call("Issues.update", a.issue.id, { title: "stale" }, a.revision), 409, "REVISION_CONFLICT");
      assert.ok((await call("Issues.update", a.issue.id, { status: "done" })).issue.completedAt, "without ifRevision the latest version changes");
      const back = await call("Issues.update", a.issue.id, { status: "backlog" });
      assert.deepEqual([back.issue.startedAt, back.issue.completedAt], [null, null]);
      await rejects(call("Issues.update", a.issue.id, {}), 400, "INVALID_INPUT", "input");
      await rejects(call("Issues.update", a.issue.id, { status: "x" }), 400, "INVALID_INPUT", "status");
      await rejects(call("Issues.update", "ENG-999999", { title: "x" }), 404, "NOT_FOUND");
      await rejects(call("Issues.update", "eng-1", { title: "x" }), 400, "INVALID_INPUT", "id");
      const events = (await call("Issues.get", a.issue.id)).events as Any[];
      assert.equal(events[0]?.kind, "created");
      assert.deepEqual(
        events.filter((e) => e.field === "status").map((e) => [e.from, e.to]),
        [["todo", "progress"], ["progress", "done"], ["done", "backlog"]],
      );
      a = back;
    });
    await step("comments are trimmed, listed in order and recorded in the activity", async () => {
      const c = await call("Issues.comment", a.issue.id, "  first  ");
      assert.deepEqual([c.issue, c.author, c.body], [a.issue.id, v, "first"]);
      await call("Issues.comment", a.issue.id, "second");
      const page = await call("Issues.get", a.issue.id);
      assert.deepEqual(page.comments.map((x: Any) => x.body), ["first", "second"]);
      assert.equal(page.events.filter((e: Any) => e.kind === "commented").length, 2);
      await rejects(call("Issues.comment", a.issue.id, " "), 400, "INVALID_INPUT", "body");
      await rejects(call("Issues.comment", a.issue.id, "x".repeat(5001)), 400, "INVALID_INPUT", "body");
      await rejects(call("Issues.comment", "ENG-999999", "x"), 404, "NOT_FOUND");
    });
    await step("assigning, moving, reprioritizing and commenting notify the assignee; the viewer's own issues stay quiet", async () => {
      const c = await call("Issues.create", { title: tag + " c", assignee: "anna" });
      await call("Issues.update", c.issue.id, { status: "progress" });
      await call("Issues.update", c.issue.id, { priority: "high" });
      await call("Issues.comment", c.issue.id, "ping");
      await call("Issues.update", c.issue.id, { assignee: "marco" });
      await call("Issues.update", c.issue.id, { title: tag + " c2" });
      assert.deepEqual(
        await itemsOf(c.issue.id),
        [`anna assigned ${v} ${tag} c`, `anna status ${v} progress`, `anna priority ${v} high`, `anna comment ${v} ping`, `marco assigned ${v} ${tag} c`].sort(),
      );
      const own = await call("Issues.create", { title: tag + " own", assignee: v });
      await call("Issues.update", own.issue.id, { status: "progress" });
      await call("Issues.comment", own.issue.id, "self");
      assert.deepEqual(await itemsOf(own.issue.id), []);
    });
    await step("the scheduler's due digest puts due and overdue issues in the viewer's inbox; markRead marks them", async () => {
      const due = await call("Issues.create", { title: tag + " due", assignee: v, due: today });
      const late = await call("Issues.create", { title: tag + " late", assignee: v, due: day(today, -1) });
      const mine = async () => ((await call("Inbox.list")) as unknown as Any[]).filter((n) => n.issue === due.issue.id || n.issue === late.issue.id);
      let items = await mine();
      for (let i = 0; items.length < 2 && i < 100; i++) {
        await sleep(200);
        items = await mine();
      }
      assert.deepEqual(
        items.map((n) => [n.id, n.kind, n.person, n.actor, n.detail, n.read].join(" ")).sort(),
        [`digest:${today}:${due.issue.id} due ${v}  ${today} false`, `digest:${today}:${late.issue.id} overdue ${v}  ${day(today, -1)} false`].sort(),
      );
      const first = items[0]!.id as string;
      assert.equal(await call("Inbox.markRead", [first]), 1);
      assert.equal(await call("Inbox.markRead", [first]), 0);
      assert.equal(await call("Inbox.markRead", []), 0);
      assert.equal((await mine()).find((n) => n.id === first)?.read, true);
      const all = (await call("Inbox.list")) as unknown as Any[];
      assert.deepEqual(all.map((n) => n.at), all.map((n) => n.at).sort().reverse(), "newest first");
      const unread = all.filter((n) => !n.read).length;
      assert.ok(unread >= 1);
      assert.equal(await call("Inbox.markRead"), unread);
      assert.ok(((await call("Inbox.list")) as unknown as Any[]).every((n) => n.read));
      await rejects(call("Inbox.markRead", "x"), 400, "INVALID_INPUT", "ids");
    });
    await step("cycle statistics follow every issue change, though the cache holds them", async () => {
      const current = await call("Cycles.current");
      assert.equal(current.cycle.id, "eng-24");
      const before = await call("Cycles.stats", "eng-24");
      assert.deepEqual(current.stats, before);
      const { cycle } = current;
      assert.deepEqual([before.days, before.daysLeft, before.burnup.at(-1).date], [(Date.parse(cycle.end) - Date.parse(cycle.start)) / DAY + 1, (Date.parse(cycle.end) - Date.parse(today)) / DAY + 1, today]);
      const priya = (s: Any) => (s.people as Any[]).find((p) => p.person === "priya") ?? { done: 0, total: 0 };
      const e = await call("Issues.create", { title: tag + " e", cycle: "eng-24", assignee: "priya" });
      assert.equal((await call("Cycles.stats", "eng-24")).scope, before.scope + 1);
      await call("Issues.update", e.issue.id, { status: "done" });
      const after = await call("Cycles.stats", "eng-24");
      assert.deepEqual(
        [after.scope, after.done, after.started, priya(after).done, priya(after).total, after.donePct],
        [before.scope + 1, before.done + 1, before.started + 1, priya(before).done + 1, priya(before).total + 1, Math.round(((before.done + 1) / (before.scope + 1)) * 100)],
      );
      await call("Issues.update", e.issue.id, { cycle: null });
      assert.equal((await call("Cycles.stats", "eng-24")).scope, before.scope);
      await rejects(call("Cycles.stats", "none"), 404, "NOT_FOUND");
      await rejects(call("Cycles.stats", 5), 400, "INVALID_INPUT", "id");
    });
    await step("an attachment uploads, lists, downloads byte for byte and is removed", async () => {
      const issue = a.issue.id as string;
      const bytes = new Uint8Array(randomBytes(300_000));
      const up = await upload(issue, "trace.bin", bytes);
      assert.deepEqual([up.result.name, up.result.size], ["trace.bin", bytes.length]);
      const listed = await call("Issues.attachments", issue);
      assert.deepEqual((listed as unknown as Any[]).map((f) => [f.name, f.size]), [["trace.bin", bytes.length]]);
      const page = await call("Issues.get", issue);
      assert.deepEqual(page.attachments, listed);
      assert.ok(page.events.some((e: Any) => e.kind === "attached" && e.to === "trace.bin"));
      assert.deepEqual(await download(issue, "trace.bin"), bytes);
      assert.equal(await call("Issues.removeAttachment", issue, "trace.bin"), true);
      assert.equal(await call("Issues.removeAttachment", issue, "trace.bin"), false);
      await rejects(call("Issues.removeAttachment", issue, "a/b"), 400, "INVALID_INPUT", "name");
      assert.deepEqual(await call("Issues.attachments", issue), []);
    });
    if (via === "rpc")
      await step("25 MiB round-trips by SHA-256; one byte more, a missing issue or a bad name is refused before upload", async () => {
        const issue = a.issue.id as string;
        const full = new Uint8Array(randomBytes(LIMIT));
        assert.equal((await upload(issue, "full.bin", full)).result.size, LIMIT);
        assert.equal(sha(await download(issue, "full.bin")), sha(full));
        await rejects(upload(issue, "over.bin", new Uint8Array(LIMIT + 1)), 403);
        await rejects(upload("ENG-999999", "a.txt", new Uint8Array(1)), 403);
        await rejects(upload(issue, "a/b.txt", new Uint8Array(1)), 403);
        await rejects(download(issue, "none.bin"), 404);
        assert.deepEqual((await call("Issues.attachments", issue)).map((f: Any) => f.name), ["full.bin"]);
        assert.equal(await call("Issues.removeAttachment", issue, "full.bin"), true);
      });
    await step("remove takes the issue's comments, activity and files with it; a stale revision fails", async () => {
      const g = await call("Issues.create", { title: tag + " g" });
      const id = g.issue.id as string;
      await call("Issues.comment", id, "bye");
      await upload(id, "g.txt", new TextEncoder().encode("g"));
      const changed = await call("Issues.update", id, { priority: "low" });
      await rejects(call("Issues.remove", id, g.revision), 409, "REVISION_CONFLICT");
      assert.equal(await call("Issues.remove", id, changed.revision), true);
      await rejects(call("Issues.get", id), 404, "NOT_FOUND");
      await rejects(call("Issues.remove", id), 404, "NOT_FOUND");
      assert.ok(!((await call("Issues.list")) as unknown as Any[]).some((i) => i.id === id));
      const left = async (bucket: string) => (await tenant.db(bucket).query({ filters: [{ field: "issue", op: "eq", value: id }] })).rows.length;
      assert.deepEqual([await left("comments"), await left("events")], [0, 0]);
      assert.deepEqual((await tenant.vfs("attachments").list({ prefix: id + "/" })).objects, []);
    });
  }

  try {
    await scenario("rpc", rpc);
    await scenario("mcp", mcp);
    const step = steps("jobs");
    const jobs = tenant.scheduler("jobs");
    /** The job's one schedule that admits runs: under the job's ID, or a successor that carries it as `ref`. */
    const live = async (job: string) => {
      const found: Any[] = [];
      let cursor: string | null | undefined;
      do {
        const page = await jobs.list({ limit: 500, ...(cursor ? { cursor } : {}) });
        found.push(...(page.items as Any[]).filter((s) => (s.id === job || s.ref === job) && (s.state === "active" || s.state === "paused")));
        cursor = page.cursor;
      } while (cursor);
      assert.equal(found.length, 1, job + " has one live schedule");
      return found[0]!;
    };
    await step("liveness and readiness answer, readiness with the backplane's check", async () => {
      for (const path of ["/livez", "/healthz"]) assert.deepEqual(await (await fetch(o.baseUrl + path)).json(), { service: "linear-clone", status: "pass" });
      for (const path of ["/readyz", "/health"])
        assert.deepEqual(await (await fetch(o.baseUrl + path)).json(), { service: "linear-clone", status: "pass", checks: [{ name: "backplane", status: "pass" }] });
    });
    await step("MCP lists no Jobs tool, and a Jobs call without a callback token answers 403", async () => {
      assert.ok(!(await agent.listTools()).tools.some((t) => t.name.startsWith("Jobs.")));
      await rejects(rpc("Jobs.dueDigest"), 403);
      await rejects(rpc("Jobs.cycleRollover"), 403);
    });
    await step("the backplane's scheduler calls both jobs at the app's URL and records their results", async () => {
      for (const id of ["due-digest", "cycle-rollover"]) {
        const s = await live(id);
        assert.deepEqual([s.state, s.handler, s.payload.url, s.payload.className], ["active", "_rpc", o.baseUrl + "/rpc", "Jobs"], id);
      }
      const succeeded = new Map<string, Any>();
      let cursor: string | null | undefined;
      do {
        const page = await jobs.listRuns({ limit: 500, ...(cursor ? { cursor } : {}) });
        // VERIFIED by probe: an `_rpc` run keeps `{status, result}`, the HTTP status and the function's return value.
        for (const r of page.items as Any[])
          if (r.state === "succeeded" && r.payload?.url === o.baseUrl + "/rpc" && r.result?.status === 200) succeeded.set(r.payload.methodName as string, r.result.result);
        cursor = page.cursor;
      } while (cursor);
      assert.deepEqual(Object.keys(succeeded.get("dueDigest") ?? {}).sort(), ["added", "date", "items"]);
      assert.equal(succeeded.get("dueDigest")?.date, today);
      assert.deepEqual(succeeded.get("cycleRollover"), { closed: [], opened: [] });
    });
    await step("with the rollover paused an ended cycle gets open issues; resumed, the scheduler closes it and carries them", async () => {
      const rollover = await live("cycle-rollover");
      const paused = (await jobs.pause(rollover.id, { revision: rollover.revision, requestId: randomUUID() })) as Any;
      // HYPOTHESIS: a run admitted before the pause may still be delivered; two seconds let it finish first.
      await sleep(2000);
      await tenant.db("cycles").insert({ id: "eng-900", team: "ENG", number: 900, start: day(today, -20), end: day(today, -7), closed: false });
      const open = await rpc("Issues.create", { title: "deep rollover open", cycle: "eng-900" });
      const done = await rpc("Issues.create", { title: "deep rollover done", cycle: "eng-900", status: "done" });
      await jobs.resume(rollover.id, { revision: paused.revision, requestId: randomUUID() });
      let cycles: Any[] = [];
      for (let i = 0; i < 100 && !cycles.find((c) => c.id === "eng-900")?.closed; i++) {
        await sleep(200);
        cycles = (await rpc("Workspace.bootstrap")).cycles;
      }
      assert.equal(cycles.find((c) => c.id === "eng-900")?.closed, true);
      assert.deepEqual(cycles.find((c) => c.id === "eng-901"), { id: "eng-901", team: "ENG", number: 901, start: day(today, -6), end: day(today, 7), closed: false });
      assert.equal((await rpc("Issues.get", open.issue.id)).issue.cycle, "eng-901");
      assert.equal((await rpc("Issues.get", done.issue.id)).issue.cycle, "eng-900");
    });
    await step("every MCP tool and every RPC function ran", async () => {
      const tools = (await agent.listTools()).tools.map((t) => t.name).sort();
      assert.deepEqual([...used.mcp].sort(), tools);
      assert.deepEqual([...used.rpc].sort(), [...tools, "Jobs.cycleRollover", "Jobs.dueDigest"].sort());
    });
  } finally {
    await agent.close();
  }
  return results;
}
