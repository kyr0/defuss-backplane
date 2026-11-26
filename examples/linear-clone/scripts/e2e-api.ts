/** VERIFIED: scripts/e2e.ts runs it against the built app. Every MCP tool returns what its RPC function returns. The MCP
 * client connects from the file `make mcp-config` wrote for this app, exactly as a configured agent does; the RPC
 * client is the defuss-rpc client the frontend uses. A read runs through both on the same state. A write runs the same
 * call on twin issues, one per transport, and both return the same value once fields that name the subject or a time
 * are masked; each twin is then read back through the other transport. A failed call compares the HTTP status. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createRpcContext } from "defuss-rpc/client";
import type { Api } from "../src/server/api.ts";

type Outcome = { value: unknown } | { status: number };
/** What Issues.create and Issues.update return. */
type Page = { issue: { id: string }; revision: string };
const VOLATILE = new Set(["id", "issue", "number", "revision", "createdAt", "updatedAt", "startedAt", "completedAt", "at", "title", "body"]);

/** Drops the volatile fields that hold a scalar; an object under such a name (a result's `issue`) is compared inside. */
function mask(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mask);
  if (value === null || typeof value !== "object") return value;
  const kept = Object.entries(value).filter(([k, v]) => !(VOLATILE.has(k) && (v === null || typeof v !== "object")));
  return Object.fromEntries(kept.map(([k, v]) => [k, mask(v)]));
}

/** Runs the comparison; returns one `[step, error | null]` per tool group, for the e2e report. */
export async function checkApi(baseUrl: string, mcpConfig: string): Promise<[string, string | null][]> {
  const { mcpServers } = JSON.parse(await readFile(mcpConfig, "utf8")) as { mcpServers: Record<string, { type: string; url: string }> };
  const server = mcpServers["linear-clone"];
  assert.equal(server?.type, "http", "mcp.json has an http entry for linear-clone");
  const agent = new Client({ name: "e2e", version: "1" });
  await agent.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  const rpc = await createRpcContext({ baseUrl }).getRpcClient<Api>();
  const called = new Set<string>();

  async function viaMcp(name: string, ...args: unknown[]): Promise<Outcome> {
    called.add(name);
    const r = await agent.callTool({ name, arguments: { args } });
    if (!r.isError) return { value: (r.structuredContent as { value: unknown }).value };
    // VERIFIED: the bridge reports a failed call as "RPC call rejected (HTTP <status>)" (tests/api.test.ts).
    return { status: Number(/HTTP (\d{3})/.exec(JSON.stringify(r.content))?.[1]) };
  }
  async function viaRpc(call: () => Promise<unknown>): Promise<Outcome> {
    try {
      return { value: JSON.parse(JSON.stringify((await call()) ?? null)) };
    } catch (e) {
      return { status: (e as { status: number }).status };
    }
  }
  /** Each call states its outcome: a value, or the HTTP status both transports must fail with. Two equal failures
   * therefore never pass as a match by accident. */
  const outcome = (o: Outcome, name: string, status?: number) =>
    assert.ok(status === undefined ? "value" in o : "status" in o && o.status === status, name + " " + JSON.stringify(o).slice(0, 200));
  async function read(name: string, args: unknown[], call: () => Promise<unknown>, status?: number) {
    const m = await viaMcp(name, ...args);
    outcome(m, name, status);
    assert.deepEqual(m, await viaRpc(call), name);
  }
  async function write(name: string, mcpArgs: unknown[], call: () => Promise<unknown>, status?: number) {
    const m = await viaMcp(name, ...mcpArgs);
    const r = await viaRpc(call);
    outcome(m, name, status);
    assert.deepEqual(mask(m), mask(r), name);
    return [m, r].map((o) => ("value" in o ? o.value : undefined)) as [Page, Page];
  }

  const steps: [string, () => Promise<void>][] = [
    ["reads match: Workspace, Issues, Inbox, Cycles", async () => {
      await read("Workspace.bootstrap", [], () => rpc.Workspace.bootstrap());
      const issues = await rpc.Issues.list();
      await read("Issues.list", [], () => rpc.Issues.list());
      for (const { id } of issues.slice(0, 3)) {
        await read("Issues.get", [id], () => rpc.Issues.get(id));
        await read("Issues.attachments", [id], () => rpc.Issues.attachments(id));
      }
      await read("Issues.get", ["ENG-999"], () => rpc.Issues.get("ENG-999"), 404);
      await read("Inbox.list", [], () => rpc.Inbox.list());
      const current = await rpc.Cycles.current();
      assert.ok(current, "the seed has a running cycle");
      await read("Cycles.current", [], () => rpc.Cycles.current());
      await read("Cycles.stats", [current.cycle.id], () => rpc.Cycles.stats(current.cycle.id));
      await read("Cycles.stats", ["none"], () => rpc.Cycles.stats("none"), 404);
    }],
    ["writes match on twin issues, and each reads back through the other transport", async () => {
      const draft = { title: "twin", priority: "high" as const };
      const [m, r] = await write("Issues.create", [{ ...draft, title: "twin m" }], () => rpc.Issues.create({ ...draft, title: "twin r" }));
      const [mid, rid] = [m.issue.id, r.issue.id];
      assert.notEqual(mid, rid);
      assert.deepEqual(mask(await viaRpc(() => rpc.Issues.get(mid))), mask(await viaMcp("Issues.get", rid)), "created twins read back");
      await write("Issues.update", [mid, { status: "progress" }, m.revision], () => rpc.Issues.update(rid, { status: "progress" }, r.revision));
      // The creation revision is stale now: both transports refuse it with the same status.
      await write("Issues.update", [mid, { status: "done" }, m.revision], () => rpc.Issues.update(rid, { status: "done" }, r.revision), 409);
      await write("Issues.comment", [mid, "from mcp"], () => rpc.Issues.comment(rid, "from rpc"));
      // A missing file is no error: both return false.
      const [gone] = await write("Issues.removeAttachment", [mid, "absent.txt"], () => rpc.Issues.removeAttachment(rid, "absent.txt"));
      assert.equal(gone, false);
      assert.deepEqual(mask(await viaRpc(() => rpc.Issues.get(mid))), mask(await viaMcp("Issues.get", rid)), "changed twins read back");
      await write("Inbox.markRead", [["none-m"]], () => rpc.Inbox.markRead(["none-r"]));
      await write("Issues.remove", [mid], () => rpc.Issues.remove(rid));
      await read("Issues.get", [mid], () => rpc.Issues.get(mid), 404);
      assert.deepEqual(await viaRpc(() => rpc.Issues.get(rid)), { status: 404 }, "removed twins are gone");
    }],
    ["every MCP tool ran through both transports", async () => {
      const names = (await agent.listTools()).tools.map((t) => t.name).sort();
      assert.deepEqual([...called].sort(), names);
    }],
  ];
  const results: [string, string | null][] = [];
  try {
    for (const [step, run] of steps) {
      try {
        await run();
        results.push([step, null]);
      } catch (error) {
        results.push([step, String(error).slice(0, 600)]);
        break;
      }
    }
  } finally {
    await agent.close();
  }
  return results;
}
