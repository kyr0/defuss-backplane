/** VERIFIED: The installed client and the official MCP client manage one schedule and report on its runs across a
 * daemon restart on the other runtime. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import { createRpcServer } from "defuss-rpc/server";
import { BackplaneError, connectBackplane } from "defuss-backplane/client";
import { connectMcp } from "./consumer-mcp.ts";

const scope = { app: "scheduler-integration", tenant: "acme", bucket: "jobs" };
const queue = (await connectBackplane({ app: scope.app }))
  .tenant(scope.tenant)
  .scheduler(scope.bucket);
const agent = await connectMcp("scheduler-integration");
async function tool<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await agent.callTool({
    name: "scheduler." + name,
    arguments: { scope, ...args },
  });
  assert.ok(!result.isError, JSON.stringify(result.structuredContent));
  return (result.structuredContent as { value: T }).value;
}
type Schedule = Awaited<ReturnType<typeof queue.get>> & {};
/** The schedule without the planner's fields, as defuss-scheduler's ScheduleRecord omits them. Why: a schedule due every
 * second advances nextDue and lastProcessed between two reads without a new revision (VERIFIED: CI run 45765549043). */
const record = (s: unknown) => {
  const { nextDue: _due, lastProcessed: _processed, lastSkipped: _skipped, ...rest } = s as Schedule;
  return rest;
};
const mode = process.argv[2];
/** An app's defuss-rpc server on loopback receives one scheduled callback from the daemon, without the daemon's key,
 * and checks the call's one-time token with `callbacks.verify` while the call runs. */
