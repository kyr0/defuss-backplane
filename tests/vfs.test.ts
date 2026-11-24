import { test, expect } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServices } from "../src/services.js";
import { component } from "../src/scope.js";

const scope = { app: "shop", tenant: "acme", bucket: "media" };
const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "OK",
    (error: { code?: string }) => error.code,
  );

test("objects round-trip with revisions, prefixes and pages in the tenant's vfs directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "backplane-vfs-"));
  const service = createServices(root);
  const vfs = service.api.vfs;
  try {
    const text = await vfs.put(scope, "docs/readme.txt", "héllo");
    expect(text).toMatchObject({ key: "docs/readme.txt", size: 6 });
    const bytes = Uint8Array.of(0, 255, 128);
    const binary = await vfs.put(scope, "docs/raw.bin", bytes);
    expect(await vfs.get(scope, "docs/raw.bin")).toEqual({
      found: true,
      value: bytes,
      ...binary,
    });
    expect(
      new TextDecoder().decode(
        ((await vfs.get(scope, "docs/readme.txt")) as { value: Uint8Array })
          .value,
      ),
    ).toBe("héllo");
    expect(
      await vfs.get(scope, "docs/raw.bin", { offset: 1, length: 1 }),
    ).toMatchObject({ found: true, value: Uint8Array.of(255), size: 3 });
    expect(await vfs.head(scope, "docs/raw.bin")).toEqual({
      found: true,
      ...binary,
    });
    await vfs.put(scope, "other.txt", "x");
    const first = await vfs.list(scope, { prefix: "docs/", limit: 1 });
    expect(first.objects.map((o) => o.key)).toEqual(["docs/raw.bin"]);
    expect(
      (await vfs.list(scope, { prefix: "docs/", after: first.nextAfter }))
        .objects,
    ).toEqual([text]);
    expect(await vfs.delete(scope, "other.txt")).toBe(true);
    expect(await vfs.delete(scope, "other.txt")).toBe(false);
    expect(await vfs.head(scope, "other.txt")).toEqual({
      found: false,
      revision: null,
    });
    const volume = join(
      root,
      component("shop"),
      component("acme"),
      "vfs",
      component("media"),
    );
    expect((await stat(volume)).isDirectory()).toBe(true);
    // The names read as words on disk.
    expect(await readdir(root)).toEqual([expect.stringMatching(/^shop-[0-9a-f]{8}$/)]);
    expect(await readdir(join(volume, ".."))).toEqual([expect.stringMatching(/^media-[0-9a-f]{8}$/)]);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("conditional writes compare revisions and absent volumes stay uncreated", async () => {
  const root = await mkdtemp(join(tmpdir(), "backplane-vfs-"));
  const service = createServices(root);
  const vfs = service.api.vfs;
  try {
    expect(await vfs.get(scope, "a.txt")).toEqual({
      found: false,
      revision: null,
    });
    expect(await vfs.list(scope)).toEqual({ objects: [], nextAfter: null });
    expect(await vfs.delete(scope, "a.txt")).toBe(false);
    expect(await code(vfs.put(scope, "a.txt", "x", { ifRevision: "t" }))).toBe(
      "REVISION_CONFLICT",
    );
    expect(await readdir(root)).toEqual([]);
    const created = await vfs.put(scope, "a.txt", "one", { ifRevision: null });
    expect(await code(vfs.put(scope, "a.txt", "two", { ifRevision: null }))).toBe(
      "REVISION_CONFLICT",
    );
    const replaced = await vfs.put(scope, "a.txt", "one", {
      ifRevision: created.revision,
    });
    expect(replaced.revision).not.toBe(created.revision);
    expect(
      await code(vfs.put(scope, "a.txt", "x", { ifRevision: created.revision })),
    ).toBe("REVISION_CONFLICT");
    expect(
      await code(vfs.delete(scope, "a.txt", { ifRevision: created.revision })),
    ).toBe("REVISION_CONFLICT");
    expect(await code(vfs.delete(scope, "a.txt", { ifRevision: null }))).toBe(
      "REVISION_CONFLICT",
    );
    expect(
      await vfs.delete(scope, "a.txt", { ifRevision: replaced.revision }),
    ).toBe(true);
    expect(await vfs.delete(scope, "a.txt", { ifRevision: null })).toBe(false);
    expect(await code(vfs.delete(scope, "a.txt", { ifRevision: "t" }))).toBe(
      "REVISION_CONFLICT",
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid keys, directory prefixes and oversized inline reads are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "backplane-vfs-"));
  const service = createServices(root);
  const vfs = service.api.vfs;
  try {
    for (const key of ["", "/a", "a//b", "a/./b", "../a", "a/", "a\0b"])
      expect(await code(vfs.get(scope, key))).toBe("INVALID_ARGUMENT");
    expect(await code(vfs.get(scope, "x".repeat(1025)))).toBe(
      "INVALID_ARGUMENT",
    );
    expect(await code(vfs.list(scope, { limit: 0 }))).toBe("INVALID_ARGUMENT");
    await vfs.put(scope, "dir/file", "x");
    expect(await code(vfs.put(scope, "dir", "x"))).toBe("INVALID_ARGUMENT");
    expect(await code(vfs.put(scope, "dir/file/child", "x"))).toBe(
      "INVALID_ARGUMENT",
    );
    expect(await vfs.get(scope, "dir")).toEqual({
      found: false,
      revision: null,
    });
    expect(await vfs.delete(scope, "dir")).toBe(false);
    const large = new Uint8Array(1024 * 1024 + 1).fill(7);
    await service.transfers.upload(scope, "large.bin", [large]);
    expect(await code(vfs.get(scope, "large.bin"))).toBe("PAYLOAD_TOO_LARGE");
    expect(
      await vfs.get(scope, "large.bin", { offset: 1024 * 1024, length: 10 }),
    ).toMatchObject({ found: true, value: Uint8Array.of(7), size: large.length });
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("an open download keeps its volume mounted while other buckets evict idle volumes", async () => {
  const root = await mkdtemp(join(tmpdir(), "backplane-vfs-"));
  const service = createServices(root);
  try {
    const data = new Uint8Array(1024 * 1024).fill(9);
    await service.transfers.upload(scope, "big.bin", [data, data]);
    const read = await service.transfers.download(scope, "big.bin");
    if (!read.found) throw new Error("Uploaded object missing");
    // The pool holds 32 volumes, so 32 more buckets would evict this one if the download did not lease it.
    for (let i = 0; i < 32; i++)
      await service.api.vfs.put({ ...scope, bucket: "b" + i }, "k", "v");
    const bytes = new Uint8Array(await new Response(read.stream).arrayBuffer());
    expect(bytes.length).toBe(2 * data.length);
    expect(bytes.every((b) => b === 9)).toBe(true);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

test("an upload that fails midway leaves the previous object and revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "backplane-vfs-"));
  const service = createServices(root);
  try {
    const before = await service.api.vfs.put(scope, "doc.bin", "original");
    async function* broken() {
      yield new Uint8Array(512 * 1024).fill(1);
      throw new Error("client went away");
    }
    expect(
      await code(service.transfers.upload(scope, "doc.bin", broken())),
    ).toBeUndefined();
    expect(await service.api.vfs.head(scope, "doc.bin")).toEqual({
      found: true,
      ...before,
    });
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a range read fails once a write replaces the object it started on", async () => {
  const root = await mkdtemp(join(tmpdir(), "backplane-vfs-"));
  const service = createServices(root);
  try {
    const bytes = new Uint8Array(600 * 1024).map((_, i) => i % 251);
    const first = await service.api.vfs.put(scope, "clip.bin", bytes);
    const reader = service.transfers
      .readRange(scope, "clip.bin", first.revision, 1000, 500 * 1024)
      .getReader();
    // Each pull reads one 256 KiB window, so the second read sees the replacement.
    expect((await reader.read()).value).toEqual(bytes.subarray(1000, 1000 + 256 * 1024));
    await service.api.vfs.put(scope, "clip.bin", bytes);
    expect(await code(reader.read())).toBe("REVISION_CONFLICT");
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
