/** VERIFIED: The executable is copied outside the source tree and imports the installed client and the official MCP SDK. */
import { checkRevisions } from "./consumer-revisions.ts";
import { checkVfs } from "./consumer-vfs.ts";
import { connectMcp } from "./consumer-mcp.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { connectBackplane, type Scope } from "defuss-backplane/client";

for (const name of [
  "onnxruntime-node",
  "onnxruntime-web",
  "@huggingface/transformers",
]) {
  assert.throws(() => import.meta.resolve(name));
}
const [phase, previous, fixture] = process.argv.slice(2);
const scope: Scope = JSON.parse(await readFile(fixture, "utf8"));
const client = await connectBackplane({ app: scope.app });
const tenant = client.tenant(scope.tenant);
const cache = tenant.cache(scope.bucket),
  db = tenant.db(scope.bucket);
const agent = await connectMcp("packed-consumer");
/** Calls a tool that must succeed and returns its `structuredContent.value`, typed by the caller. */
async function call<T = unknown>(
  name: string,
  fields: Record<string, unknown>,
): Promise<T> {
  const result = await agent.callTool({
    name,
    arguments: { scope, ...fields },
  });
  assert.ok(!result.isError, JSON.stringify(result.structuredContent));
  return (result.structuredContent as { value: T }).value;
}
try {
  assert.deepEqual((await agent.listTools()).tools.map((t) => t.name).sort(), [
    "cache.delete",
    "cache.get",
    "cache.getVersioned",
    "cache.set",
    "db.delete",
    "db.get",
    "db.getVersioned",
    "db.insert",
    "db.query",
    "db.update",
    "logs.read",
    "logs.write",
    "scheduler.create",
    "scheduler.get",
    "scheduler.getRun",
    "scheduler.list",
    "scheduler.listRuns",
    "scheduler.pause",
    "scheduler.remove",
    "scheduler.resume",
    "scheduler.runHistory",
    "scheduler.scheduleHistory",
    "scheduler.terminate",
    "scheduler.update",
    "vfs.delete",
    "vfs.get",
    "vfs.head",
    "vfs.list",
    "vfs.put",
  ]);
  const curlApp = await connectBackplane({ app: "curl" });
  assert.deepEqual(await curlApp.tenant("local").cache("items").get("hello"), {
    hit: true,
    value: phase.replace(/-peer$/, ""),
  });
  if (previous !== "-") {
    assert.deepEqual(await call("cache.get", { key: previous }), {
      hit: true,
      value: previous,
    });
    assert.deepEqual(await cache.get(previous + "-expired"), { hit: false });
    assert.deepEqual(await db.get(previous), {
      id: previous,
      runtime: previous,
    });
  }
  assert.equal(await call("cache.set", { key: phase, value: phase }), true);
  assert.deepEqual(await cache.get(phase), { hit: true, value: phase });
  await cache.set(phase + "-expired", phase, 0);
  assert.equal(
    await call("db.insert", { document: { id: phase, runtime: phase } }),
    phase,
  );
  assert.deepEqual(await db.get(phase), { id: phase, runtime: phase });
  assert.equal(await db.insert({ id: "transient", val: 1 }), "transient");
  assert.equal(
    await call("db.update", { id: "transient", patch: { val: 2 } }),
    true,
  );
  assert.deepEqual(await call("db.get", { id: "transient" }), {
    id: "transient",
    val: 2,
  });
  assert.deepEqual(
    (
      await call<{ rows: unknown[] }>("db.query", {
        request: {
          filters: [{ field: "val", op: "eq", value: 2 }],
          projection: ["id"],
        },
      })
    ).rows,
    [{ id: "transient" }],
  );
  assert.equal(await call("db.delete", { id: "transient" }), true);
  assert.equal(await call("cache.delete", { key: "absent" }), true);
  const other = client.tenant(scope.tenant + "-second");
  assert.equal((await other.cache(scope.bucket).get(phase)).hit, false);
  assert.equal(await other.db(scope.bucket).get(phase), null);
  const otherApp = await connectBackplane({ app: scope.app + "-second" });
  assert.equal(
    await otherApp.tenant(scope.tenant).db(scope.bucket).get(phase),
    null,
  );
  assert.equal(
    await (await connectBackplane({ app: scope.app }))
      .tenant(scope.tenant)
      .db("other")
      .get(phase),
    null,
  );
  // The tenant's log takes an MCP write and returns it over RPC with a Date timestamp; the app log does the reverse.
  // Every phase shares the data root, so earlier phases' records are there too.
  const logScope = { app: scope.app, tenant: scope.tenant };
  const mcpWrite = await agent.callTool({
    name: "logs.write",
    arguments: { scope: logScope, entries: [{ level: "warn", message: "phase " + phase }] },
  });
  assert.ok(!mcpWrite.isError, JSON.stringify(mcpWrite.structuredContent));
  const warnings = await tenant.logs().read({ levels: ["warn"], limit: 1000 });
  assert.ok(warnings.records.some((r) => r.message === "phase " + phase && r.ts instanceof Date));
  assert.deepEqual(await client.logs().write([{ level: "info", message: "app " + phase }]), { written: 1 });
  const mcpRead = await agent.callTool({ name: "logs.read", arguments: { scope: { app: scope.app }, request: { limit: 1000 } } });
  const appLog = (mcpRead.structuredContent as { value: { records: { message: string }[] } }).value.records;
  assert.ok(appLog.some((r) => r.message === "app " + phase));
  // Any caller reads the daemon's own log, where this daemon's start line is, but cannot write it.
  const own = (await connectBackplane({ app: "_backplane" })).logs();
  const started = await own.read({ limit: 1000 });
  assert.ok(started.records.some((r) => r.message === "listening http://127.0.0.1:" + process.env.PORT));
  await assert.rejects(own.write([{ level: "error", message: "forged" }]), (e: { code?: string }) => e.code === "INVALID_ARGUMENT");
  await checkRevisions({ scope, phase, previous, tenant, agent });
  await checkVfs({ scope, phase, previous, tenant, agent });
  process.stdout.write(
    JSON.stringify({
      phase,
      previous,
      tools: 29,
      consumer: process.versions.bun
        ? "Bun " + process.versions.bun
        : "Node.js " + process.version,
    }) + "\n",
  );
} finally {
  await agent.close();
}
