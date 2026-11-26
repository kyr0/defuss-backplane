import { test, expect } from "bun:test";
import { readdir } from "node:fs/promises";
import { startWorker } from "defuss-scheduler/worker";
import { BackplaneError, connectBackplane } from "../src/client.js";
import { listen } from "../src/server.js";
import { freePort, start } from "./daemon.js";
import { OWN_APP } from "../src/logs.js";

const scope = { app: "shop", tenant: "acme", bucket: "jobs" };
const fault = (promise: Promise<unknown>) =>
  promise.then(
    () => "OK",
    (e: unknown) =>
      e instanceof BackplaneError ? e.code + " " + e.status : String(e),
  );

test("schedules are shared by RPC and MCP, and the client queue runs a worker", async () => {
  const { agent, root, stop } = await start();
  async function tool(name: string, args: Record<string, unknown>) {
    const result = await agent.callTool({
      name: "scheduler." + name,
      arguments: { scope, ...args },
    });
    return result as {
      isError?: boolean;
      structuredContent: { value?: unknown; code?: string; status?: number };
    };
  }
  try {
    const listed = (await agent.listTools()).tools;
    expect(listed).toHaveLength(35);
    const hints = Object.fromEntries(
      listed
        .filter((t) => t.name.startsWith("scheduler."))
        .map((t) => [
          t.name.slice(10),
          [t.annotations?.readOnlyHint, t.annotations?.destructiveHint],
        ]),
    );
    expect(hints).toEqual({
      create: [false, false],
      submit: [false, false],
      getJob: [true, false],
      get: [true, false],
      list: [true, false],
      update: [false, true],
      pause: [false, true],
      resume: [false, false],
      remove: [false, true],
      getRun: [true, false],
      listRuns: [true, false],
      scheduleHistory: [true, false],
      runHistory: [true, false],
      terminate: [false, true],
    });
    expect((await readdir(root)).sort()).toEqual([OWN_APP, "scheduler"].sort());

    const queue = (await connectBackplane({ app: scope.app }))
      .tenant(scope.tenant)
      .scheduler(scope.bucket);
    const created = await queue.create(
      {
        id: "tick",
        ref: "ticks",
        // VERIFIED from two failed runs: a run created before the edit keeps payload 7, so the schedule fires only
        // after the edit sets payload 8 and the every-second cron.
        cron: "0 0 1 1 *",
        handler: "rollup",
        payload: 7,
      },
      { requestId: "create-tick" },
    );
    expect(created).toMatchObject({
      id: "tick",
      ref: "ticks",
      state: "active",
      payload: 7,
    });
    expect((await tool("get", { id: "tick" })).structuredContent.value).toEqual(
      created,
    );
    expect(
      await fault(queue.create({ id: "tick", cron: "* * * * *", handler: "x" })),
    ).toBe("ALREADY_EXISTS 409");
    expect(
      await fault(
        queue.update("absent", {}, { revision: "r", requestId: "u1" }),
      ),
    ).toBe("NOT_FOUND 404");
    expect(
      await fault(
        (await connectBackplane({ app: "" }))
          .tenant("acme")
          .scheduler("jobs")
          .get("tick"),
      ),
    ).toBe("INVALID_ARGUMENT 400");

    const edited = await tool("update", {
      id: "tick",
      patch: { payload: 8, cron: "* * * * * *" },
      change: { revision: created.revision, requestId: "edit" },
    });
    expect(edited.isError).toBeFalsy();
    const stale = await tool("pause", {
      id: "tick",
      change: { revision: created.revision, requestId: "stale" },
    });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent).toMatchObject({
      code: "REVISION_CONFLICT",
      status: 409,
    });

    let finished: Promise<void> | undefined;
    const handled = new Promise<{ id: string; payload: unknown }>((resolve) => {
      const worker = startWorker(queue, {
        workerId: "rollup-1",
        handlers: {
          rollup: (run) => {
            resolve(run);
            finished = worker.stop().then(() => worker.done);
            return { sum: run.payload };
          },
        },
      });
    });
    const run = await handled;
    expect(run.payload).toBe(8);
    await finished;
    let stored = await queue.getRun(run.id);
    for (let i = 0; stored?.state !== "succeeded" && i < 40; i++) {
      await new Promise((r) => setTimeout(r, 50));
      stored = await queue.getRun(run.id);
    }
    expect(stored).toMatchObject({ state: "succeeded", result: { sum: 8 } });
    expect((await tool("getRun", { id: run.id })).structuredContent.value).toEqual(
      stored,
    );
    // Both transports read the same history: every status of the run and every edit of the schedule, newest first.
    const statuses = await queue.runHistory(run.id);
    expect(statuses.map((v) => v.value?.state)).toEqual([
      "succeeded",
      "leased",
      "ready",
    ]);
    expect(statuses[0].value?.updatedAt).toBe(statuses[0].from);
    expect(
      (await tool("runHistory", { id: run.id })).structuredContent.value,
    ).toEqual(statuses);
    const edits = await queue.scheduleHistory("tick", { limit: 5 });
    expect(edits.map((v) => v.value?.payload)).toEqual([8, 7]);
    expect(edits[1].value?.createdAt).toBe(created.createdAt);
    expect(
      (await tool("scheduleHistory", { id: "tick", options: { limit: 1 } }))
        .structuredContent.value,
    ).toEqual(edits.slice(0, 1));
    expect(await fault(queue.runHistory(run.id, { limit: 0 }))).toBe(
      "INVALID_ARGUMENT 400",
    );
    // A ref lists the schedule and its runs through both transports, and a hard stop records its cause.
    const named = await queue.listRuns({ ref: "ticks" });
    expect(named.items.map((r) => r.id)).toContain(run.id);
    expect(
      (await tool("listRuns", { page: { ref: "ticks" } })).structuredContent
        .value,
    ).toEqual(named);
    expect((await queue.list({ ref: "none" })).items).toEqual([]);
    await queue.create({ id: "idle", ref: "ticks", cron: "0 0 1 1 *", handler: "x" });
    expect(
      await queue.terminate({ schedule: "idle" }, { cause: "not needed" }),
    ).toEqual({ schedules: 1, runs: 0 });
    const stopped = await tool("terminate", {
      target: { ref: "ticks" },
      options: { cause: "test finished" },
    });
    expect(stopped.structuredContent.value).toMatchObject({ schedules: 1 });
    expect(
      (await queue.list({ ref: "ticks" })).items.map((s) => [
        s.id,
        s.state,
        s.terminationCause,
      ]),
    ).toEqual([
      ["idle", "terminated", "not needed"],
      ["tick", "terminated", "test finished"],
    ]);
    expect(
      await fault(queue.terminate({ run: "absent" }, { cause: "missing" })),
    ).toBe("NOT_FOUND 404");
    const unnamed = await tool("terminate", {
      target: {},
      options: { cause: "no target" },
    });
    expect(unnamed.isError).toBe(true);
    const removed = await tool("remove", {
      id: "tick",
      change: {
        revision: (edited.structuredContent.value as { revision: string })
          .revision,
        requestId: "remove",
      },
    });
    expect(removed.structuredContent).toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  } finally {
    await stop();
  }
}, 20000);

