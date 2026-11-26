/** VERIFIED: run through RPC and MCP by scripts/deep/run.ts. Files through `/rpc` and the MCP tools as the README
 * documents them: text and binary objects, ranges, head, list pages in bytewise key order, conditional writes and
 * deletes, the key rules including an object that is also a directory, and the 1 MiB limits. */
import { assert, type Ctx, rejects } from "./kit.ts";

const text = (bytes: unknown) => new TextDecoder().decode(bytes as Uint8Array);

export async function vfsScenario({ ops, rpc, bucket, step }: Ctx) {
  const vfs = ops.vfs(bucket);
  const bytes = new Uint8Array(256).map((_, i) => i);
  await step("put returns key, size, revision and mtime; get returns the bytes", async () => {
    const meta = await vfs.put("notes/a.txt", "héllo");
    assert.deepEqual([meta.key, meta.size, typeof meta.revision, typeof meta.mtimeMs], ["notes/a.txt", 6, "string", "number"]);
    const read = await vfs.get("notes/a.txt");
    assert.deepEqual([read.found, text(read.value), read.revision], [true, "héllo", meta.revision]);
    await vfs.put("bin/all.bin", bytes);
    assert.deepEqual((await vfs.get("bin/all.bin")).value, bytes);
    assert.deepEqual(await vfs.get("absent"), { found: false, revision: null });
  });
  await step("a range reads part of an object; head reads only the metadata", async () => {
    assert.deepEqual((await vfs.get("bin/all.bin", { offset: 10, length: 3 })).value, new Uint8Array([10, 11, 12]));
    assert.deepEqual((await vfs.get("bin/all.bin", { offset: 250 })).value, new Uint8Array([250, 251, 252, 253, 254, 255]));
    const head = await vfs.head("bin/all.bin");
    assert.deepEqual([head.found, head.size, "value" in head], [true, 256, false]);
  });
  await step("list pages by prefix in bytewise key order", async () => {
    for (const key of ["list/b", "list/a", "list/B", "list/é", "list/c"]) await vfs.put(key, key);
    const keys: string[] = [];
    let after: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page = await vfs.list({ prefix: "list/", limit: 2, ...(after ? { after } : {}) });
      keys.push(...page.objects.map((o) => o.key as string));
      after = page.nextAfter;
      if (!after) break;
    }
    assert.deepEqual(keys, ["list/B", "list/a", "list/b", "list/c", "list/é"]);
    assert.equal((await vfs.list({ prefix: "list/" })).objects.length, 5);
  });
  await step("writes and deletes honor ifRevision", async () => {
    const meta = await vfs.put("cond.txt", "1", { ifRevision: null });
    await rejects(vfs.put("cond.txt", "2", { ifRevision: null }), "REVISION_CONFLICT", 409);
    const next = await vfs.put("cond.txt", "2", { ifRevision: meta.revision as string });
    assert.notEqual(next.revision, meta.revision);
    await rejects(vfs.put("cond.txt", "3", { ifRevision: meta.revision as string }), "REVISION_CONFLICT", 409);
    await rejects(vfs.delete("cond.txt", { ifRevision: meta.revision as string }), "REVISION_CONFLICT", 409);
    assert.equal(await vfs.delete("cond.txt", { ifRevision: next.revision as string }), true);
    assert.equal(await vfs.delete("cond.txt"), false);
  });
  await step("keys with empty, . or .. segments are invalid, and a directory cannot hold an object", async () => {
    for (const key of ["../x", "a//b", "./x", "a/../b", "/abs"]) await rejects(vfs.put(key, "x"), "INVALID_ARGUMENT", 400);
    await vfs.put("dir/inside", "x");
    await rejects(vfs.put("dir", "x"), "INVALID_ARGUMENT", 400);
    assert.equal((await vfs.get("dir")).found, false);
  });
  await step("an object over 1 MiB needs a range; a write over 1 MiB needs the stream route", async () => {
    await rejects(vfs.put("over.bin", new Uint8Array(1048576 + 1024)), "PAYLOAD_TOO_LARGE", 413);
    const big = new Uint8Array(1048576 + 7);
    big[big.length - 1] = 42;
    const handle = (rpc.vfs(bucket) as unknown as { upload(k: string, b: Uint8Array): Promise<unknown> });
    await handle.upload("two.bin", big);
    await rejects(vfs.get("two.bin"), "PAYLOAD_TOO_LARGE", 413);
    assert.deepEqual((await vfs.get("two.bin", { offset: big.length - 2, length: 2 })).value, new Uint8Array([0, 42]));
  });
  await step("cleanup deletes every object", async () => {
    let after: string | null = null;
    do {
      const page = await vfs.list({ limit: 1000, ...(after ? { after } : {}) });
      for (const o of page.objects) assert.equal(await vfs.delete(o.key as string), true);
      after = page.nextAfter;
    } while (after);
    assert.deepEqual((await vfs.list()).objects, []);
  });
}
