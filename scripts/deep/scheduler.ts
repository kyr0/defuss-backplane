/** VERIFIED: run through RPC and MCP by scripts/deep/run.ts. The scheduler as the README documents it: schedules with
 * refs, idempotent creates by request ID, paging and ref filters, edits with revisions, pause, resume and remove,
 * histories, runs leased by a worker through claim, renew, fail, retry and complete, every termination target, and an
 * `_rpc` callback with the bot key and the X-Backplane headers. Worker calls exist over RPC only, so both runs lease
 * through RPC and read through the transport under test. */
import { createServer } from "node:http";
import { once } from "node:events";
import { createRpcServer } from "defuss-rpc/server";
import { assert, type Ctx, rejects, sleep } from "./kit.ts";

type Schedule = Record<string, unknown> & { id: string; revision: string; state: string };
/** A schedule without the planner's fields, which a tick moves without a new revision. */
const record = (s: unknown) => {
  const { nextDue: _due, lastProcessed: _processed, lastSkipped: _skipped, ...rest } = s as Schedule;
  return rest;
};
const yearly = "0 0 1 1 *";

export async function schedulerScenario({ ops, rpc, bucket, apiKey, step }: Ctx) {
  const q = ops.scheduler(bucket);
  // The worker calls exist over RPC only, so the shared Ops type leaves them out; the RPC driver forwards them.
  type Report = (request: Record<string, unknown>) => Promise<{ kind: string }>;
  const worker = rpc.scheduler(bucket) as unknown as { claim(request: Record<string, unknown>): Promise<unknown>; renew: Report; fail: Report; complete: Report };
  let a = {} as Schedule;
  const change = (s: Schedule, requestId: string) => ({ revision: s.revision, requestId });
  await step("create keeps the definition; a repeated request ID returns the first result; a used ID fails", async () => {
    const def = { id: "a", handler: "work", cron: yearly, timezone: "Europe/Berlin", ref: "grp", payload: { x: 1 } };
    a = (await q.create(def, { requestId: "create-a" })) as Schedule;
    assert.deepEqual([a.id, a.state, a.handler, a.timezone, a.ref, a.payload], ["a", "active", "work", "Europe/Berlin", "grp", { x: 1 }]);
    assert.deepEqual(record(await q.create(def, { requestId: "create-a" })), record(a));
    await rejects(q.create(def, { requestId: "create-a-again" }), "ALREADY_EXISTS", 409);
    await q.create({ id: "b", handler: "work", cron: yearly, ref: "grp" }, { requestId: "create-b" });
    await q.create({ id: "c", handler: "work", cron: yearly }, { requestId: "create-c" });
    assert.deepEqual(record(await q.get("a")), record(a));
    assert.equal(await q.get("none"), null);
  });
  await step("list pages with a cursor and filters by ref", async () => {
    const ids: string[] = [];
    let cursor: string | null | undefined;
    for (let i = 0; i < 5; i++) {
      const page = await q.list({ limit: 1, ...(cursor ? { cursor } : {}) });
      ids.push(...page.items.map((s) => s.id as string));
      cursor = page.cursor as string | null;
      if (!cursor) break;
    }
    assert.deepEqual(ids.sort(), ["a", "b", "c"]);
    assert.deepEqual((await q.list({ ref: "grp" })).items.map((s) => s.id).sort(), ["a", "b"]);
  });
  await step("update, pause, resume and remove need the current revision; unknown IDs are NOT_FOUND", async () => {
    const updated = (await q.update("a", { payload: { x: 2 } }, change(a, "edit-a"))) as Schedule;
    assert.deepEqual(updated.payload, { x: 2 });
    await rejects(q.update("a", { payload: { x: 3 } }, change(a, "stale-a")), "REVISION_CONFLICT", 409);
    await rejects(q.update("none", { payload: 1 }, { revision: "r", requestId: "none" }), "NOT_FOUND", 404);
    const paused = (await q.pause("a", change(updated, "pause-a"))) as Schedule;
    assert.equal(paused.state, "paused");
    a = (await q.resume("a", change(paused, "resume-a"))) as Schedule;
    assert.equal(a.state, "active");
    const c = (await q.get("c")) as Schedule;
    assert.equal(((await q.remove("c", change(c, "remove-c"))) as Schedule).state, "removed");
  });
  await step("scheduleHistory lists every version newest first, and a limit cuts it", async () => {
    const history = await q.scheduleHistory("a");
    const states = history.map((v) => (v.value as Schedule).state);
    assert.deepEqual(states.slice(0, 4), ["active", "paused", "active", "active"]);
    assert.equal((await q.scheduleHistory("a", { limit: 2 })).length, 2);
  });
  let runId = "";
  await step("a worker claims a run, renews, fails it, claims the retry and completes it", async () => {
    await q.create({ id: "d", handler: "work-" + bucket, cron: "* * * * * *", ref: "runs", retry: { baseMs: 0 } }, { requestId: "create-d" });
    const claim = (slot: number, sequence: number) =>
      worker.claim({ workerId: "w", sessionId: "s", slot, sequence, requestId: `claim-${slot}-${sequence}`, handlers: ["work-" + bucket] }) as Promise<{
        kind: string;
        lease: Record<string, unknown>;
        run: { id: string };
      }>;
    let grant = await claim(0, 1);
    for (let i = 0; grant.kind !== "granted" && i < 50; i++) {
      await sleep(100);
      grant = await claim(0, i + 2);
    }
    assert.equal(grant.kind, "granted");
    runId = grant.run.id;
    assert.equal(((await worker.renew({ lease: grant.lease, requestId: "renew" })) as { kind: string }).kind, "applied");
    assert.equal(((await worker.fail({ lease: grant.lease, requestId: "fail", error: "transient" })) as { kind: string }).kind, "applied");
    let retry = await claim(1, 100);
    for (let i = 0; (retry.kind !== "granted" || retry.run.id !== runId) && i < 50; i++) {
      await sleep(100);
      retry = await claim(1, 101 + i);
    }
    assert.equal(retry.run.id, runId);
    assert.equal(((await worker.complete({ lease: grant.lease, requestId: "late" })) as { kind: string }).kind, "stale");
    assert.equal(((await worker.complete({ lease: retry.lease, requestId: "done", result: { ok: 1 } })) as { kind: string }).kind, "applied");
  });
  await step("getRun, listRuns and runHistory show the run's states", async () => {
    const run = (await q.getRun(runId)) as Record<string, unknown>;
    assert.deepEqual([run.state, run.result], ["succeeded", { ok: 1 }]);
    assert.ok((await q.listRuns({ limit: 500 })).items.some((r) => r.id === runId));
    assert.ok((await q.listRuns({ ref: "runs" })).items.some((r) => r.id === runId));
    assert.deepEqual((await q.listRuns({ ref: "grp" })).items, []);
    // Schedule d admits one run per second; paging needs a second one.
    let first = await q.listRuns({ limit: 1 });
    for (let i = 0; !first.cursor && i < 50; i++) {
      await sleep(100);
      first = await q.listRuns({ limit: 1 });
    }
    assert.ok(first.cursor, "more than one run, so a cursor");
    const second = await q.listRuns({ limit: 1, cursor: first.cursor as string });
    assert.notEqual(second.items[0]?.id, first.items[0]?.id);
    const states = (await q.runHistory(runId)).map((v) => (v.value as Record<string, unknown>).state);
    assert.deepEqual(states, ["succeeded", "leased", "retryWait", "leased", "ready"]);
    assert.equal((await q.runHistory(runId, { limit: 1 })).length, 1);
    assert.equal(await q.getRun("none"), null);
  });
  await step("an _rpc schedule calls the app's function with the bot key and the X-Backplane headers", async () => {
    const calls: { args: unknown[]; headers: Record<string, string | undefined> }[] = [];
    let headers: Record<string, string | undefined> = {};
    const app = createRpcServer({ Probe: { ping: async (...args: unknown[]) => calls.push({ args, headers }) } });
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      headers = { authorization: req.headers.authorization, schedule: req.headers["x-backplane-schedule"] as string, run: req.headers["x-backplane-run"] as string };
      const answer = await app.fetch(new Request("http://127.0.0.1" + req.url, { method: req.method, headers: req.headers as HeadersInit, body: Buffer.concat(chunks) }));
      res.writeHead(answer.status, Object.fromEntries(answer.headers)).end(Buffer.from(await answer.arrayBuffer()));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = "http://127.0.0.1:" + (server.address() as { port: number }).port + "/rpc";
    try {
      await rejects(q.create({ id: "far", handler: "_rpc", cron: yearly, payload: { url: "http://example.com/rpc", className: "Probe", methodName: "ping", args: [] } }), "INVALID_ARGUMENT", 400);
      await q.create({ id: "cb", handler: "_rpc", cron: "* * * * * *", payload: { url, className: "Probe", methodName: "ping", args: [bucket] } }, { requestId: "create-cb" });
      for (let i = 0; !calls.length && i < 100; i++) await sleep(100);
      assert.ok(calls.length, "the daemon called back");
      assert.deepEqual(calls[0].args, [bucket]);
      assert.equal(calls[0].headers.authorization, "Bearer " + apiKey);
      assert.equal(calls[0].headers.schedule, "cb");
      assert.ok(calls[0].headers.run);
    } finally {
      await q.terminate({ schedule: "cb" }, { cause: "callback seen" });
      server.close();
    }
  });
  await step("terminate stops one run, one schedule, a ref and everything, and records the cause", async () => {
    await q.create({ id: "e", handler: "idle-" + bucket, cron: "* * * * * *" }, { requestId: "create-e" });
    let pending: Record<string, unknown> | undefined;
    for (let i = 0; !pending && i < 50; i++) {
      pending = (await q.listRuns({ limit: 500 })).items.find((r) => r.scheduleId === "e" && r.state === "ready");
      if (!pending) await sleep(100);
    }
    assert.ok(pending, "schedule e admitted a run");
    const oneRun = await q.terminate({ run: pending.id as string }, { cause: "one run" });
    assert.equal(oneRun.runs, 1);
    assert.equal(((await q.getRun(pending.id as string)) as Record<string, unknown>).state, "terminated");
    assert.equal((await q.terminate({ schedule: "e" }, { cause: "schedule e" })).schedules, 1);
    assert.deepEqual([((await q.get("e")) as Schedule).state, ((await q.get("e")) as Schedule).terminationCause], ["terminated", "schedule e"]);
    assert.equal((await q.terminate({ ref: "grp" }, { cause: "group" })).schedules, 2);
    assert.equal(((await q.get("b")) as Schedule).state, "terminated");
    await q.terminate({ all: true }, { cause: "suite end" });
    const live = (await q.list({ limit: 500 })).items.filter((s) => s.state === "active" || s.state === "paused");
    assert.deepEqual(live, []);
  });
}
