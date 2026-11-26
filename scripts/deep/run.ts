/** VERIFIED: `make e2e` runs it against the packed daemon and `make e2e-live` against the running one. The deep suite:
 * every scenario through RPC and through MCP in the tenant `_e2e_test_backplane`, buckets named with a run ID, then
 * the coverage guard: every method in `/rpc/schema`, every listed tool and every property path of every tool's input
 * schema must have run, so a feature without a test fails. Writes output/deep.json (or `--report`).
 *
 * `node --env-file=.env scripts/deep/run.ts --mcp .mcp.json [--pid <daemon pid>] [--only cache,db] [--report f]`;
 * the RPC client reads PORT and API_KEY like every backend. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { connectBackplane } from "defuss-backplane/client";
import { bigScenario, type Transfer } from "./big.ts";
import { cacheScenario } from "./cache.ts";
import { dbScenario } from "./db.ts";
import { httpScenario } from "./http.ts";
import { logsScenario } from "./logs.ts";
import { schedulerScenario } from "./scheduler.ts";
import { videoScenario } from "./video.ts";
import { vfsScenario } from "./vfs.ts";
import { mcpOps, rpcOps, schemaPaths, used } from "./drivers.ts";
import { context, type Ctx, results } from "./kit.ts";

const { values: flags } = parseArgs({
  options: {
    mcp: { type: "string", default: ".mcp.json" },
    app: { type: "string", default: "deep-e2e" },
    tenant: { type: "string", default: "_e2e_test_backplane" },
    run: { type: "string", default: Date.now().toString(36) },
    pid: { type: "string" },
    only: { type: "string" },
    report: { type: "string", default: "output/deep.json" },
    "big-mib": { type: "string", default: "512" },
    video: { type: "string", default: "input/video.webm" },
  },
});
const scenarios: Record<string, (ctx: Ctx) => Promise<void>> = { cache: cacheScenario, db: dbScenario, logs: logsScenario, scheduler: schedulerScenario, vfs: vfsScenario };
const only = flags.only ? flags.only.split(",") : null;
const selected = only ? only.filter((n) => n in scenarios) : Object.keys(scenarios);

const config = JSON.parse(await readFile(flags.mcp, "utf8")) as { mcpServers: Record<string, { url: string; headers?: Record<string, string> }> };
const server = config.mcpServers["defuss-backplane"];
if (!server) throw new Error(flags.mcp + " has no defuss-backplane entry: run make mcp-config");
const agent = new Client({ name: "deep-e2e", version: "1" });
await agent.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers ?? {} } }));
const client = await connectBackplane({ app: flags.app });
const rpc = rpcOps(client, flags.tenant);
const own = { rpc: rpcOps(await connectBackplane({ app: "_backplane" }), flags.tenant), mcp: mcpOps(agent, "_backplane", flags.tenant) };
const transports = [rpc, mcpOps(agent, flags.app, flags.tenant)];
const apiKey = (server.headers?.Authorization ?? "").replace(/^Bearer /, "");
const started = Date.now();
try {
  for (const name of selected)
    for (const ops of transports) {
      const ctx = context(name, { ops, rpc, own: own[ops.via], apiKey, app: flags.app, tenant: flags.tenant, bucket: `${name}-${ops.via}-${flags.run}` });
      await scenarios[name](ctx);
    }
  // HTTP-only features run once, with the RPC driver for setup.
  const http = { base: server.url.replace(/\/mcp$/, ""), headers: server.headers ?? {}, tool: (name: string, args: Record<string, unknown>) => agent.callTool({ name, arguments: args }) as never };
  const transfers: Transfer[] = [];
  if (!only || only.includes("http")) {
    await httpScenario(context("http", { ops: rpc, rpc, own: own.rpc, apiKey, app: flags.app, tenant: flags.tenant, bucket: `http-${flags.run}` }, "http"), http);
  }
  if (!only || only.includes("video"))
    await videoScenario(context("video", { ops: rpc, rpc, own: own.rpc, apiKey, app: flags.app, tenant: flags.tenant, bucket: `video-${flags.run}` }, "http"), http, flags.video);
  if (!only || only.includes("big")) {
    const ctx = context("big", { ops: rpc, rpc, own: own.rpc, apiKey, app: flags.app, tenant: flags.tenant, bucket: `big-${flags.run}` }, "http");
    await bigScenario(ctx, transports[1], http, Number(flags["big-mib"]), flags.pid ? Number(flags.pid) : undefined, transfers);
  }
  // The guard runs only on a full suite: a partial run cannot cover everything.
  const gaps: string[] = [];
  if (!flags.only) {
    const schema = (await (await fetch(server.url.replace(/\/mcp$/, "/rpc/schema"), { method: "POST", headers: server.headers })).json()) as {
      moduleName: string;
      methods: Record<string, unknown>;
    }[];
    for (const m of schema) for (const method of Object.keys(m.methods)) if (!used.rpc.has(m.moduleName + "." + method)) gaps.push("rpc " + m.moduleName + "." + method);
    for (const t of (await agent.listTools()).tools) {
      const seen = used.mcp.get(t.name);
      if (!seen) gaps.push("mcp " + t.name);
      else for (const p of schemaPaths(t.inputSchema as Record<string, unknown>)) if (!seen.has(p)) gaps.push("mcp " + t.name + " " + p);
    }
    results.push({ subsystem: "coverage", via: "both", step: "every RPC method, MCP tool and tool argument ran", ok: !gaps.length, ms: 0, ...(gaps.length ? { error: gaps.join("; ") } : {}) });
  }
  const failed = results.filter((r) => !r.ok);
  const report = { at: new Date().toISOString(), app: flags.app, tenant: flags.tenant, run: flags.run, ms: Date.now() - started, steps: results.length, failed: failed.length, gaps, transfers, results };
  await mkdir(dirname(flags.report), { recursive: true });
  await writeFile(flags.report, JSON.stringify(report, null, 2) + "\n");
  for (const r of failed) console.error(`FAIL ${r.subsystem} ${r.via} ${JSON.stringify(r.step)}: ${r.error}`);
  console.log(JSON.stringify({ deep: failed.length ? "FAIL" : "PASS", steps: results.length, failed: failed.length, gaps: gaps.length, report: flags.report }));
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await agent.close();
}
