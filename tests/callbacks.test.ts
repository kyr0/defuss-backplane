import { test, expect } from "bun:test";
import { createRpcServer } from "defuss-rpc/server";
import { BackplaneError, connectBackplane } from "../src/client.js";
import { start } from "./daemon.js";

const fault = (promise: Promise<unknown>) =>
  promise.then(
    () => "OK",
    (e: unknown) => (e instanceof BackplaneError ? e.code + " " + e.status : String(e)),
  );
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > end) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
/** An app's own defuss-rpc server on loopback, as an app service would run it. */
function app(answer?: (request: Request) => Response | undefined) {
  const calls: { args: unknown[]; headers: Headers }[] = [];
  let last: Headers | undefined;
  const rpc = createRpcServer({
    jobs: {
      async notify(...args: unknown[]) {
        calls.push({ args, headers: last! });
        return { ok: true };
      },
    },
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      last = request.headers;
      return answer?.(request) ?? rpc.fetch(request);
    },
  });
  return { calls, url: `http://127.0.0.1:${server.port}/rpc`, stop: () => server.stop(true) };
}

test("a schedule with handler _rpc calls the app's RPC function with its arguments and the bot key", async () => {
  const { headers, stop } = await start();
  const target = app();
  try {
    const queue = (await connectBackplane({ app: "shop" })).tenant("acme").scheduler("jobs");
    const created = await queue.create({
      id: "notify",
      cron: "* * * * * *",
      handler: "_rpc",
      payload: { url: target.url, className: "jobs", methodName: "notify", args: ["hello", 2] },
    });
    const calls = await until(async () => target.calls, (c) => c.length > 0);
    await queue.pause("notify", { revision: created.revision, requestId: "pause" });
    expect(calls[0].args).toEqual(["hello", 2]);
    expect(calls[0].headers.get("authorization")).toBe(headers.Authorization);
    expect(calls[0].headers.get("x-backplane-schedule")).toBe("notify");
    const runs = await until(
      () => queue.listRuns(),
      (page) => page.items.some((run) => run.state === "succeeded"),
    );
    const done = runs.items.find((run) => run.state === "succeeded")!;
    expect(done.result).toEqual({ status: 200, result: { ok: true } });
    expect(calls.some((call) => call.headers.get("x-backplane-run") === done.id)).toBe(true);
  } finally {
    target.stop();
    await stop();
  }
}, 20000);

test("callback targets and reserved handlers are checked, and failed calls are retried or ended", async () => {
  const { stop } = await start({ BACKPLANE_CALLBACK_ORIGINS: "http://allowed.example" });
  // 503 is worth retrying; 404 fails the same way on every attempt.
  const busy = app(() => new Response("busy", { status: 503 }));
  const missing = app(() => new Response("no such function", { status: 404 }));
  try {
    const queue = (await connectBackplane({ app: "shop" })).tenant("acme").scheduler("jobs");
    const yearly = { cron: "0 0 1 1 *", handler: "_rpc" };
    const payload = { url: busy.url, className: "jobs", methodName: "notify" };
    expect(await fault(queue.create({ ...yearly, id: "far", payload: { ...payload, url: "http://example.org/rpc" } }))).toBe(
      "INVALID_ARGUMENT 400",
    );
    expect(await fault(queue.create({ ...yearly, id: "creds", payload: { ...payload, url: "http://u:p@127.0.0.1/rpc" } }))).toBe(
      "INVALID_ARGUMENT 400",
    );
    expect(await fault(queue.create({ ...yearly, id: "partial", payload: { url: busy.url, className: "jobs" } }))).toBe(
      "INVALID_ARGUMENT 400",
    );
    expect(await fault(queue.create({ ...yearly, id: "other", handler: "_mine" }))).toBe("INVALID_ARGUMENT 400");
    const allowed = await queue.create({ ...yearly, id: "allowed", payload: { ...payload, url: "http://allowed.example/rpc" } });
    expect(
      await fault(
        queue.update("allowed", { payload: { ...payload, url: "http://example.org/rpc" } }, {
          revision: allowed.revision,
          requestId: "bad-url",
        }),
      ),
    ).toBe("INVALID_ARGUMENT 400");
    // An app worker cannot take the daemon's runs.
    expect(
      await fault(
        queue.claim({ workerId: "w", sessionId: "s", slot: 0, sequence: 1, requestId: "c1", handlers: ["_rpc"] }),
      ),
    ).toBe("INVALID_ARGUMENT 400");

    const every = { cron: "* * * * * *", handler: "_rpc", retry: { maxAttempts: 2, baseMs: 0 } };
    await queue.create({ ...every, id: "busy", payload });
    await queue.create({ ...every, id: "missing", payload: { ...payload, url: missing.url } });
    const runs = await until(
      () => queue.listRuns({ limit: 100 }),
      (page) =>
        page.items.some((run) => run.scheduleId === "busy" && run.state === "dead") &&
        page.items.some((run) => run.scheduleId === "missing" && run.state === "dead"),
    );
    const busyRun = runs.items.find((run) => run.scheduleId === "busy" && run.state === "dead")!;
    expect(busyRun.attempt).toBe(2);
    expect(busyRun.lastError).toBe("HTTP 503 busy");
    const missingRun = runs.items.find((run) => run.scheduleId === "missing" && run.state === "dead")!;
    expect(missingRun.attempt).toBe(1);
    expect(missingRun.lastError).toBe("HTTP 404 no such function");
    await queue.terminate({ all: true }, { cause: "test over" });
  } finally {
    busy.stop();
    missing.stop();
    await stop();
  }
}, 20000);

test("an invalid BACKPLANE_CALLBACK_ORIGINS value stops startup", async () => {
  await expect(start({ BACKPLANE_CALLBACK_ORIGINS: "https://app.example/rpc" })).rejects.toThrow(
    "BACKPLANE_CALLBACK_ORIGINS must list origins",
  );
});
