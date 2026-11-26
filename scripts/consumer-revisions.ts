/** VERIFIED: Run against the installed daemon through the official MCP client and the packed RPC SDK. */
import assert from "node:assert/strict";
import { DSON } from "defuss-dson";
import type { Client } from "@modelcontextprotocol/client";
import {
  BackplaneError,
  type Scope,
  type connectBackplane,
} from "defuss-backplane/client";

type Tenant = ReturnType<
  Awaited<ReturnType<typeof connectBackplane>>["tenant"]
>;
/** A successful versioned read as MCP reports it in `structuredContent.value`. */
type Revisioned<T = unknown> = { value: T; revision: string };
type Fault = { code: string; status: number };

/** Exercises revisions on the phase's bucket through RPC and MCP. It takes the tenant rather than the buckets:
 * VERIFIED: `ReturnType<Tenant["db"]>` instantiates the generic `db<T>` at `Document`, not `Row`, so the strict
 * check rejected `.value` reads and patches on the bucket type. */
export async function checkRevisions({
  scope,
  phase,
  previous,
  tenant,
  agent,
}: {
  scope: Scope;
  phase: string;
  previous: string;
  tenant: Tenant;
  agent: Client;
}) {
  const cache = tenant.cache(scope.bucket),
    db = tenant.db(scope.bucket);
  const tool = (name: string, fields: Record<string, unknown>) =>
    agent.callTool({ name, arguments: { scope, ...fields } });
  async function ok<T = unknown>(
    name: string,
    fields: Record<string, unknown>,
  ): Promise<T> {
    const result = await tool(name, fields);
    assert.ok(!result.isError, JSON.stringify(result.structuredContent));
    return (result.structuredContent as { value: T }).value;
  }
  async function fault(
    name: string,
    fields: Record<string, unknown>,
    code: string,
    status: number,
  ) {
    const result = await tool(name, fields);
    assert.equal(result.isError, true);
    const details = result.structuredContent as Fault;
    assert.equal(details.code, code);
    assert.equal(details.status, status);
  }
  const is = (code: string, status: number) => (e: unknown) =>
    e instanceof BackplaneError && e.code === code && e.status === status;
  const tools = (await agent.listTools()).tools;
  for (const t of tools) {
    assert.equal(
      t.annotations?.readOnlyHint,
      /\.(?:get|getVersioned|query|head|list|read|getRun|listRuns|scheduleHistory|runHistory|status|members|listApiKeys)$/.test(t.name),
    );
    assert.equal(
      t.annotations?.destructiveHint,
      [
        "cache.set",
        "cache.delete",
        "db.update",
        "db.delete",
        "vfs.put",
        "vfs.delete",
        "scheduler.update",
        "scheduler.pause",
        "scheduler.remove",
        "scheduler.terminate",
      ].includes(t.name),
    );
  }
  await assert.rejects(db.query({ limit: -1 }), is("INVALID_ARGUMENT", 400));
  await fault("db.query", { request: { limit: -1 } }, "INVALID_ARGUMENT", 400);
  await assert.rejects(db.insert({ id: phase }), is("ALREADY_EXISTS", 409));
  await fault("db.insert", { document: { id: phase } }, "ALREADY_EXISTS", 409);
  const id = { bigint: "900719925474099312345" };
  assert.deepEqual(await ok("db.insert", { document: { id, value: 1 } }), id);
  await fault("db.get", { id }, "DSON_REQUIRED", 422);
  const big: Revisioned<{ id: unknown }> = DSON.parse(
    (await ok<{ dson: string }>("db.getVersioned", { id, resultEncoding: "dson" }))
      .dson,
  );
  assert.equal(big.value.id, BigInt(id.bigint));
  assert.equal(await db.get(id.bigint), null);
  assert.equal(
    await ok("db.update", {
      id,
      patch: { value: 2 },
      ifRevision: big.revision,
    }),
    true,
  );
  assert.equal((await db.get(BigInt(id.bigint)))?.value, 2);
  assert.equal(await ok("db.delete", { id }), true);
  const common = { item: "one" },
    key = phase + "-alias";
  await cache.set(key, { left: common, right: common });
  await fault("cache.get", { key }, "DSON_REQUIRED", 422);
  const graph: { left: object; right: object } = DSON.parse(
    (await ok<{ dson: string }>("cache.get", { key, resultEncoding: "dson" }))
      .dson,
  ).value;
  assert.equal(graph.left, graph.right);
  // The two writers have the same revision. The transports can finish in either order.
  for (const engine of ["cache", "db"] as const) {
    const key = phase + "-race";
    if (engine === "db") await db.insert({ id: key, value: 0 });
    else await cache.set(key, 0, { ifRevision: null });
    const fields = engine === "db" ? { id: key } : { key };
    const initial = await ok<Revisioned>(engine + ".getVersioned", fields);
    const opts = { ifRevision: initial.revision };
    const [rpc, mcp] = await Promise.allSettled([
      engine === "db"
        ? db.update(key, { value: 1 }, opts)
        : cache.set(key, 1, opts),
      engine === "db"
        ? tool("db.update", { ...fields, patch: { value: 2 }, ...opts })
        : tool("cache.set", { ...fields, value: 2, ...opts }),
    ]);
    if (mcp.status !== "fulfilled") throw mcp.reason;
    const rpcWon = rpc.status === "fulfilled";
    assert.equal(rpcWon, !!mcp.value.isError);
    if (rpcWon)
      assert.equal(
        (mcp.value.structuredContent as Fault).code,
        "REVISION_CONFLICT",
      );
    else assert.ok(is("REVISION_CONFLICT", 409)(rpc.reason));
    const current = await ok<Revisioned>(engine + ".getVersioned", fields);
    assert.notEqual(current.revision, initial.revision);
    assert.equal(
      engine === "db"
        ? (current.value as { value: unknown }).value
        : current.value,
      rpcWon ? 1 : 2,
    );
    await fault(
      engine + ".delete",
      { ...fields, ...opts },
      "REVISION_CONFLICT",
      409,
    );
    const tokenKey = phase + "-saved-" + engine;
    await cache.set(tokenKey, current.revision);
    if (previous !== "-") {
      const old = previous + "-race";
      const saved = await cache.get(previous + "-saved-" + engine);
      assert.equal(saved.hit, true);
      const recovered = await ok<Revisioned>(
        engine + ".getVersioned",
        engine === "db" ? { id: old } : { key: old },
      );
      assert.equal(recovered.revision, saved.value);
    }
  }
}
