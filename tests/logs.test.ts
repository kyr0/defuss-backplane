import { test, expect } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBatchSink, createLogger } from "defuss-logs/client";
import { openFileLogStore } from "defuss-logs/server";
import { BackplaneError, connectBackplane } from "../src/client.js";
import { OWN_APP } from "../src/logs.js";
import { checkedScope, component } from "../src/scope.js";
import { createServices } from "../src/services.js";
import { start } from "./daemon.js";

const fault = (promise: Promise<unknown>) =>
  promise.then(
    () => "OK",
    (e: unknown) => (e instanceof BackplaneError ? e.code + " " + e.status : String(e)),
  );
const id = (n: number) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");

test("an app's log and each tenant's log are separate stores, read in time order", async () => {
  const root = await mkdtemp(join(tmpdir(), "backplane-logs-"));
  const service = createServices(root);
  const { logs } = service.api;
  try {
    const at = new Date("2026-11-24T12:00:00Z");
    await logs.write({ app: "shop" }, [
      { level: "info", message: "deploy", ts: at },
      { level: "warn", message: "slow start", ts: new Date(at.getTime() + 1000), args: [new Date(0), 5n, new Map([["a", 1]])] },
      { level: "error", message: "crash", ts: new Date(at.getTime() + 2000), context: { pod: "web-1" } },
    ]);
    await logs.write({ app: "shop", tenant: "acme" }, [{ level: "info", message: "order placed" }]);
    await logs.write({ app: "shop", tenant: "globex" }, [{ level: "info", message: "refund" }]);

    const app = await logs.read({ app: "shop" });
    expect(app.records.map((r) => r.message)).toEqual(["deploy", "slow start", "crash"]);
    expect(app.nextAfter).toBeNull();
    // DSON keeps the argument types and the timestamp as a Date.
    expect(app.records[1].args).toEqual([new Date(0), 5n, new Map([["a", 1]])]);
    expect(app.records[0].ts).toEqual(at);
    expect(app.records[2].context).toEqual({ pod: "web-1" });
    expect((await logs.read({ app: "shop", tenant: "acme" })).records.map((r) => r.message)).toEqual(["order placed"]);
    expect((await logs.read({ app: "shop", tenant: "globex" })).records.map((r) => r.message)).toEqual(["refund"]);

    const problems = await logs.read({ app: "shop" }, { levels: ["warn", "error"] });
    expect(problems.records.map((r) => r.level)).toEqual(["warn", "error"]);
    const window = await logs.read({ app: "shop" }, { from: new Date(at.getTime() + 1000), before: new Date(at.getTime() + 2000) });
    expect(window.records.map((r) => r.message)).toEqual(["slow start"]);

    // Five records in one millisecond: pages of two neither repeat nor skip one.
    const same = new Date("2026-11-25T00:00:00Z");
    await logs.write({ app: "batch" }, [5, 3, 1, 4, 2].map((n) => ({ level: "info" as const, message: "n" + n, ts: same, id: id(n) })));
    const seen: string[] = [];
    let after: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof logs.read>> = await logs.read({ app: "batch" }, { limit: 2, after });
      seen.push(...page.records.map((r) => r.message));
      after = page.nextAfter;
    } while (after);
    expect(seen).toEqual(["n1", "n2", "n3", "n4", "n5"]);

    // Reading a log that was never written creates nothing.
    expect(await logs.read({ app: "nobody", tenant: "acme" })).toEqual({ records: [], nextAfter: null });
    expect((await readdir(root)).sort()).toEqual([component("batch"), component("shop")].sort());
    expect((await readdir(join(root, component("shop")))).sort()).toEqual(
      [component("acme"), component("globex"), "logs"].sort(),
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("log writes reject invalid entries as a whole, and app names starting with _ are reserved", async () => {
  const root = await mkdtemp(join(tmpdir(), "backplane-logs-"));
  const service = createServices(root);
  const { logs, cache, db, vfs } = service.api;
  const scope = { app: "shop", tenant: "acme" };
  try {
    expect(await fault(logs.write(scope, [{ level: "loud" as "info", message: "x" }]))).toBe("INVALID_ARGUMENT 400");
    expect(await fault(logs.write(scope, [{ level: "info", message: "x", id: "nope" }]))).toBe("INVALID_ARGUMENT 400");
    expect(await fault(logs.write(scope, []))).toBe("INVALID_ARGUMENT 400");
    expect(await fault(logs.write({ ...scope, bucket: "b" } as never, [{ level: "info", message: "x" }]))).toBe(
      "INVALID_ARGUMENT 400",
    );
    expect(await fault(logs.read(scope, { limit: 0 }))).toBe("INVALID_ARGUMENT 400");
    expect(await fault(logs.read(scope, { after: "r/1" }))).toBe("INVALID_ARGUMENT 400");

    const ts = new Date("2026-11-24T12:00:00Z");
    await logs.write(scope, [{ level: "info", message: "first", ts, id: id(1) }]);
    // The second entry repeats a stored timestamp and ID, so the new first entry is not written either.
    expect(
      await fault(logs.write(scope, [{ level: "info", message: "new", id: id(2) }, { level: "info", message: "again", ts, id: id(1) }])),
    ).toBe("ALREADY_EXISTS 409");
    expect((await logs.read(scope)).records.map((r) => r.message)).toEqual(["first"]);

    const reserved = { app: OWN_APP, tenant: "acme", bucket: "b" };
    // Without the daemon's open log, as here, `_backplane` stays reserved for reads too.
    expect(await fault(logs.read({ app: OWN_APP }))).toBe("INVALID_ARGUMENT 400");
    expect(await fault(logs.write({ app: "_mine" }, [{ level: "info", message: "x" }]))).toBe("INVALID_ARGUMENT 400");
    expect(await fault(cache.set(reserved, "k", 1))).toBe("INVALID_ARGUMENT 400");
    expect(await fault(db.insert(reserved, { name: "x" }))).toBe("INVALID_ARGUMENT 400");
    expect(await fault(vfs.put(reserved, "k", "x"))).toBe("INVALID_ARGUMENT 400");
    expect(() => checkedScope(reserved)).toThrow("App names starting with _ are reserved");
    expect(await readdir(root)).toEqual([component("shop")]);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a defuss-logs logger in an application writes through the client, and MCP reads and writes the same logs", async () => {
  const { agent, stop } = await start();
  try {
    const client = await connectBackplane({ app: "shop" });
    const tenant = client.tenant("acme").logs();
    const logger = createLogger({ sink: createBatchSink(tenant), parallelSink: true, context: { service: "api" } });
    await logger.write("warn", "order %s failed", "A-1", { at: new Date(0), total: 12n });
    // 150 records of 4 KiB exceed the client's 256 KiB batch limit, so each round needs several RPC calls. A round
    // stays under the logger's own budget of 256 pending records.
    for (let round = 0; round < 2; round++)
      await Promise.all(Array.from({ length: 150 }, () => logger.write("info", "filler", "x".repeat(4096))));
    await logger.close();
    // DSON text spells binary at 3.6 times its encoded size, so five 100 KiB buffers must not share one call.
    const binary = createLogger({ sink: createBatchSink(client.tenant("acme").logs()), parallelSink: true });
    await Promise.all(Array.from({ length: 5 }, (_, i) => binary.write("debug", "dump", new Uint8Array(100 * 1024).map((_, j) => (j * 7 + i) & 255))));
    await binary.close();
    expect((await tenant.read({ levels: ["debug"] })).records.map((r) => (r.args[1] as Uint8Array)[0]).sort()).toEqual([0, 1, 2, 3, 4]);
    const page = await tenant.read({ limit: 1000, levels: ["info", "warn"] });
    expect(page.records).toHaveLength(301);
    expect(page.records[0]).toMatchObject({
      level: "warn",
      message: "order A-1 failed [Object]",
      args: ["order %s failed", "A-1", { at: new Date(0), total: 12n }],
      context: { service: "api" },
    });
    expect((await client.logs().read()).records).toEqual([]);

    type Tool = { isError?: boolean; structuredContent: Record<string, unknown> };
    const call = async (name: string, args: Record<string, unknown>) => (await agent.callTool({ name, arguments: args })) as Tool;
    expect((await call("logs.write", { scope: { app: "shop" }, entries: [{ level: "error", message: "disk full" }] })).structuredContent.value).toEqual({
      written: 1,
    });
    const errors = await call("logs.read", { scope: { app: "shop" }, request: { levels: ["error"] } });
    const records = (errors.structuredContent.value as { records: { message: string; ts: string }[] }).records;
    expect(records.map((r) => r.message)).toEqual(["disk full"]);
    expect(new Date(records[0].ts).toISOString()).toBe(records[0].ts);
    // The tenant log holds a Date and a bigint, which JSON cannot carry.
    const native = await call("logs.read", { scope: { app: "shop", tenant: "acme" }, request: { limit: 1 } });
    expect(native.structuredContent.code).toBe("DSON_REQUIRED");
    const dson = await call("logs.read", { scope: { app: "shop", tenant: "acme" }, request: { limit: 1 }, resultEncoding: "dson" });
    expect(dson.structuredContent).toHaveProperty("value.dson");
  } finally {
    await stop();
  }
});

test("callers read the _backplane log over RPC and MCP but cannot write it", async () => {
  const { daemon, agent, stop } = await start();
  try {
    daemon.log.warn("own line");
    const own = (await connectBackplane({ app: OWN_APP })).logs();
    // The daemon's logger commits in the background, so the line may need a moment.
    let page = await own.read();
    for (let i = 0; i < 50 && !page.records.length; i++) {
      await new Promise((done) => setTimeout(done, 20));
      page = await own.read();
    }
    expect(page.records.map((r) => [r.level, r.message])).toEqual([["warn", "own line"]]);
    type Tool = { structuredContent: { value?: { records: { message: string; ts: string }[] }; code?: string } };
    const call = async (name: string, args: Record<string, unknown>) => (await agent.callTool({ name, arguments: args })) as Tool;
    const viaMcp = await call("logs.read", { scope: { app: OWN_APP }, request: { levels: ["warn"] } });
    expect(viaMcp.structuredContent.value!.records.map((r) => r.message)).toEqual(["own line"]);

    expect(await fault(own.write([{ level: "error", message: "forged" }]))).toBe("INVALID_ARGUMENT 400");
    const forged = await call("logs.write", { scope: { app: OWN_APP }, entries: [{ level: "error", message: "forged" }] });
    expect(forged.structuredContent.code).toBe("INVALID_ARGUMENT");
    // The daemon's log has no tenant logs, and other names starting with _ stay reserved for reads too.
    expect(await fault((await connectBackplane({ app: OWN_APP })).tenant("acme").logs().read())).toBe("INVALID_ARGUMENT 400");
    expect(await fault((await connectBackplane({ app: "_mine" })).logs().read())).toBe("INVALID_ARGUMENT 400");
    expect((await own.read({ levels: ["error"] })).records).toEqual([]);
  } finally {
    await stop();
  }
});

test("the daemon writes its own lines into the _backplane app log", async () => {
  const root = await mkdtemp(join(tmpdir(), "backplane-own-"));
  try {
    const { daemon, stop } = await start({ BACKPLANE_DATA_DIR: root });
    daemon.log.warn("own line");
    await stop();
    const own = await openFileLogStore(join(root, OWN_APP, "logs"), "log");
    try {
      const records = [];
      for await (const record of own.records()) records.push(record);
      // Records of one millisecond are ordered by their random IDs, not by write order.
      expect(records.map((r) => r.level + " " + r.message).sort()).toEqual(["info stopping", "warn own line"]);
    } finally {
      await own.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a message with line breaks stays one line on the console", () => {
  const child = Bun.spawnSync([
    process.execPath,
    "-e",
    'import { print } from "./src/log.ts"; print("warn", "HTTP 503 a\\r\\n2026-01-01T00:00:00.000Z INFO forged");',
  ]);
  expect(child.stderr.toString()).toMatch(/^\S+Z WARN HTTP 503 a\\r\\n2026-01-01T00:00:00\.000Z INFO forged\n$/);
});
