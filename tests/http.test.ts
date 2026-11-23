import { test, expect } from "bun:test";
import { connectBackplane } from "../src/client.js";
import { randomBytes } from "node:crypto";
import { start } from "./daemon.js";

test("authenticated discovery, shared RPC/MCP calls and loopback HTTP policy", async () => {
  const { daemon, headers, agent, stop } = await start();
  try {
    for (const route of ["/rpc", "/rpc/schema", "/mcp", "/vfs/object"]) {
      const url = daemon.url + route;
      expect((await fetch(url, { method: "POST" })).status).toBe(401);
      expect(
        (
          await fetch(url, {
            method: "POST",
            headers: { ...headers, Origin: "http://example.org" },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(url, {
            method: "POST",
            headers: { ...headers, Host: "untrusted.example" },
          })
        ).status,
      ).toBe(403);
    }
    expect((await fetch(daemon.url + "/rpc", { headers })).status).toBe(405);
    expect((await fetch(daemon.url + "/rpc/upload", { headers })).status).toBe(
      404,
    );
    expect(
      (
        await fetch(daemon.url + "/rpc", {
          method: "POST",
          headers,
          body: "x".repeat(1048577),
        })
      ).status,
    ).toBe(413);
    const app = await connectBackplane({ app: "shop" });
    const tenant = app.tenant("acme");
    const tools = (await agent.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([
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
    const scope = { app: "shop", tenant: "acme", bucket: "catalog" };
    const call = (name: string, args: Record<string, unknown>) =>
      agent.callTool({ name, arguments: { scope, ...args } });
    await tenant.cache("catalog").set("k", null);
    expect((await call("cache.get", { key: "k" })).structuredContent).toEqual({
      value: { hit: true, value: null },
    });
    expect((await call("cache.set", { key: "missing-value" })).isError).toBe(
      true,
    );
    const docs = tenant.db("catalog");
    await docs.insert({ id: "item", rank: 2 });
    expect(
      (await call("db.update", { id: "item", patch: { rank: 3 } }))
        .structuredContent,
    ).toEqual({ value: true });
    expect(
      (
        await docs.query({
          filters: [{ field: "rank", op: "eq", value: 3 }],
          projection: ["id"],
        })
      ).rows,
    ).toEqual([{ id: "item" }]);
    await tenant.cache("catalog").set("date", new Date(0));
    expect((await call("cache.get", { key: "date" })).isError).toBe(true);
    expect(
      (await call("cache.get", { key: "date", resultEncoding: "dson" }))
        .structuredContent,
    ).toHaveProperty("value.dson");
    expect(await tenant.cache("catalog").get("date")).toEqual({
      hit: true,
      value: new Date(0),
    });
    const calls = [
      ["db.insert", { document: { id: "item" } }],
      ["db.query", { request: { limit: -1 } }],
      ["cache.get", { key: "date" }],
      ["cache.get", { key: "k" }],
    ] as const;
    const batch = await fetch(daemon.url + "/mcp", {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-03-26",
      },
      body: JSON.stringify(
        calls.map(([name, args], i) => ({
          jsonrpc: "2.0",
          id: i + 1,
          method: "tools/call",
          params: { name, arguments: { scope, ...args } },
        })),
      ),
    });
    const replies = await batch.json();
    expect(batch.status).toBe(200);
    const codes = Object.fromEntries(
      replies.map(
        (r: {
          id: number;
          result: { structuredContent: { code?: string } };
        }) => [r.id, r.result.structuredContent.code ?? "OK"],
      ),
    );
    expect(codes).toEqual({
      1: "ALREADY_EXISTS",
      2: "INVALID_ARGUMENT",
      3: "DSON_REQUIRED",
      4: "OK",
    });
    expect(await docs.delete("item")).toBe(true);
    expect(await docs.get("item")).toBeNull();
    expect(await tenant.cache("catalog").delete("k")).toBe(true);
  } finally {
    await stop();
  }
}, 30000);

test("VFS objects stream past the body limit and share revisions with RPC and MCP", async () => {
  const { daemon, headers, agent, stop } = await start();
  const scope = { app: "shop", tenant: "acme", bucket: "media" };
  const call = (name: string, args: Record<string, unknown>) =>
    agent.callTool({ name, arguments: { scope, ...args } });
  const fault = (promise: Promise<unknown>) =>
    promise.then(
      () => "OK",
      (e: { code?: string; status?: number }) => e.code + " " + e.status,
    );
  try {
    const vfs = (await connectBackplane({ app: "shop" }))
      .tenant("acme")
      .vfs("media");
    const chunk = randomBytes(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 3; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const stored = await vfs.upload("video/clip.bin", body);
    expect(stored).toMatchObject({ key: "video/clip.bin", size: 3 * chunk.length });
    const read = await vfs.download("video/clip.bin");
    if (!read.found) throw new Error("Uploaded object missing");
    const bytes = new Uint8Array(await new Response(read.stream).arrayBuffer());
    expect(bytes).toEqual(new Uint8Array(Buffer.concat([chunk, chunk, chunk])));
    expect(read).toMatchObject(stored);
    expect(await fault(vfs.get("video/clip.bin"))).toBe("PAYLOAD_TOO_LARGE 413");
    expect(await fault(vfs.upload("video/clip.bin", "x", { ifRevision: "stale" }))).toBe(
      "REVISION_CONFLICT 409",
    );
    expect(await fault(vfs.upload("video/clip.bin", "x", { ifRevision: null }))).toBe(
      "REVISION_CONFLICT 409",
    );
    const replaced = await vfs.upload("video/clip.bin", "short", {
      ifRevision: stored.revision,
    });
    expect(await vfs.head("video/clip.bin")).toEqual({ found: true, ...replaced });
    expect(await vfs.download("missing.bin")).toEqual({
      found: false,
      revision: null,
    });
    const url =
      daemon.url +
      "/vfs/object?" +
      new URLSearchParams({ ...scope, key: "video/clip.bin" });
    const unquoted = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "If-Match": replaced.revision },
      body: "x",
    });
    expect([unquoted.status, (await unquoted.json()).code]).toEqual([
      400,
      "INVALID_ARGUMENT",
    ]);
    expect((await fetch(url, { method: "POST", headers })).status).toBe(405);
    // A reader that disconnects mid-download must release its volume, or the daemon cannot close.
    await vfs.upload("video/clip.bin", new Blob([chunk, chunk, chunk]));
    const abort = new AbortController();
    const partial = await fetch(url, { headers, signal: abort.signal });
    await partial.body?.getReader().read();
    abort.abort();

    expect((await call("vfs.put", { key: "notes/a.txt", data: "grüß" })).structuredContent)
      .toMatchObject({ value: { key: "notes/a.txt", size: 6 } });
    expect(
      (await call("vfs.put", { key: "notes/b.bin", data: "AP+A", encoding: "base64" }))
        .structuredContent,
    ).toMatchObject({ value: { size: 3 } });
    expect(await vfs.get("notes/b.bin")).toMatchObject({
      found: true,
      value: Uint8Array.of(0, 255, 128),
    });
    expect((await call("vfs.get", { key: "notes/a.txt" })).structuredContent).toMatchObject({
      value: { found: true, value: "grüß", encoding: "utf8" },
    });
    expect(
      (await call("vfs.get", { key: "notes/b.bin", encoding: "base64" })).structuredContent,
    ).toMatchObject({ value: { found: true, value: "AP+A", encoding: "base64" } });
    for (const [name, args] of [
      ["vfs.get", { key: "notes/b.bin" }],
      ["vfs.put", { key: "notes/c.bin", data: "not base64!", encoding: "base64" }],
    ] as const)
      expect((await call(name, args)).structuredContent).toMatchObject({
        code: "INVALID_ARGUMENT",
        status: 400,
      });
    const head = (await call("vfs.head", { key: "notes/a.txt" })).structuredContent as {
      value: { revision: string };
    };
    expect(
      (await call("vfs.list", { request: { prefix: "notes/" } })).structuredContent,
    ).toMatchObject({
      value: { objects: [{ key: "notes/a.txt" }, { key: "notes/b.bin" }], nextAfter: null },
    });
    expect(
      (await call("vfs.delete", { key: "notes/a.txt", ifRevision: "stale" })).structuredContent,
    ).toMatchObject({ code: "REVISION_CONFLICT", status: 409 });
    expect(
      (await call("vfs.delete", { key: "notes/a.txt", ifRevision: head.value.revision }))
        .structuredContent,
    ).toEqual({ value: true });
  } finally {
    await stop();
  }
}, 30000);
