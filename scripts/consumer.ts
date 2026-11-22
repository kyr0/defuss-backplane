/** VERIFIED: The executable is copied outside the source tree and imports the installed client and the official MCP SDK. */
import { checkRevisions } from "./consumer-revisions.ts";
import { checkVfs } from "./consumer-vfs.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
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
const agent = new Client({ name: "packed-consumer", version: "1" });
await agent.connect(
  new StreamableHTTPClientTransport(
    new URL("http://127.0.0.1:" + process.env.PORT + "/mcp"),
    {
      requestInit: {
        headers: { Authorization: "Bearer " + process.env.API_KEY },
      },
    },
  ),
);
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
  await checkRevisions({ scope, phase, previous, tenant, agent });
  await checkVfs({ scope, phase, previous, tenant, agent });
  process.stdout.write(
    JSON.stringify({
      phase,
      previous,
      tools: 15,
      consumer: process.versions.bun
        ? "Bun " + process.versions.bun
        : "Node.js " + process.version,
    }) + "\n",
  );
} finally {
  await agent.close();
}
