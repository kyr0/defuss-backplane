/** VERIFIED: run through RPC and MCP by scripts/deep/run.ts. Logs as the README documents them: tenant and app logs
 * kept apart, time order, level and time filters, paging with `after`, the batch limits, native arguments, an explicit
 * `ts` and `id` and the ALREADY_EXISTS they can cause, the read-only `_backplane` log, and a defuss-logs batch sink.
 * Earlier runs leave records in the tenant's log, so every assertion selects this run's records by message or time. */
import { randomUUID } from "node:crypto";
import { createBatchSink, createLogger } from "defuss-logs/client";
import { assert, type Ctx, rejects, sleep } from "./kit.ts";

type LogRecord = { id: string; ts: Date; level: string; message: string; args?: unknown[]; context?: Record<string, unknown> };

export async function logsScenario({ ops, rpc, own, bucket: tag, step }: Ctx) {
  const log = ops.logs();
  const app = ops.logs(false);
  const mine = async (request: Record<string, unknown> = {}) =>
    ((await log.read({ limit: 1000, ...request })).records as LogRecord[]).filter((r) => r.message.startsWith(tag));
  let since = new Date();
  await step("written entries come back in time order with ts, id, level, args and context", async () => {
    since = new Date(Date.now() - 1);
    assert.deepEqual(await log.write([{ level: "info", message: tag + " a" }]), { written: 1 });
    await sleep(5);
    assert.deepEqual(await log.write([{ level: "warn", message: tag + " b", args: [1, "x"], context: { k: "v" } }]), { written: 1 });
    const records = await mine({ from: since });
    assert.deepEqual(records.map((r) => [r.level, r.message]), [["info", tag + " a"], ["warn", tag + " b"]]);
    assert.ok(records.every((r) => r.ts instanceof Date && typeof r.id === "string"));
    assert.deepEqual([records[1].args, records[1].context], [[1, "x"], { k: "v" }]);
  });
  await step("levels, from and before filter", async () => {
    const [a, b] = await mine({ from: since });
    assert.deepEqual((await mine({ from: since, levels: ["warn"] })).map((r) => r.message), [tag + " b"]);
    assert.deepEqual((await mine({ from: since, before: b.ts })).map((r) => r.message), [tag + " a"]);
    assert.deepEqual((await mine({ from: b.ts })).map((r) => r.message), [tag + " b"]);
    assert.ok(a.ts < b.ts);
  });
  await step("pages follow nextAfter until the end", async () => {
    const from = new Date(Date.now() - 1);
    await log.write(Array.from({ length: 5 }, (_, i) => ({ level: "debug", message: `${tag} page ${i}` })));
    const seen: string[] = [];
    let after: string | null | undefined;
    for (let i = 0; i < 10; i++) {
      const page = await log.read({ from, limit: 2, ...(after ? { after } : {}) });
      seen.push(...(page.records as LogRecord[]).map((r) => r.message));
      after = page.nextAfter;
      if (!after) break;
    }
    // One millisecond holds all five, and the README orders such records by ID: the pages must equal one read.
    const whole = ((await log.read({ from, limit: 1000 })).records as LogRecord[]).map((r) => r.message);
    assert.deepEqual(seen, whole);
    assert.deepEqual(seen.filter((m) => m.startsWith(tag)).sort(), [0, 1, 2, 3, 4].map((i) => `${tag} page ${i}`));
  });
  await step("a batch holds 1 to 1,000 entries, and a read at most 1,000", async () => {
    await rejects(log.write([]), "INVALID_ARGUMENT", 400);
    await rejects(log.write(Array.from({ length: 1001 }, () => ({ level: "info", message: tag + " x" }))), "INVALID_ARGUMENT", 400);
    await rejects(log.read({ limit: 1001 }), "INVALID_ARGUMENT", 400);
    await rejects(log.write([{ level: "loud", message: tag }]), "INVALID_ARGUMENT", 400);
  });
  await step("RPC writes an explicit ts and id and native args; a repeated ts and id fails the batch", async () => {
    const ts = new Date(Date.now() - 60_000);
    const entry = { level: "error", message: tag + " native", ts, id: randomUUID(), args: [new Date(0), 12n, new Uint8Array([1])] };
    await rpc.logs().write([entry]);
    await rejects(rpc.logs().write([entry]), "ALREADY_EXISTS", 409);
    const [stored] = await mine({ from: new Date(ts.getTime() - 1), before: new Date(ts.getTime() + 1) });
    assert.deepEqual([stored.id, stored.ts, stored.args], [entry.id, ts, entry.args]);
  });
  await step("the app's log and the tenant's log stay apart", async () => {
    await app.write([{ level: "info", message: tag + " app" }]);
    const appMessages = ((await app.read({ from: since, limit: 1000 })).records as LogRecord[]).map((r) => r.message);
    assert.ok(appMessages.includes(tag + " app"));
    assert.ok(!appMessages.includes(tag + " a"));
    assert.ok(!(await mine({ from: since })).some((r) => r.message === tag + " app"));
  });
  await step("anyone reads the daemon's _backplane log, nobody writes it", async () => {
    const records = (await own.logs(false).read({ limit: 1000 })).records as LogRecord[];
    assert.ok(records.some((r) => r.message.startsWith("listening ")));
    await rejects(own.logs(false).write([{ level: "error", message: "forged" }]), "INVALID_ARGUMENT", 400);
  });
  if (ops.via === "rpc")
    await step("a defuss-logs logger writes through the handle as a batch sink", async () => {
      const handle = rpc.logs() as unknown as Parameters<typeof createBatchSink>[0];
      const logger = createLogger({ sink: createBatchSink(handle), parallelSink: true, context: { service: "deep" } });
      logger.console.warn(tag + " via %s", "sink", { n: 1 });
      await logger.flush();
      const [r] = await mine({ from: since, levels: ["warn"] }).then((all) => all.filter((x) => x.message.includes("via")));
      assert.ok(r, "the sink's record arrived");
      assert.equal(r.context?.service, "deep");
    });
}