test("a second daemon on the same data root fails before it listens", async () => {
  const first = await start();
  const port = process.env.PORT;
  try {
    process.env.PORT = String(await freePort());
    await expect(listen()).rejects.toMatchObject({ code: "OWNER_BUSY" });
  } finally {
    process.env.PORT = port;
    await first.stop();
  }
});

test("two daemons in one process serve only their own schedules and data", async () => {
  const connect = (daemon: { url: string }, headers: { Authorization: string }) =>
    connectBackplane({
      app: scope.app,
      port: Number(new URL(daemon.url).port),
      apiKey: headers.Authorization.slice("Bearer ".length),
    }).then((client) => client.tenant(scope.tenant));
  const first = await start();
  try {
    const second = await start();
    try {
      const [one, two] = await Promise.all([
        connect(first.daemon, first.headers),
        connect(second.daemon, second.headers),
      ]);
      await one.scheduler(scope.bucket).create({ id: "only-first", cron: "0 0 1 1 *", handler: "build" });
      expect(await two.scheduler(scope.bucket).get("only-first")).toBeNull();
      await two.cache(scope.bucket).set("where", "second");
      expect(await one.cache(scope.bucket).get("where")).toEqual({
        hit: false,
      });
      expect(await two.cache(scope.bucket).get("where")).toEqual({
        hit: true,
        value: "second",
      });
    } finally {
      await second.stop();
    }
  } finally {
    await first.stop();
  }
});
