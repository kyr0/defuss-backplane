/** VERIFIED: make e2e runs it on each daemon phase. The job workflow as an app runs it with the packed package: two
 * worker processes, one under Node.js and one under Bun, pull one tenant's jobs with the app's bot key and do the work
 * in defuss-multicore worker threads. The app submits 20 jobs, a permanent failure, one past its deadline and one it
 * terminates, and every ending calls the app's RPC hook, which checks its callback token while the call runs. Prints
 * one JSON line. `node consumer-jobs.ts <phase>` coordinates; `<runtime> consumer-jobs.ts <phase> worker <n>` is a
 * worker process, which reads the bot key from stdin, so the key shows in no process list. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { Worker as ThreadWorker } from "node:worker_threads";
import { createPool } from "defuss-multicore";
import { rpcCalls } from "defuss-rpc/client";
import { createRpcServer } from "defuss-rpc/server";
import { PermanentFailure, poolHandlers, startWorker } from "defuss-scheduler/worker";
import { connectBackplane, type CallbackCall } from "defuss-backplane/client";

const [phase = "e2e", role, n] = process.argv.slice(2);
const app = ("jobs-" + phase).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
const print = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");

if (role === "worker") {
  const key = (await new Promise<string>((done) => {
    let text = "";
    process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => done(text.trim()));
  })) as string;
  const queue = (await connectBackplane({ app, apiKey: key })).tenant("acme").scheduler("render");
  // node:worker_threads under both runtimes: defuss-multicore 0.1.1 answers through it under Bun too, 0.1.0 did not.
  const url = new URL("./consumer-pool.ts", import.meta.url);
  const pool = createPool({ worker: () => new ThreadWorker(url), maxWorkers: 2 });
  const render = poolHandlers(pool, ["render"]).render!;
  let handled = 0;
  const worker = startWorker(queue, {
    workerId: "worker-" + n,
    concurrency: 2,
    handlers: {
      render: (run, ctx) => {
        handled++;
        return render(run, ctx);
      },
      fail: () => {
        throw new PermanentFailure("bad input");
      },
      hang: (_run, ctx) => new Promise((done) => ctx.signal.addEventListener("abort", () => done(null))),
    },
  });
  print({ ready: n });
  process.once("SIGTERM", async () => {
    await worker.stop();
    await pool.terminate();
    print({ worker: n, runtime: process.versions.bun ? "bun" : "node", handled });
    process.exit(0);
  });
} else {
  type HookApi = { Hooks: { ended(job: string): Promise<null> } };
  const root = await connectBackplane({ app });
  const bot = await root.bots.create({ name: app, apps: [app] });
  const own = await connectBackplane({ app, apiKey: bot.key });
  const heard = new Map<string, CallbackCall>();
  let token = "";
  const api: HookApi = {
    Hooks: {
      async ended(job) {
        heard.set(job, await own.callbacks.verify(token));
        return null;
      },
    },
  };
  const rpc = createRpcServer(api);
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    token = String(req.headers["x-backplane-callback"] ?? "");
    const answer = await rpc.fetch(new Request("http://127.0.0.1" + req.url, { method: req.method, headers: req.headers as HeadersInit, body: Buffer.concat(chunks) }));
    res.writeHead(answer.status, Object.fromEntries(answer.headers)).end(Buffer.from(await answer.arrayBuffer()));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = "http://127.0.0.1:" + (server.address() as { port: number }).port + "/rpc";
  const calls = rpcCalls<HookApi>();
  const hook = (job: string) => ({ handler: "_rpc", payload: { url, ...calls.Hooks.ended(job) } });
  const on = (job: string) => ({ succeeded: hook(job), dead: hook(job), timedOut: hook(job), terminated: hook(job) });
  const workers = ["node", "bun"].map((runtime, i) => {
    const child = spawn(runtime, [process.argv[1]!, phase, "worker", String(i + 1)], { stdio: ["pipe", "pipe", "inherit"] });
    child.stdin.end(bot.key);
    return { child, lines: createInterface({ input: child.stdout })[Symbol.asyncIterator]() };
  });
  try {
    for (const w of workers) assert.ok(JSON.parse((await w.lines.next()).value ?? "{}").ready);
    const queue = own.tenant("acme").scheduler("render");
    const pages = Array.from({ length: 20 }, (_, i) => i + 1);
    for (const page of pages) await queue.submit({ id: "page-" + page, handler: "render", payload: { page }, on: on("page-" + page) });
    await queue.submit({ id: "broken", handler: "fail", on: on("broken") });
    await queue.submit({ id: "slow", handler: "hang", timeoutMs: 1500, on: on("slow") });
    await queue.submit({ id: "idle", handler: "nobody", on: on("idle") });
    await queue.terminate({ job: "idle" }, { cause: "not needed" });
    const end = Date.now() + 30_000;
    while (heard.size < 23 && Date.now() < end) await new Promise((done) => setTimeout(done, 50));
    const states: Record<string, string> = {};
    for (const page of pages) {
      const job = (await queue.getJob("page-" + page))!;
      assert.deepEqual([job.state, job.result], ["succeeded", { page: page * 2 }], "page-" + page);
      states[(heard.get("page-" + page)?.cause?.state as string) ?? "missing"] = "pages";
    }
    const endings = Object.fromEntries(["broken", "slow", "idle"].map((job) => [job, heard.get(job)?.cause?.state ?? "missing"]));
    assert.deepEqual(endings, { broken: "dead", slow: "timedOut", idle: "terminated" });
    assert.deepEqual(Object.keys(states), ["succeeded"]);
    for (const w of workers) w.child.kill("SIGTERM");
    const counts = [];
    for (const w of workers) counts.push(JSON.parse((await w.lines.next()).value ?? "{}"));
    // Both worker processes took part of the work.
    assert.ok(counts.every((c) => c.handled > 0), JSON.stringify(counts));
    assert.equal(counts.reduce((sum, c) => sum + c.handled, 0), 20);
    print({ phase, jobs: pages.length + 3, hooks: heard.size, endings, workers: counts });
  } finally {
    for (const w of workers) if (w.child.exitCode === null) w.child.kill("SIGKILL");
    server.close();
  }
}
