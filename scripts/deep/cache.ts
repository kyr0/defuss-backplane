/** VERIFIED: run through RPC and MCP by scripts/deep/run.ts. The cache as the README documents it: hits and misses,
 * versioned reads, TTL expiry and its reset, conditional writes and deletes, native values, and invalid keys. */
import { assert, type Ctx, rejects, sleep } from "./kit.ts";

export async function cacheScenario({ ops, rpc, bucket, step }: Ctx) {
  const cache = ops.cache(bucket);
  await step("a set value is a hit, a missing key a miss, null a hit holding null", async () => {
    assert.equal(await cache.set("plain", { n: 1, tags: ["a"] }), true);
    assert.deepEqual(await cache.get("plain"), { hit: true, value: { n: 1, tags: ["a"] } });
    assert.deepEqual(await cache.get("absent"), { hit: false });
    await cache.set("null", null);
    assert.deepEqual(await cache.get("null"), { hit: true, value: null });
  });
  await step("getVersioned returns a revision, and a miss has none", async () => {
    const v = await cache.getVersioned("plain");
    assert.equal(v.found, true);
    assert.equal(typeof v.revision, "string");
    assert.deepEqual(await cache.getVersioned("absent"), { found: false, revision: null });
  });
  await step("a write with the current revision applies; a stale one conflicts", async () => {
    const v = await cache.getVersioned("plain");
    assert.equal(await cache.set("plain", 2, { ifRevision: v.revision as string }), true);
    await rejects(cache.set("plain", 3, { ifRevision: v.revision as string }), "REVISION_CONFLICT", 409);
    assert.deepEqual(await cache.get("plain"), { hit: true, value: 2 });
  });
  await step("ifRevision null requires absence", async () => {
    assert.equal(await cache.set("once", 1, { ifRevision: null }), true);
    await rejects(cache.set("once", 2, { ifRevision: null }), "REVISION_CONFLICT", 409);
  });
  await step("a TTL expires the key, and an expired key counts as absent", async () => {
    await cache.set("ttl", "x", { ttlMs: 300 });
    assert.deepEqual(await cache.get("ttl"), { hit: true, value: "x" });
    await sleep(450);
    assert.deepEqual(await cache.get("ttl"), { hit: false });
    assert.equal(await cache.set("ttl", "y", { ifRevision: null }), true);
  });
  await step("TTL 0 expires at once; a set without TTL clears an earlier expiry", async () => {
    await cache.set("zero", 1, { ttlMs: 0 });
    assert.deepEqual(await cache.get("zero"), { hit: false });
    await cache.set("cleared", "a", { ttlMs: 300 });
    await cache.set("cleared", "b");
    await sleep(450);
    assert.deepEqual(await cache.get("cleared"), { hit: true, value: "b" });
  });
  await step("delete succeeds for absent keys and honors ifRevision", async () => {
    assert.equal(await cache.delete("absent"), true);
    await cache.set("del", 1);
    const v = await cache.getVersioned("del");
    await rejects(cache.delete("del", { ifRevision: "0-stale" }), "REVISION_CONFLICT", 409);
    assert.equal(await cache.delete("del", { ifRevision: v.revision as string }), true);
    assert.deepEqual(await cache.get("del"), { hit: false });
  });
  await step("native values written over RPC read back exactly", async () => {
    const value = { at: new Date("2026-11-26T08:00:00.000Z"), bytes: new Uint8Array([0, 1, 255]), big: 2n ** 70n, map: new Map([["k", 1]]) };
    await rpc.cache(bucket).set("native", value);
    assert.deepEqual(await cache.get("native"), { hit: true, value });
  });
  await step("an empty key and a key over 1,024 bytes are invalid", async () => {
    await rejects(cache.get(""), "INVALID_ARGUMENT", 400);
    await rejects(cache.set("k".repeat(1025), 1), "INVALID_ARGUMENT", 400);
  });
  await step("cleanup deletes every key", async () => {
    for (const key of ["plain", "null", "once", "ttl", "cleared", "native"]) assert.equal(await cache.delete(key), true);
  });
}
