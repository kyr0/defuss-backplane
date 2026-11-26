import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { connectBackplane } from "defuss-backplane/client";
import { createRpcContext } from "defuss-rpc/client";
import type { Seed } from "../src/core/seed.ts";
import type { Api } from "../src/server/api.ts";
import { loadConfig } from "../src/server/config.ts";
import { schedules, upsertSchedules } from "../src/server/jobs.ts";
import { type Server, startServer } from "../src/server/server.ts";
import { type Daemon, freePort, startDaemon } from "./helpers/daemon.ts";

const seed: Seed = await Bun.file(new URL("../input/seed.json", import.meta.url)).json();
let daemon: Daemon;
let publicDir: string;
const servers: Server[] = [];
/** The app's clock; the seed's day until a test moves it. */
let clock = new Date("2026-10-03T12:00:00Z");

async function start(workspace: string, env: Record<string, string> = {}) {
  const config = loadConfig({
    PORT: String(await freePort()),
    BACKPLANE_PORT: String(daemon.port),
    BACKPLANE_API_KEY: daemon.apiKey,
    WORKSPACE: workspace,
    ...env,
  });
  const server = await startServer(config, { publicDir, seed, now: () => clock });
  servers.push(server);
  return server;
}
const clients = async (server: Server, authorization?: string) =>
  createRpcContext({ baseUrl: server.url, headers: authorization ? { Authorization: authorization } : {} }).getRpcClient<Api>();

beforeAll(async () => {
  daemon = await startDaemon();
  publicDir = await mkdtemp(join(tmpdir(), "linear-clone-public-"));
});
afterAll(async () => {
  for (const server of servers) await server.close().catch(() => {});
  await daemon?.stop();
  await rm(publicDir, { recursive: true, force: true });
});

test("Jobs answer only the bot key, and MCP does not list them", async () => {
  const server = await start("guard");
  const anonymous = await clients(server);
  expect(await anonymous.Jobs.dueDigest().catch((e: { status: number }) => e.status)).toBe(403);
  expect(await (await clients(server, "Bearer wrong")).Jobs.dueDigest().catch((e: { status: number }) => e.status)).toBe(403);
  const backplane = await clients(server, "Bearer " + daemon.apiKey);
  // VERIFIED: in the seed, ENG-140 (Sophie) is due on 2026-10-03 and ENG-142 (Aron) on 2026-10-04.
  expect(await backplane.Jobs.dueDigest()).toEqual({ date: "2026-10-03", items: 1, added: 1 });
  expect(await backplane.Jobs.dueDigest()).toEqual({ date: "2026-10-03", items: 1, added: 0 });
  const agent = new Client({ name: "test", version: "1" });
  await agent.connect(new StreamableHTTPClientTransport(new URL(server.url + "/mcp")));
  expect((await agent.listTools()).tools.some((t) => t.name.startsWith("Jobs."))).toBe(false);
  await agent.close();
});

test("the rollover closes the ended cycle, carries its open issues and opens the next, once", async () => {
  const server = await start("rollover");
  const backplane = await clients(server, "Bearer " + daemon.apiKey);
  clock = new Date("2026-10-13T08:00:00Z");
  try {
    expect(await backplane.Jobs.cycleRollover()).toEqual({ closed: ["eng-24"], opened: ["eng-25"] });
    expect(await backplane.Jobs.cycleRollover()).toEqual({ closed: [], opened: [] });
    const rpc = await clients(server);
    const { cycles } = await rpc.Workspace.bootstrap();
    expect(cycles.map((c) => [c.id, c.closed, c.start, c.end])).toEqual([
      ["eng-24", true, "2026-09-28", "2026-10-11"],
      ["eng-25", false, "2026-10-12", "2026-10-25"],
    ]);
    const issues = await rpc.Issues.list();
    // VERIFIED: 3 of the 15 seeded issues are done; the other 12 move.
    expect(issues.filter((i) => i.cycle === "eng-25")).toHaveLength(12);
    expect(issues.filter((i) => i.cycle === "eng-24").every((i) => i.status === "done")).toBe(true);
    expect((await rpc.Cycles.current())?.cycle.id).toBe("eng-25");
  } finally {
    clock = new Date("2026-10-03T12:00:00Z");
  }
});

