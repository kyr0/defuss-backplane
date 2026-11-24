import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServices } from "../src/services.js";
import { component } from "../src/scope.js";
const scope = { app: "shop", tenant: "acme", bucket: "catalog" };

test("cache and documents survive a reopen in distinct scopes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "backplane-"));
  let service = createServices(dir);
  try {
    await service.api.cache.set(scope, "currency", null);
    await service.api.db.insert(scope, { id: "currency", name: "EUR" });
    await service.close();
    service = createServices(dir);
    expect(await service.api.cache.get(scope, "currency")).toEqual({
      hit: true,
      value: null,
    });
    expect(await service.api.db.get(scope, "currency")).toEqual({
      id: "currency",
      name: "EUR",
    });
    expect(
      await service.api.cache.get({ ...scope, tenant: "other" }, "currency"),
    ).toEqual({ hit: false });
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("expiry, concurrent namespace selection, generated IDs and page bounds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "backplane-"));
  const service = createServices(dir);
  try {
    const { cache, db } = service.api;
    for (const ttl of [-1, 0.5, Number.MAX_SAFE_INTEGER]) {
      await expect(cache.set(scope, "x", null, ttl)).rejects.toThrow();
    }
    await cache.set(scope, "x", "past", 0);
    expect(await cache.get(scope, "x")).toEqual({ hit: false });
    await cache.set(scope, "x", "current");
    expect(await cache.get(scope, "x")).toEqual({
      hit: true,
      value: "current",
    });
    const scopes = [
      scope,
      { ...scope, app: "../shop" },
      { ...scope, tenant: "../acme" },
      { ...scope, bucket: "../catalog" },
    ];
    await Promise.all(
      scopes.map(async (s, i) => {
        await cache.set(s, "same", i);
        await db.insert(s, { id: "same", i });
      }),
    );
    for (const [i, s] of scopes.entries()) {
      expect(await cache.get(s, "same")).toEqual({ hit: true, value: i });
      expect(await db.get(s, "same")).toEqual({ id: "same", i });
    }
    const generated = await db.insert(scope, { name: "auto" });
    expect((await db.get(scope, generated))?.name).toBe("auto");
    await expect(
      db.update(scope, generated, { id: "change" }),
    ).rejects.toThrow();
    await expect(db.query(scope, { limit: 1001 })).rejects.toThrow();
    await expect(cache.get({ ...scope, app: "" }, "same")).rejects.toThrow();
    await expect(
      cache.get({ ...scope, tenant: "\ud800" }, "same"),
    ).rejects.toThrow();
    expect(await db.update(scope, "absent", { x: 1 })).toBe(false);
    expect(await db.delete(scope, "absent")).toBe(false);
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("expired reads leave the persisted entry unchanged and concurrent replacements survive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "backplane-expiry-"));
  const store = createServices(dir);
  try {
    await store.api.cache.set(scope, "old", "expire", 0);
    expect(await store.api.cache.get(scope, "old")).toEqual({ hit: false });
    await Promise.all([
      store.api.cache.get(scope, "old"),
      store.api.cache.set(scope, "old", "replacement"),
    ]);
    expect(await store.api.cache.get(scope, "old")).toEqual({
      hit: true,
      value: "replacement",
    });
    await store.api.cache.set(scope, "obsolete", "discard", 0);
    await store.api.cache.get(scope, "obsolete");
    await store.close();
    const { openDbsonl } = await import("defuss-dbsonl");
    const { createFileBackend } = await import("defuss-dbsonl/server");
    const raw = await openDbsonl(
      await createFileBackend(
        join(
          dir,
          component(scope.app),
          component(scope.tenant),
          "cache",
          component(scope.bucket),
        ),
      ),
      "entries",
    );
    try {
      expect((await raw.get("obsolete")).found).toBe(true);
    } finally {
      await raw.close();
    }
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("query sorting and projection apply to the tenant's page", async () => {
  const dir = await mkdtemp(join(tmpdir(), "backplane-query-"));
  const service = createServices(dir);
  try {
    const { db } = service.api;
    for (const score of [1, 4, 2, 3])
      await db.insert(scope, { id: score, score, group: "A" });
    await db.insert(
      { ...scope, tenant: "other" },
      { id: 99, score: 99, group: "A" },
    );
    expect(
      await db.query(scope, {
        filters: [{ field: "group", op: "eq", value: "A" }],
        sorters: [{ field: "score", direction: "desc" }],
        offset: 1,
        limit: 2,
        projection: ["score"],
      }),
    ).toEqual({ rows: [{ score: 3 }, { score: 2 }] });
    expect(await db.query(scope, { limit: 0 })).toEqual({ rows: [] });
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("scope encoding preserves maximum-length and distinct Unicode names", async () => {
  const dir = await mkdtemp(join(tmpdir(), "backplane-ids-"));
  const service = createServices(dir);
  try {
    const both = {
      app: "a".repeat(48),
      tenant: "Ä".repeat(24),
      bucket: "b".repeat(48),
    };
    await service.api.db.insert(both, { id: "full" });
    expect(await service.api.db.get(both, "full")).toEqual({ id: "full" });
    const sibling = { ...both, bucket: both.bucket.slice(0, -1) + "c" };
    expect(await service.api.db.get(sibling, "full")).toBeNull();
    await service.api.db.insert(sibling, { id: "full", sibling: true });
    expect(await service.api.db.get(both, "full")).toEqual({ id: "full" });
    await service.api.cache.set(both, "ü".repeat(512), 1);
    expect(await service.api.cache.get(both, "ü".repeat(512))).toEqual({
      hit: true,
      value: 1,
    });
    await expect(
      service.api.cache.set(both, "ü".repeat(513), 1),
    ).rejects.toThrow();
    const decomposed = { ...both, tenant: "A\u0308" };
    await service.api.cache.set(decomposed, "key", 0);
    expect(
      await service.api.cache.get({ ...both, tenant: "Ä" }, "key"),
    ).toEqual({ hit: false });
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});

const sha = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 8);

test("a scope name becomes its slug and a hash of its exact bytes", () => {
  const cases: [string, string][] = [
    ["shop", "shop"],
    ["Shop", "shop"],
    ["Acme GmbH", "acme-gmbh"],
    ["Müller & Co", "müller-co"],
    ["Café", "café"],
    ["Café", "café"],
    ["商店", "商店"],
    ["123", "123"],
    ["_backplane", "backplane"],
    ["!!!", "x"],
    ["́a", "a"],
  ];
  for (const [name, slug] of cases) expect(component(name)).toBe(slug + "-" + sha(name));
  // The hash keeps names apart that share a slug.
  expect(new Set(["Shop", "shop", "SHOP", "Café", "Café"].map(component)).size).toBe(5);
  // VERIFIED from the defuss-db 3.3.0 source: collection names match this pattern with at most 64 code units.
  const valid = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*-[0-9a-f]{8}$/u;
  for (const name of ["a".repeat(48), "Ä".repeat(24), "😀".repeat(12), "1" + "b".repeat(47), "x y z ".repeat(8)]) {
    const encoded = component(name);
    expect(encoded).toMatch(valid);
    expect(encoded.length).toBeLessThanOrEqual(57);
    expect(encoded.includes("_")).toBe(false);
  }
});

test("names that differ only in case or punctuation keep separate data in every engine", async () => {
  const dir = await mkdtemp(join(tmpdir(), "backplane-names-"));
  const service = createServices(dir);
  const { cache, db, vfs } = service.api;
  try {
    const at = (tenant: string, bucket = "data") => ({ app: "shop", tenant, bucket });
    await cache.set(at("Acme"), "k", 1);
    await db.insert(at("Acme"), { id: "k" });
    await vfs.put(at("Acme"), "k", "x");
    // A development Mac runs this on case-insensitive APFS.
    for (const other of ["acme", "acme!"]) {
      expect(await cache.get(at(other), "k")).toEqual({ hit: false });
      expect(await db.get(at(other), "k")).toBeNull();
      expect((await vfs.head(at(other), "k")).found).toBe(false);
    }
    // defuss-db rejects an invalid collection name, so these buckets prove the encoded names valid.
    for (const bucket of ["商店", "123", "Ä".repeat(24)]) {
      await db.insert(at("acme", bucket), { id: bucket });
      expect(await db.get(at("acme", bucket), bucket)).toEqual({ id: bucket });
    }
  } finally {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  }
});
