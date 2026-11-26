/** VERIFIED: every one of the 29 MCP tools returns what its RPC method returns. A read runs through both transports on
 * the same state; with `resultEncoding: "dson"` the MCP value decodes to the RPC value exactly. A write runs the same
 * operation on twin subjects, one per transport, and both return the same value once subject-specific fields (IDs,
 * keys, revisions, times) are masked; the twins are then read back through the other transport.
 * Run by scripts/e2e.ts against the packed daemon: `node consumer-equivalence.ts <phase>`. */
import assert from "node:assert/strict";
import { DSON } from "defuss-dson";
import { connectBackplane } from "defuss-backplane/client";
import { connectMcp } from "./consumer-mcp.ts";

const phase = process.argv[2] ?? "equivalence";
const scope = { app: "equivalence", tenant: "t-" + phase, bucket: "b" };
const logScope = { app: scope.app, tenant: scope.tenant };
const tenant = (await connectBackplane({ app: scope.app })).tenant(scope.tenant);
const cache = tenant.cache(scope.bucket);
const db = tenant.db(scope.bucket);
const vfs = tenant.vfs(scope.bucket);
const queue = tenant.scheduler(scope.bucket);
const agent = await connectMcp("equivalence");
const called = new Set<string>();

type Outcome = { value: unknown } | { error: { code: unknown; status: unknown } };

async function viaMcp(name: string, args: Record<string, unknown>, toolScope: object = scope): Promise<Outcome> {
  called.add(name);
  const r = await agent.callTool({ name, arguments: { scope: toolScope, ...args } });
  const content = r.structuredContent as { value?: unknown; code?: unknown; status?: unknown };
  return r.isError ? { error: { code: content.code, status: content.status } } : { value: content.value };
}
async function viaRpc(call: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { value: await call() };
  } catch (e) {
    const { code, status } = e as { code?: unknown; status?: unknown };
    return { error: { code, status } };
  }
}
/** The value as JSON carries it: dates become ISO strings, undefined fields vanish. */
const json = (o: Outcome): Outcome => JSON.parse(JSON.stringify(o));
const VOLATILE = new Set(["id", "key", "revision", "modifiedAt", "createdAt", "updatedAt", "nextDue", "lastProcessed", "lastSkipped", "requestId", "mtimeMs"]);
function mask(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mask);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !VOLATILE.has(k)).map(([k, v]) => [k, mask(v)]));
}
const valueOf = <T>(o: Outcome, name: string): T => {
  assert.ok("value" in o, name + ": " + JSON.stringify(o));
  return o.value as T;
};

/** Both transports read the same state. `adapt` turns the RPC value into the tool's JSON form where they differ. */
async function read(
  name: string,
  args: Record<string, unknown>,
  rpc: () => Promise<unknown>,
  opts: { dson?: boolean; scope?: object; adapt?: (v: unknown) => unknown } = {},
) {
  const r = await viaRpc(rpc);
  const expected = "value" in r && opts.adapt ? { value: opts.adapt(r.value) } : r;
  const m = await viaMcp(name, args, opts.scope);
  // A read must return a value: two equal faults would otherwise pass as a match.
  valueOf(m, name);
  assert.deepEqual(m, json(expected), name);
  if (opts.dson) {
    const encoded = valueOf<{ dson: string }>(await viaMcp(name, { ...args, resultEncoding: "dson" }, opts.scope), name);
    assert.deepEqual(DSON.parse(encoded.dson), valueOf(r, name), name + " as dson");
  }
  return r;
}
/** The same write on twin subjects: MCP's twin gets `mcpArgs`, RPC's twin `rpc`. Returns both values. `expect`, when
 * given, states both outcomes, for a result that names its own subject. */
async function write(
  name: string,
  mcpArgs: Record<string, unknown>,
  rpc: () => Promise<unknown>,
  opts: { scope?: object; expect?: [unknown, unknown] } = {},
) {
  const m = await viaMcp(name, mcpArgs, opts.scope);
  const r = json(await viaRpc(rpc));
  if (opts.expect) assert.deepEqual([m, r], opts.expect.map((value) => ({ value })), name);
  else assert.deepEqual(mask(m), mask(r), name);
  return [valueOf<Record<string, unknown>>(m, name), valueOf<Record<string, unknown>>(r, name)] as const;
}

