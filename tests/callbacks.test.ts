import { test, expect } from "bun:test";
import { rpcCalls } from "defuss-rpc/client";
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
/** What the app below serves, the type its schedules are built from. */
type AppApi = { jobs: { notify(text: string, count: number): Promise<{ ok: boolean }> } };
/** An app's own defuss-rpc server on loopback, as an app service would run it. `check` runs inside each call, as an
 * app checks the callback token while the call is in flight. */
function app(answer?: (request: Request) => Response | undefined, check?: (headers: Headers) => Promise<unknown>) {
  const calls: { args: unknown[]; headers: Headers; checked?: unknown }[] = [];
  let last: Headers | undefined;
  const api: AppApi = {
    jobs: {
      async notify(...args: unknown[]) {
        const headers = last!;
        calls.push({ args, headers, checked: await check?.(headers).catch((e: unknown) => fault(Promise.reject(e))) });
        return { ok: true };
      },
    },
  };
  const rpc = createRpcServer(api);
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

test("a schedule with handler _rpc calls the app's RPC function with its arguments and a token valid while it runs", async () => {
  const { stop } = await start();
  const backplane = await connectBackplane({ app: "shop" });
  const target = app(undefined, (headers) => backplane.callbacks.verify(headers.get("x-backplane-callback") ?? ""));
  try {
    const queue = backplane.tenant("acme").scheduler("jobs");
    const created = await queue.create({
      id: "notify",
      cron: "* * * * * *",
      handler: "_rpc",
      payload: { url: target.url, className: "jobs", methodName: "notify", args: ["hello", 2] },
    });
    const calls = await until(async () => target.calls, (c) => c.length > 0);
    await queue.pause("notify", { revision: created.revision, requestId: "pause" });
    expect(calls[0].args).toEqual(["hello", 2]);
    // The daemon's key never leaves it; the app learns the call's scope from the token instead.
    expect(calls[0].headers.get("authorization")).toBeNull();
    expect(calls[0].checked).toMatchObject({ app: "shop", tenant: "acme", bucket: "jobs", schedule: "notify" });
    expect(calls[0].headers.get("x-backplane-schedule")).toBe("notify");
    // Once the call ended, its token is gone.
    expect(await fault(backplane.callbacks.verify(calls[0].headers.get("x-backplane-callback")!))).toBe("NOT_FOUND 404");
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

test("a payload built with rpcCalls runs like the flat one, and a call version defuss-rpc does not know is refused", async () => {
  const { stop } = await start();
  const target = app();
  try {
    const queue = (await connectBackplane({ app: "shop" })).tenant("acme").scheduler("typed");
    const call = rpcCalls<AppApi>().jobs.notify("typed", 3);
    expect(call).toEqual({ v: 1, className: "jobs", methodName: "notify", args: ["typed", 3] });
    const created = await queue.create({ id: "typed", cron: "* * * * * *", handler: "_rpc", payload: { url: target.url, ...call } });
    const calls = await until(async () => target.calls, (c) => c.length > 0);
    await queue.pause("typed", { revision: created.revision, requestId: "pause-typed" });
    expect(calls[0].args).toEqual(["typed", 3]);
    const yearly = { cron: "0 0 1 1 *", handler: "_rpc" };
    // A version this defuss-rpc does not know, as a newer app could store it.
    const future = { url: target.url, ...call, v: 2 };
    expect(await fault(queue.create({ ...yearly, id: "future", payload: future }))).toBe("INVALID_ARGUMENT 400");
  } finally {
    target.stop();
    await stop();
  }
}, 20000);
