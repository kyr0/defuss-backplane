import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "defuss-db";
import { openDbsonl } from "defuss-dbsonl";
import { createFileBackend } from "defuss-dbsonl/server";
import { component } from "../src/scope.js";
import { createServices } from "../src/services.js";

const scope = { app: "shop", tenant: "acme", bucket: "orders" };
test("cold misses and failed compare-and-set leave the filesystem empty; broken stores report errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "bp-misses-"));
  const service = createServices(root);
  try {
    const { cache, db } = service.api;
    for (const group of [scope, { ...scope, tenant: "new" }]) {
      expect((await cache.get(group, "k")).hit).toBe(false);
      expect(await cache.delete(group, "k")).toBe(true);
      expect(await db.get(group, "k")).toBeNull();
      expect(await db.query(group)).toEqual({ rows: [] });
      expect(await db.update(group, "k", {})).toBe(false);
      expect(await db.delete(group, "k")).toBe(false);
      for (const get of [cache.getVersioned, db.getVersioned])
        expect(await get(group, "k")).toEqual({ found: false, revision: null });
      await expect(
        cache.set(group, "k", 1, { ifRevision: "stale" }),
      ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      await expect(
        db.delete(group, "k", { ifRevision: "stale" }),
      ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    }
    expect(await readdir(root)).toEqual([]);
    const parent = join(root, component(scope.app), component(scope.tenant));
    for (const [dir, file] of [
      [join(parent, "cache", component(scope.bucket)), "entries.head"],
      [join(parent, "db", "main"), "default.head"],
    ]) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, file), "truncated");
    }
    await expect(cache.get(scope, "k")).rejects.toMatchObject({
      code: "STORAGE_ERROR",
    });
    await expect(db.get(scope, "k")).rejects.toMatchObject({
      code: "STORAGE_ERROR",
    });
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("v0.1 rows acquire stable revisions on read; updates, deletes and reinsertion invalidate old tokens", async () => {
  const root = await mkdtemp(join(tmpdir(), "bp-upgrade-"));
  const parent = join(root, component(scope.app), component(scope.tenant));
  const bucket = component(scope.bucket);
  const cp = join(parent, "cache", bucket),
    dp = join(parent, "db", "main");
  await mkdir(cp, { recursive: true });
  await mkdir(dp, { recursive: true });
  const rawCache = await openDbsonl(await createFileBackend(cp), "entries", {
    create: true,
  });
  const rawDb = await openDatabase(await createFileBackend(dp));
  try {
    await rawCache.put("k", { value: "v1", expires: null });
    await rawDb.collection(bucket).insert({ id: "k" });
  } finally {
    await rawCache.close();
    await rawDb.close();
  }
  let service = createServices(root);
  try {
    const oldCache = (await service.api.cache.getVersioned(scope, "k"))
      .revision!;
    const oldDb = (await service.api.db.getVersioned(scope, "k")).revision!;
    await service.close();
    service = createServices(root);
    const { cache, db } = service.api;
    expect((await cache.getVersioned(scope, "k")).revision).toBe(oldCache);
    expect((await db.getVersioned(scope, "k")).revision).toBe(oldDb);
    await cache.set(scope, "k", "v2", { ifRevision: oldCache });
    await db.update(scope, "k", { value: "v2" }, { ifRevision: oldDb });
    await expect(
      cache.delete(scope, "k", { ifRevision: oldCache }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(
      db.delete(scope, "k", { ifRevision: oldDb }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    const c = (await cache.getVersioned(scope, "k")).revision!;
    const d = (await db.getVersioned(scope, "k")).revision!;
    await cache.set(scope, "other", 1);
    await db.insert(scope, { id: "other" });
    await cache.delete(scope, "k", { ifRevision: c });
    await db.delete(scope, "k", { ifRevision: d });
    await cache.set(scope, "k", "v2", { ifRevision: null });
    await db.insert(scope, { id: "k", value: "v2" }, { ifRevision: null });
    await expect(
      db.insert(scope, { id: "k" }, { ifRevision: null }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(
      cache.delete(scope, "k", { ifRevision: c }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(
      db.delete(scope, "k", { ifRevision: d }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await cache.set(scope, "expires", 0, 0);
    expect((await cache.getVersioned(scope, "expires")).revision).toBeNull();
    await cache.set(scope, "expires", 1, { ifRevision: null });
    expect((await cache.getVersioned(scope, "expires")).revision).toBeString();
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
