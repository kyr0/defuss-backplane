import { test, expect } from "bun:test";
import { randomBytes } from "node:crypto";
import { rpcCalls } from "defuss-rpc/client";
import { createRpcServer } from "defuss-rpc/server";
import { PermanentFailure, startWorker } from "defuss-scheduler/worker";
import { BackplaneError, connectBackplane, type CallbackCall } from "../src/client.js";
import { start } from "./daemon.js";

const fault = (promise: Promise<unknown>) =>
  promise.then(
    () => "OK",
    (e: unknown) => (e instanceof BackplaneError ? e.code + " " + e.status : String(e)),
  );
async function until(done: () => boolean | Promise<boolean>, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
/** The hooks an app serves; the jobs' follow-ups are built from this type. */
type HookApi = { Hooks: { ended(job: string): Promise<{ ok: true }> } };
/** The app's own defuss-rpc server, which checks each hook's callback token while the call runs. */
function app(verify: (token: string) => Promise<CallbackCall>) {
  const heard: { job: string; call: CallbackCall }[] = [];
  let last: Headers | undefined;
  const api: HookApi = {
    Hooks: {
      async ended(job) {
        heard.push({ job, call: await verify(last!.get("x-backplane-callback") ?? "") });
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
      return rpc.fetch(request);
    },
  });
  return { heard, url: `http://127.0.0.1:${server.port}/rpc`, stop: () => server.stop(true) };
}

test("two clients' workers pull a tenant's jobs with the app's bot key, and each ending calls the app's hook with a verified cause", async () => {
  const { stop } = await start({ BACKPLANE_AUTH_MASTER_KEY: randomBytes(32).toString("base64url") });
  const root = await connectBackplane({ app: "shop" });
  const bot = await root.bots.create({ name: "shop workers", apps: ["shop"] });
  // Two connections with the bot key, as two app processes or containers would hold them.
  const [one, two] = await Promise.all([1, 2].map(() => connectBackplane({ app: "shop", apiKey: bot.key })));
  const target = app((token) => one!.callbacks.verify(token));
  const calls = rpcCalls<HookApi>();
  const hook = (job: string) => ({ handler: "_rpc", payload: { url: target.url, ...calls.Hooks.ended(job) } });
  const on = (job: string) => ({ succeeded: hook(job), dead: hook(job), timedOut: hook(job), terminated: hook(job) });
  const ran: string[] = [];
  const workers = [one!, two!].map((client, n) =>
    startWorker(client.tenant("acme").scheduler("render"), {
      workerId: "render-" + n,
      handlers: {
        render: async (run) => {
          ran.push("render-" + n);
          await new Promise((resolve) => setTimeout(resolve, 400));
          return { page: (run.payload as { page: number }).page * 2 };
        },
        fail: () => {
          throw new PermanentFailure("bad input");
        },
        hang: (_run, ctx) => new Promise((resolve) => ctx.signal.addEventListener("abort", () => resolve(null))),
      },
    }),
  );
  const queue = one!.tenant("acme").scheduler("render");
  try {
    const pages = [1, 2, 3, 4, 5, 6];
    for (const page of pages) await queue.submit({ id: "page-" + page, handler: "render", payload: { page }, on: on("page-" + page) });
    await queue.submit({ id: "broken", handler: "fail", on: on("broken") });
    await queue.submit({ id: "slow", handler: "hang", timeoutMs: 1500, on: on("slow") });
    await queue.submit({ id: "idle", handler: "nobody", on: on("idle") });
    expect(await queue.terminate({ job: "idle" }, { cause: "not needed" })).toEqual({ schedules: 0, runs: 1 });
    // A job can be an RPC call itself: the daemon makes it once.
    await queue.submit({ id: "direct", handler: "_rpc", payload: { url: target.url, ...calls.Hooks.ended("direct") } });
    await until(() => target.heard.length === 10);
    for (const page of pages) expect(await queue.getJob("page-" + page)).toMatchObject({ state: "succeeded", result: { page: page * 2 } });
    expect(await queue.getJob("broken")).toMatchObject({ state: "dead", lastError: "bad input" });
    expect(await queue.getJob("slow")).toMatchObject({ state: "timedOut" });
    expect(new Set(ran).size).toBe(2);
    const ending = Object.fromEntries(target.heard.map(({ job, call }) => [job, call]));
    for (const [job, state] of [...pages.map((p) => ["page-" + p, "succeeded"]), ["broken", "dead"], ["slow", "timedOut"], ["idle", "terminated"]]) {
      // The daemon, not the request, says which job ended and how.
      expect(ending[job!]).toMatchObject({ app: "shop", tenant: "acme", bucket: "render", schedule: null, job: null, cause: { job, state } });
      expect(ending[job!]!.cause!.run).toBe((await queue.getJob(job!))!.id);
    }
    expect(ending.direct).toMatchObject({ schedule: null, job: "direct", cause: null });
    // Another app's bot cannot queue work here, and handler names starting with _ stay the daemon's.
    const other = await root.bots.create({ name: "other", apps: ["other"] });
    const foreign = (await connectBackplane({ app: "shop", apiKey: other.key })).tenant("acme").scheduler("render");
    expect(await fault(foreign.submit({ id: "x", handler: "render" }))).toBe("FORBIDDEN 403");
    expect(await fault(queue.submit({ id: "x", handler: "_hidden" }))).toBe("INVALID_ARGUMENT 400");
    expect(await fault(queue.submit({ id: "x", handler: "render", on: { dead: { handler: "_x" } } }))).toBe("INVALID_ARGUMENT 400");
    // A hook to an address the operator did not allow fails at submission, not when the job ends.
    const away = { handler: "_rpc", payload: { url: "http://example.com/rpc", ...calls.Hooks.ended("x") } };
    expect(await fault(queue.submit({ id: "x", handler: "render", on: { dead: away } }))).toBe("INVALID_ARGUMENT 400");
    expect(await fault(queue.submit({ id: "x", ...away }))).toBe("INVALID_ARGUMENT 400");
    expect(await queue.getJob("x")).toBeNull();
  } finally {
    await Promise.all(workers.map((w) => w.stop()));
    target.stop();
    await stop();
  }
}, 40_000);

test("agents queue and read jobs over MCP with the same results as RPC", async () => {
  const { agent, stop } = await start();
  const queue = (await connectBackplane({ app: "shop" })).tenant("acme").scheduler("render");
  const scope = { app: "shop", tenant: "acme", bucket: "render" };
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = (await agent.callTool({ name, arguments: { scope, ...args } })) as { isError?: boolean; structuredContent: { value?: unknown; code?: string } };
    return r.isError ? r.structuredContent.code : r.structuredContent.value;
  };
  try {
    const job = { id: "mcp-1", handler: "render", payload: { page: 1 }, timeoutMs: 60_000 };
    const admitted = (await tool("scheduler.submit", { job, options: { requestId: "r1" } })) as { id: string; jobId: string };
    expect(admitted.jobId).toBe("mcp-1");
    expect(await tool("scheduler.submit", { job, options: { requestId: "r1" } })).toEqual(admitted);
    expect(await tool("scheduler.getJob", { id: "mcp-1" })).toEqual(JSON.parse(JSON.stringify(await queue.getJob("mcp-1"))));
    expect(await tool("scheduler.getJob", { id: "absent" })).toBeNull();
    expect(await tool("scheduler.submit", { job: { ...job, handler: "_x" } })).toBe("INVALID_ARGUMENT");
    // A job stops by its ID over MCP as over RPC.
    await queue.submit({ id: "mcp-2", handler: "render" });
    expect(await tool("scheduler.terminate", { target: { job: "mcp-2" }, options: { cause: "agent" } })).toEqual({ schedules: 0, runs: 1 });
    expect(await queue.getJob("mcp-2")).toMatchObject({ state: "terminated", terminationCause: "agent" });
    const listed = (await agent.listTools()).tools.find((t) => t.name === "scheduler.getJob");
    expect(listed?.annotations?.readOnlyHint).toBe(true);
  } finally {
    await stop();
  }
}, 20_000);