async function checkCallback() {
  const backplane = await connectBackplane({ app: scope.app });
  const calls: { args: unknown[]; authorization?: string; schedule?: unknown }[] = [];
  let authorization: string | undefined, token = "";
  const rpc = createRpcServer({
    probe: {
      ping: async (...args: unknown[]) => {
        const seen = authorization;
        calls.push({ args, authorization: seen, schedule: (await backplane.callbacks.verify(token)).schedule });
      },
    },
  });
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    authorization = req.headers.authorization;
    token = String(req.headers["x-backplane-callback"] ?? "");
    const answer = await rpc.fetch(
      new Request("http://127.0.0.1" + req.url, { method: req.method, headers: req.headers as HeadersInit, body: Buffer.concat(chunks) }),
    );
    res.writeHead(answer.status, Object.fromEntries(answer.headers)).end(Buffer.from(await answer.arrayBuffer()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const callbacks = backplane.tenant(scope.tenant).scheduler("callbacks");
  try {
    await callbacks.create({
      id: mode,
      cron: "* * * * * *",
      handler: "_rpc",
      payload: {
        url: "http://127.0.0.1:" + (server.address() as { port: number }).port + "/rpc",
        className: "probe",
        methodName: "ping",
        args: [mode],
      },
    });
    for (let end = Date.now() + 10000; !calls.length && Date.now() < end; ) await pause(25);
    assert.deepEqual(calls[0], { args: [mode], authorization: undefined, schedule: mode });
  } finally {
    await callbacks.terminate({ schedule: mode }, { cause: "phase over" });
    server.close();
  }
}
try {
  const tools = (await agent.listTools()).tools;
  assert.equal(tools.length, 35);
  if (mode === "scheduler-write") {
    const created = await queue.create(
      { id: "one", handler: "rollup", cron: "* * * * * *", retry: { baseMs: 0 } },
      { requestId: "create" },
    );
    assert.deepEqual(record(await tool("get", { id: "one" })), record(created));
    const changed = await tool<Schedule>("update", {
      id: "one",
      patch: { payload: 7 },
      change: { revision: created.revision, requestId: "edit" },
    });
    assert.deepEqual(record(await queue.get("one")), record(changed));
    await assert.rejects(
      queue.pause("one", { revision: created.revision, requestId: "stale" }),
      (e: unknown) =>
        e instanceof BackplaneError && e.code === "REVISION_CONFLICT",
    );
    for (let end = Date.now() + 5000; Date.now() < end; await pause(25))
      if ((await queue.listRuns()).items.length) break;
    const paused = await tool<Schedule>("pause", {
      id: "one",
      change: { revision: changed.revision, requestId: "pause" },
    });
    assert.equal(paused.state, "paused");
    // Sixteen concurrent claims over RPC: one schedule without parallel runs grants one lease at a time.
    const grants = await Promise.all(
      Array.from({ length: 16 }, (_, slot) =>
        queue.claim({
          workerId: "w",
          sessionId: "s",
          slot,
          sequence: 1,
          requestId: "claim",
          handlers: ["rollup"],
        }),
      ),
    );
    const winners = grants.filter((g) => g.kind === "granted");
    assert.equal(winners.length, 1);
    const first = winners[0];
    assert.equal(
      (await queue.renew({ lease: first.lease, requestId: "renew" })).kind,
      "applied",
    );
    assert.equal(
      (
        await queue.fail({
          lease: first.lease,
          requestId: "retry",
          error: "transient",
        })
      ).kind,
      "applied",
    );
    const next = await queue.claim({
      workerId: "w",
      sessionId: "s",
      slot: first.lease.slot,
      sequence: 2,
      requestId: "claim-2",
      handlers: ["rollup"],
    });
    assert.equal(next.kind, "granted");
    if (next.kind !== "granted") throw new Error("No second grant");
    assert.equal(
      (await queue.complete({ lease: first.lease, requestId: "late" })).kind,
      "stale",
    );
    await queue.complete({ lease: next.lease, requestId: "done", result: 42 });
    assert.equal(
      (await tool<{ result: unknown }>("getRun", { id: next.run.id })).result,
      42,
    );
    const statuses = await queue.runHistory(next.run.id);
    assert.deepEqual(
      statuses.map((v) => v.value?.state),
      ["succeeded", "leased", "retryWait", "leased", "ready"],
    );
    assert.deepEqual(await tool("runHistory", { id: next.run.id }), statuses);
  } else {
    const kept = await queue.get("one");
    assert.equal(kept?.state, "paused");
    assert.deepEqual(await tool("list"), await queue.list());
    assert.deepEqual(await tool("listRuns"), await queue.listRuns());
    assert.ok((await queue.listRuns()).items.some((r) => r.result === 42));
    // The history written before the daemon restarted, read by the other runtime.
    const edits = await queue.scheduleHistory("one");
    assert.deepEqual(
      edits.map((v) => v.value?.state),
      ["paused", "active", "active"],
    );
    assert.deepEqual(await tool("scheduleHistory", { id: "one" }), edits);
    const active = await tool<Schedule>("resume", {
      id: "one",
      change: { revision: kept.revision, requestId: "resume" },
    });
    const removed = await tool<Schedule>("remove", {
      id: "one",
      change: { revision: active.revision, requestId: "remove" },
    });
    assert.equal(removed.state, "removed");
    const viaMcp = await tool("create", {
      definition: { id: "mcp", ref: "agent", cron: "0 0 * * *", handler: "x" },
    });
    assert.deepEqual(await queue.get("mcp"), viaMcp);
    // The ref finds the schedule through both transports, and a hard stop notes its cause.
    assert.deepEqual(
      await tool("list", { page: { ref: "agent" } }),
      await queue.list({ ref: "agent" }),
    );
    assert.deepEqual(
      await tool("terminate", {
        target: { ref: "agent" },
        options: { cause: "phase over" },
      }),
      { schedules: 1, runs: 0 },
    );
    assert.equal((await queue.get("mcp"))?.terminationCause, "phase over");
    const rest = await queue.terminate({ all: true }, { cause: "cleanup" });
    assert.equal(rest.schedules, 0);
    assert.ok(
      (await queue.listRuns({ limit: 500 })).items.every((r) =>
        ["succeeded", "dead", "terminated"].includes(r.state),
      ),
    );
  }
  await checkCallback();
  console.log(
    JSON.stringify({
      phase: mode,
      callback: "delivered",
      tools: tools.length,
      consumer: process.versions.bun ?? process.version,
    }),
  );
} finally {
  await agent.close();
}