try {
  const names = (await agent.listTools()).tools.map((t) => t.name).sort();
  // Cache: twins m and r.
  await write("cache.set", { key: "m", value: { n: 1, tags: ["a"] } }, () => cache.set("r", { n: 1, tags: ["a"] }));
  for (const key of ["m", "r"]) {
    await read("cache.get", { key }, () => cache.get(key), { dson: true });
    await read("cache.getVersioned", { key }, () => cache.getVersioned(key), { dson: true });
  }
  await write("cache.delete", { key: "m" }, () => cache.delete("r"));
  await read("cache.get", { key: "m" }, () => cache.get("m"));
  // Database: the insert returns each twin's own ID.
  await write("db.insert", { document: { id: "m", n: 1 } }, () => db.insert({ id: "r", n: 1 }), { expect: ["m", "r"] });
  for (const id of ["m", "r"]) {
    await read("db.get", { id }, () => db.get(id), { dson: true });
    await read("db.getVersioned", { id }, () => db.getVersioned(id), { dson: true });
  }
  const request = { filters: [{ field: "n", op: "eq", value: 1 }], sorters: [{ field: "id", direction: "asc" }] } as const;
  await read("db.query", { request }, () => db.query(request), { dson: true });
  await write("db.update", { id: "m", patch: { n: 2 } }, () => db.update("r", { n: 2 }));
  const all = { sorters: [{ field: "id", direction: "asc" }] } as const;
  await read("db.query", { request: all }, () => db.query(all));
  await write("db.delete", { id: "m" }, () => db.delete("r"));
  await read("db.get", { id: "r" }, () => db.get("r"));
  // Files: the tool carries text as utf8 or base64, RPC carries bytes.
  await write("vfs.put", { key: "m.txt", data: "héllo" }, () => vfs.put("r.txt", "héllo"));
  const text = (encoding: "utf8" | "base64") => (v: unknown) => {
    const read = v as { found: boolean; value?: Uint8Array };
    if (!read.found) return read;
    return { ...read, value: Buffer.from(read.value as Uint8Array).toString(encoding), encoding };
  };
  for (const key of ["m.txt", "r.txt"]) {
    await read("vfs.get", { key }, () => vfs.get(key), { adapt: text("utf8") });
    await read("vfs.get", { key, encoding: "base64", range: { offset: 1, length: 3 } }, () => vfs.get(key, { offset: 1, length: 3 }), { adapt: text("base64") });
    await read("vfs.head", { key }, () => vfs.head(key));
  }
  await read("vfs.list", { request: { prefix: "" } }, () => vfs.list({ prefix: "" }));
  await write("vfs.delete", { key: "m.txt" }, () => vfs.delete("r.txt"));
  await read("vfs.get", { key: "m.txt" }, () => vfs.get("m.txt"), { adapt: text("utf8") });
  // Logs: the tenant's log of the app; JSON carries timestamps as ISO strings.
  await write("logs.write", { entries: [{ level: "info", message: "twin" }] }, () => tenant.logs().write([{ level: "info", message: "twin" }]), {
    scope: logScope,
  });
  await read("logs.read", { request: { limit: 100 } }, () => tenant.logs().read({ limit: 100 }), { scope: logScope, dson: true });
  // Scheduler: a yearly cron, so no planner tick changes a schedule between two reads.
  const definition = (id: string) => ({ id, handler: "noop", cron: "0 0 1 1 *" });
  let [m, r] = await write("scheduler.create", { definition: definition("m"), options: { requestId: "c-m" } }, () =>
    queue.create(definition("r"), { requestId: "c-r" }),
  );
  for (const id of ["m", "r"]) await read("scheduler.get", { id }, () => queue.get(id));
  await read("scheduler.list", {}, () => queue.list());
  for (const [step, patch] of [["update", { payload: 7 }], ["pause"], ["resume"]] as const) {
    const change = (twin: Record<string, unknown>, id: string) => ({ revision: twin.revision as string, requestId: step + "-" + id });
    const mArgs = { id: "m", ...(patch ? { patch } : {}), change: change(m, "m") };
    [m, r] = await write("scheduler." + step, mArgs, () =>
      step === "update" ? queue.update("r", patch, change(r, "r")) : queue[step]("r", change(r, "r")),
    );
  }
  await read("scheduler.scheduleHistory", { id: "m" }, () => queue.scheduleHistory("m"));
  await write("scheduler.remove", { id: "m", change: { revision: m.revision, requestId: "x-m" } }, () =>
    queue.remove("r", { revision: r.revision as string, requestId: "x-r" }),
  );
  await read("scheduler.get", { id: "m" }, () => queue.get("m"));
  await write("scheduler.create", { definition: definition("m2"), options: { requestId: "c-m2" } }, () =>
    queue.create(definition("r2"), { requestId: "c-r2" }),
  );
  await write("scheduler.terminate", { target: { schedule: "m2" }, options: { cause: "twin" } }, () =>
    queue.terminate({ schedule: "r2" }, { cause: "twin" }),
  );
  await read("scheduler.listRuns", {}, () => queue.listRuns());
  await read("scheduler.getRun", { id: "none" }, () => queue.getRun("none"));
  await read("scheduler.runHistory", { id: "none" }, () => queue.runHistory("none"));
  // Every tool the server lists ran through both transports.
  assert.deepEqual([...called].sort(), names);
  process.stdout.write(JSON.stringify({ phase, equivalent: called.size }) + "\n");
} finally {
  await agent.close();
}