test("a restart on another port updates the callback URL; an unchanged start leaves the schedules alone", async () => {
  const first = await start("restart");
  const queue = (await connectBackplane({ app: "linear-clone", port: daemon.port, apiKey: daemon.apiKey }))
    .tenant("restart")
    .scheduler("jobs");
  const url = async (id: string) => ((await queue.get(id))?.payload as { url?: string } | undefined)?.url;
  const before = await queue.get("due-digest");
  expect(await url("due-digest")).toBe(first.url + "/rpc");
  await first.close();
  const second = await start("restart");
  expect(await url("due-digest")).toBe(second.url + "/rpc");
  expect((await queue.get("due-digest"))?.revision).not.toBe(before?.revision);
  const defaults = schedules({ digestCron: "0 9 * * *", rolloverCron: "0 0 * * 1" });
  expect(await upsertSchedules(queue, second.url + "/rpc", "UTC", defaults)).toEqual({
    "due-digest": "unchanged",
    "cycle-rollover": "unchanged",
  });
  const rollover = await queue.get("cycle-rollover");
  expect(rollover).toMatchObject({ cron: "0 0 * * 1", timezone: "UTC", handler: "_rpc", state: "active" });
});

test("after an agent terminates or removes the schedules, the next start creates successors under the job's ref", async () => {
  // VERIFIED: defuss-scheduler keeps a removed or terminated schedule's ID reserved, and the deep suite saw the next start
  // fail with "Schedule ID is reserved".
  const first = await start("retired");
  const queue = (await connectBackplane({ app: "linear-clone", port: daemon.port, apiKey: daemon.apiKey }))
    .tenant("retired")
    .scheduler("jobs");
  await queue.terminate({ schedule: "due-digest" }, { cause: "agent" });
  const rollover = await queue.get("cycle-rollover");
  await queue.remove("cycle-rollover", { revision: rollover!.revision, requestId: crypto.randomUUID() });
  await first.close();
  const second = await start("retired");
  const live = (await queue.list({ limit: 500 })).items.filter((s) => s.state === "active");
  expect(live.map((s) => [s.ref, (s.payload as { methodName: string }).methodName, (s.payload as { url: string }).url]).sort()).toEqual([
    ["cycle-rollover", "cycleRollover", second.url + "/rpc"],
    ["due-digest", "dueDigest", second.url + "/rpc"],
  ]);
  const defaults = schedules({ digestCron: "0 9 * * *", rolloverCron: "0 0 * * 1" });
  expect(await upsertSchedules(queue, second.url + "/rpc", "UTC", defaults)).toEqual({
    "due-digest": "unchanged",
    "cycle-rollover": "unchanged",
  });
});

test("the backplane delivers the digest callback, and an inbox item appears", async () => {
  await start("delivery", { DIGEST_CRON: "* * * * * *" });
  const notifications = (await connectBackplane({ app: "linear-clone", port: daemon.port, apiKey: daemon.apiKey }))
    .tenant("delivery")
    .db("notifications");
  // VERIFIED: the seeded ENG-140 is Sophie's and due on the seed's day, so the digest writes this item.
  const query = { filters: [{ field: "id", op: "eq" as const, value: "digest:2026-10-03:ENG-140" }] };
  let rows: unknown[] = [];
  for (let i = 0; i < 100 && !rows.length; i++) {
    rows = (await notifications.query(query)).rows;
    if (!rows.length) await Bun.sleep(100);
  }
  expect(rows).toEqual([expect.objectContaining({ person: "sophie", kind: "due", issue: "ENG-140", detail: "2026-10-03" })]);
}, 20_000);
