/** VERIFIED: run through RPC and MCP by scripts/deep/run.ts. Documents as the README documents them: generated,
 * string, numeric and bigint IDs, versioned reads, conditional updates and deletes, an update of an absent row, native
 * values, and every query feature: each filter operator, several sorters, offset, limit and its maximum, projection. */
import { assert, type Ctx, rejects } from "./kit.ts";

export async function dbScenario({ ops, rpc, bucket, step }: Ctx) {
  const db = ops.db(bucket);
  await step("insert generates an ID, or keeps a string, numeric or bigint one", async () => {
    const generated = await db.insert({ item: "A7" });
    assert.equal(typeof generated, "string");
    assert.deepEqual(await db.get(generated), { id: generated, item: "A7" });
    assert.equal(await db.insert({ id: "fixed", n: 1 }), "fixed");
    assert.equal(await db.insert({ id: 7, n: 2 }), 7);
    const big = 2n ** 63n + 1n;
    assert.equal(await db.insert({ id: big, n: 3 }), big);
    assert.deepEqual(await db.get(big), { id: big, n: 3 });
    assert.equal((await db.getVersioned(big)).found, true);
    assert.equal(await db.update(big, { n: 4 }), true);
    assert.deepEqual(await db.get(big), { id: big, n: 4 });
    assert.deepEqual(await db.get(7), { id: 7, n: 2 });
    assert.equal(await db.get("absent"), null);
  });
  await step("an insert with an ID in use fails; ifRevision null is accepted", async () => {
    await rejects(db.insert({ id: "fixed", n: 9 }), "ALREADY_EXISTS", 409);
    assert.equal(await db.insert({ id: "cond", n: 0 }, { ifRevision: null }), "cond");
  });
  await step("updates patch fields, honor ifRevision and report an absent row", async () => {
    const v = await db.getVersioned("fixed");
    assert.equal(v.found, true);
    assert.equal(await db.update("fixed", { n: 2, extra: true }, { ifRevision: v.revision as string }), true);
    await rejects(db.update("fixed", { n: 3 }, { ifRevision: v.revision as string }), "REVISION_CONFLICT", 409);
    assert.deepEqual(await db.get("fixed"), { id: "fixed", n: 2, extra: true });
    assert.equal(await db.update("absent", { n: 1 }), false);
    assert.deepEqual(await db.getVersioned("absent"), { found: false, revision: null });
  });
  await step("deletes honor ifRevision and report whether a row went", async () => {
    await rejects(db.delete("cond", { ifRevision: "0-stale" }), "REVISION_CONFLICT", 409);
    const v = await db.getVersioned("cond");
    assert.equal(await db.delete("cond", { ifRevision: v.revision as string }), true);
    assert.equal(await db.delete("cond"), false);
  });
  await step("native values written over RPC read back exactly", async () => {
    const doc = { id: "native", at: new Date("2026-11-26T08:00:00.000Z"), bytes: new Uint8Array([9, 8]), big: 5n };
    await rpc.db(bucket).insert(doc);
    assert.deepEqual(await db.get("native"), doc);
  });
  const q = ops.db(bucket + "-q");
  await step("query: every filter operator", async () => {
    for (let i = 1; i <= 12; i++)
      await q.insert({ id: "q" + String(i).padStart(2, "0"), n: i, parity: i % 2 ? "odd" : "even", name: "item-" + i });
    const ids = async (filters: unknown[]) => (await q.query({ filters, sorters: [{ field: "n", direction: "asc" }] })).rows.map((r) => r.n);
    assert.deepEqual(await ids([{ field: "n", op: "eq", value: 3 }]), [3]);
    assert.deepEqual((await ids([{ field: "n", op: "neq", value: 3 }])).length, 11);
    assert.deepEqual(await ids([{ field: "n", op: "gt", value: 10 }]), [11, 12]);
    assert.deepEqual(await ids([{ field: "n", op: "gte", value: 11 }]), [11, 12]);
    assert.deepEqual(await ids([{ field: "n", op: "lt", value: 2 }]), [1]);
    assert.deepEqual(await ids([{ field: "n", op: "lte", value: 2 }]), [1, 2]);
    assert.deepEqual(await ids([{ field: "n", op: "in", value: [4, 6] }]), [4, 6]);
    assert.deepEqual(await ids([{ field: "name", op: "contains", value: "-1" }]), [1, 10, 11, 12]);
    assert.deepEqual(await ids([{ field: "name", op: "startsWith", value: "item-1" }]), [1, 10, 11, 12]);
    assert.deepEqual(await ids([{ field: "name", op: "endsWith", value: "2" }]), [2, 12]);
    assert.deepEqual(await ids([{ field: "parity", op: "eq", value: "odd" }, { field: "n", op: "gt", value: 8 }]), [9, 11]);
  });
  await step("query: several sorters, offset, limit, projection and the limits", async () => {
    const page = await q.query({
      sorters: [{ field: "parity", direction: "asc" }, { field: "n", direction: "desc" }],
      offset: 1,
      limit: 3,
      projection: ["id", "n"],
    });
    assert.deepEqual(page.rows, [{ id: "q10", n: 10 }, { id: "q08", n: 8 }, { id: "q06", n: 6 }]);
    assert.equal((await q.query()).rows.length, 12);
    assert.equal((await q.query({ limit: 1000 })).rows.length, 12);
    await rejects(q.query({ limit: 1001 }), "INVALID_ARGUMENT", 400);
  });
  await step("cleanup deletes every document", async () => {
    for (const row of (await db.query({ limit: 1000 })).rows) assert.equal(await db.delete(row.id), true);
    for (const row of (await q.query({ limit: 1000 })).rows) assert.equal(await q.delete(row.id), true);
    assert.deepEqual((await db.query()).rows, []);
  });
}
