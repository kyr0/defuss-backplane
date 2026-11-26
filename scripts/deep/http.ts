/** VERIFIED: run once by scripts/deep/run.ts. What only plain HTTP reaches, as the README documents it: the
 * `/vfs/object` stream route with its conditional headers, every row of the `/files` request-header table, Content-Type
 * by extension with `nosniff` for active content, the typed client's upload and download, the probes, `/metrics` with
 * every documented metric, and the error codes a caller can provoke from outside. */
import { request as httpRequest } from "node:http";
import { assert, type Ctx, rejects } from "./kit.ts";

export interface Http {
  base: string;
  headers: Record<string, string>;
  /** Calls one MCP tool with raw arguments, for faults the driver's DSON reads avoid. */
  tool(name: string, args: Record<string, unknown>): Promise<{ isError?: boolean; structuredContent?: unknown }>;
}
type Streams = {
  upload(key: string, body: unknown, options?: { ifRevision?: string | null }): Promise<Record<string, unknown>>;
  download(key: string): Promise<{ found: boolean; revision: string | null; stream?: ReadableStream<Uint8Array> } & Record<string, unknown>>;
};

const enc = encodeURIComponent;

export async function httpScenario({ rpc, app, tenant, bucket, step }: Ctx, http: Http) {
  const object = (key: string) => `${http.base}/vfs/object?` + new URLSearchParams({ app, tenant, bucket, key });
  const files = (key: string) => `${http.base}/files/${enc(app)}/${enc(tenant)}/${enc(bucket)}/` + key.split("/").map(enc).join("/");
  const auth = http.headers;
  const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
  const streams = rpc.vfs(bucket) as unknown as Streams;

  await step("/vfs/object PUT stores a body; If-None-Match * and If-Match are its revision conditions", async () => {
    const put = (body: string, headers: Record<string, string> = {}) =>
      fetch(object("obj/a.txt"), { method: "PUT", headers: { ...auth, "Content-Type": "application/octet-stream", ...headers }, body });
    const first = await put("abc", { "If-None-Match": "*" });
    assert.equal(first.status, 200);
    const meta = await json(first);
    assert.deepEqual([meta.key, meta.size], ["obj/a.txt", 3]);
    const again = await put("x", { "If-None-Match": "*" });
    assert.deepEqual([again.status, (await json(again)).code], [409, "REVISION_CONFLICT"]);
    const matched = await put("abcd", { "If-Match": `"${meta.revision}"` });
    assert.equal(matched.status, 200);
    const stale = await put("y", { "If-Match": `"${meta.revision}"` });
    assert.deepEqual([stale.status, (await json(stale)).code], [409, "REVISION_CONFLICT"]);
  });
  await step("/vfs/object GET returns the bytes, ETag and X-Mtime-Ms; a missing object is 404", async () => {
    const r = await fetch(object("obj/a.txt"), { headers: auth });
    const head = await streams.download("obj/a.txt");
    await head.stream?.cancel();
    assert.deepEqual([r.status, r.headers.get("etag"), Number(r.headers.get("x-mtime-ms")) > 0], [200, `"${head.revision}"`, true]);
    assert.equal(await r.text(), "abcd");
    const missing = await fetch(object("obj/none"), { headers: auth });
    assert.deepEqual([missing.status, (await json(missing)).code], [404, "NOT_FOUND"]);
  });
  const body = Array.from({ length: 1000 }, (_, i) => String(i % 10)).join("");
  let etag = "";
  await step("/files answers each request header as the README's table says", async () => {
    await rpc.vfs(bucket).put("media/clip.txt", body);
    const get = (headers: Record<string, string> = {}, method = "GET") => fetch(files("media/clip.txt"), { method, headers: { ...auth, ...headers } });
    const whole = await get();
    etag = whole.headers.get("etag") ?? "";
    assert.deepEqual(
      [whole.status, whole.headers.get("accept-ranges"), whole.headers.get("cache-control"), whole.headers.get("x-size"), !!whole.headers.get("last-modified"), etag.startsWith('"')],
      [200, "bytes", "private, no-cache", "1000", true, true],
    );
    assert.equal(await whole.text(), body);
    const range = async (value: string, status: number, slice: string, contentRange: string) => {
      const r = await get({ Range: value });
      assert.deepEqual([r.status, r.headers.get("content-range"), await r.text()], [status, contentRange, slice], value);
    };
    await range("bytes=10-19", 206, body.slice(10, 20), "bytes 10-19/1000");
    await range("bytes=990-", 206, body.slice(990), "bytes 990-999/1000");
    await range("bytes=-5", 206, body.slice(995), "bytes 995-999/1000");
    const past = await get({ Range: "bytes=2000-2100" });
    assert.deepEqual([past.status, past.headers.get("content-range")], [416, "bytes */1000"]);
    await past.body?.cancel();
    const several = await get({ Range: "bytes=0-1,5-6" });
    assert.deepEqual([several.status, (await several.text()).length], [200, 1000]);
    await range("bytes=0-4", 206, body.slice(0, 5), "bytes 0-4/1000");
    const ifRange = async (value: string, status: number) => {
      const r = await get({ Range: "bytes=0-4", "If-Range": value });
      assert.equal(r.status, status, "If-Range " + value);
      await r.body?.cancel();
    };
    await ifRange(etag, 206);
    await ifRange('"other"', 200);
    await ifRange(new Date(Date.now() + 3600_000).toUTCString(), 200);
    const cached = await get({ "If-None-Match": etag });
    assert.deepEqual([cached.status, await cached.text()], [304, ""]);
    const since = await get({ "If-Modified-Since": new Date(Date.now() + 3600_000).toUTCString() });
    assert.equal(since.status, 304);
    const changed = await get({ "If-Match": '"other"' });
    assert.equal(changed.status, 412);
    const unmodified = await get({ "If-Unmodified-Since": new Date(0).toUTCString() });
    assert.equal(unmodified.status, 412);
    const head = await get({}, "HEAD");
    assert.deepEqual([head.status, head.headers.get("x-size"), await head.text()], [200, "1000", ""]);
    const missing = await fetch(files("media/none.txt"), { headers: auth });
    assert.deepEqual([missing.status, (await json(missing)).code], [404, "NOT_FOUND"]);
  });
  await step("Content-Type follows the extension; HTML, SVG and scripts are octet-stream with nosniff", async () => {
    const types: Record<string, string> = {
      "t/v.mp4": "video/mp4",
      "t/v.webm": "video/webm",
      "t/i.png": "image/png",
      "t/d.pdf": "application/pdf",
      "t/c.csv": "text/csv",
      "t/j.json": "application/json",
      "t/p.txt": "text/plain",
    };
    for (const key of [...Object.keys(types), "t/h.html", "t/s.svg", "t/x.js", "t/u.bin"]) await rpc.vfs(bucket).put(key, "x");
    for (const [key, type] of Object.entries(types)) {
      const r = await fetch(files(key), { headers: auth });
      assert.ok((r.headers.get("content-type") ?? "").startsWith(type), key + " " + r.headers.get("content-type"));
      await r.body?.cancel();
    }
    for (const key of ["t/h.html", "t/s.svg", "t/x.js", "t/u.bin"]) {
      const r = await fetch(files(key), { headers: auth });
      assert.deepEqual([r.headers.get("content-type"), r.headers.get("x-content-type-options")], ["application/octet-stream", "nosniff"], key);
      await r.body?.cancel();
    }
  });
  await step("the typed client uploads strings, bytes, Blobs and iterables, and downloads a stream", async () => {
    async function* chunks() {
      yield new TextEncoder().encode("it");
      yield new TextEncoder().encode("er");
    }
    const bodies: [string, unknown, string][] = [
      ["up/s.txt", "string", "string"],
      ["up/b.bin", new TextEncoder().encode("bytes"), "bytes"],
      ["up/blob.txt", new Blob(["blob"]), "blob"],
      ["up/it.txt", chunks(), "iter"],
    ];
    for (const [key, data, expected] of bodies) {
      assert.equal((await streams.upload(key, data)).size, expected.length);
      const read = await streams.download(key);
      assert.equal(await new Response(read.stream).text(), expected);
    }
    await rejects(streams.upload("up/s.txt", "again", { ifRevision: null }), "REVISION_CONFLICT", 409);
    assert.deepEqual(await streams.download("up/none"), { found: false, revision: null });
  });
  await step("probes answer without the key; /metrics needs it and names every documented metric", async () => {
    for (const path of ["/readyz", "/health"]) {
      const r = await fetch(http.base + path);
      assert.deepEqual([r.status, await json(r)], [200, { service: "defuss-backplane", status: "pass", checks: [{ name: "storage", status: "pass" }] }], path);
    }
    for (const path of ["/livez", "/healthz"]) assert.equal((await fetch(http.base + path)).status, 200, path);
    assert.equal((await fetch(http.base + "/metrics")).status, 401);
    const metrics = await (await fetch(http.base + "/metrics", { headers: auth })).text();
    for (const name of [
      "backplane_operation_duration",
      "http_server_request_duration",
      "backplane_storage_free",
      "backplane_store_handles",
      "backplane_http_active",
      "backplane_callback_duration",
      "backplane_scheduler_errors_total",
    ])
      assert.ok(metrics.includes(name), name);
    assert.ok(new RegExp(`backplane_operation_duration_count\\{[^}]*module="cache"[^}]*app="${app}"`).test(metrics) || new RegExp(`app="${app}"[^}]*module="cache"`).test(metrics), "the suite's cache calls are counted");
  });
  await step("requests outside the policy fail with the documented codes", async () => {
    const noKey = await fetch(http.base + "/rpc", { method: "POST", body: "{}" });
    assert.deepEqual([noKey.status, (await json(noKey)).code, !!noKey.headers.get("www-authenticate")], [401, "UNAUTHORIZED", true]);
    const origin = await fetch(http.base + "/rpc", { method: "POST", headers: { ...auth, Origin: "http://example.org" }, body: "{}" });
    assert.deepEqual([origin.status, (await json(origin)).code], [403, "FORBIDDEN"]);
    const url = new URL(http.base + "/readyz");
    const host = await new Promise<number>((done, fail) =>
      httpRequest({ host: url.hostname, port: url.port, path: url.pathname, headers: { host: "untrusted.example" } }, (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      })
        .on("error", fail)
        .end(),
    );
    assert.equal(host, 403);
    // The listener answers an unknown path itself, in plain text; the routes' faults are JSON.
    const unknown = await fetch(http.base + "/nope", { headers: auth });
    assert.deepEqual([unknown.status, await unknown.text()], [404, "Not Found"]);
    const method = await fetch(http.base + "/rpc", { headers: auth });
    assert.deepEqual([method.status, (await json(method)).code, method.headers.get("allow")], [405, "METHOD_NOT_ALLOWED", "POST"]);
    // VERIFIED by probe: before the daemon read oversized bodies to their end, up to 9 of 10 such calls broke.
    for (let i = 0; i < 10; i++) await rejects(rpc.vfs(bucket).put("big.bin", new Uint8Array(12 * 1048576)), "PAYLOAD_TOO_LARGE", 413);
    await rpc.cache(bucket).set("native", { at: new Date(0) });
    const json1 = await http.tool("cache.get", { scope: { app, tenant, bucket }, key: "native" });
    assert.deepEqual([json1.isError, (json1.structuredContent as { code: string }).code], [true, "DSON_REQUIRED"]);
  });
  await step("cleanup deletes every object and key", async () => {
    const vfs = rpc.vfs(bucket);
    for (const o of (await vfs.list({ limit: 1000 })).objects) assert.equal(await vfs.delete(o.key as string), true);
    assert.equal(await rpc.cache(bucket).delete("native"), true);
  });
}
