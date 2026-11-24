import { test, expect } from "bun:test";
import { randomBytes } from "node:crypto";
import { connectBackplane } from "../src/client.js";
import { start } from "./daemon.js";

// Names with spaces and non-ASCII letters, percent-encoded per path segment as a browser or curl sends them.
const scope = { app: "shop", tenant: "Müller & Co", bucket: "media" };
const path = (key: string) =>
  "/files/" +
  [scope.app, scope.tenant, scope.bucket].map(encodeURIComponent).join("/") +
  "/" +
  key.split("/").map(encodeURIComponent).join("/");

test("files stream over plain HTTP with validators, conditions and byte ranges", async () => {
  const { daemon, headers, stop } = await start();
  const get = (key: string, extra: Record<string, string> = {}, method = "GET") =>
    fetch(daemon.url + path(key), { method, headers: { ...headers, ...extra } });
  try {
    const vfs = (await connectBackplane({ app: scope.app }))
      .tenant(scope.tenant)
      .vfs(scope.bucket);
    // Three windows of the ranged reader, so a range can span a window boundary.
    const bytes = randomBytes(700 * 1024);
    const stored = await vfs.upload("movies/demo clip.mp4", new Blob([bytes]));
    const tag = '"' + stored.revision + '"';

    const whole = await get("movies/demo clip.mp4");
    expect(whole.status).toBe(200);
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(bytes);
    expect(Object.fromEntries(
      ["etag", "accept-ranges", "content-type", "x-content-type-options", "x-size", "cache-control"].map(
        (h) => [h, whole.headers.get(h)],
      ),
    )).toEqual({
      etag: tag,
      "accept-ranges": "bytes",
      "content-type": "video/mp4",
      "x-content-type-options": "nosniff",
      "x-size": String(bytes.length),
      "cache-control": "private, no-cache",
    });
    const head = await get("movies/demo clip.mp4", {}, "HEAD");
    expect([head.status, head.headers.get("etag"), await head.text()]).toEqual([200, tag, ""]);

    const start = 256 * 1024 - 10;
    const span = await get("movies/demo clip.mp4", { Range: `bytes=${start}-${start + 300 * 1024}` });
    expect(span.status).toBe(206);
    expect(span.headers.get("content-range")).toBe(
      `bytes ${start}-${start + 300 * 1024}/${bytes.length}`,
    );
    expect(Buffer.from(await span.arrayBuffer())).toEqual(
      bytes.subarray(start, start + 300 * 1024 + 1),
    );
    const tail = await get("movies/demo clip.mp4", { Range: "bytes=-5" });
    expect([tail.status, Buffer.from(await tail.arrayBuffer())]).toEqual([
      206,
      bytes.subarray(-5),
    ]);
    const beyond = await get("movies/demo clip.mp4", { Range: `bytes=${bytes.length}-` });
    expect([beyond.status, beyond.headers.get("content-range")]).toEqual([
      416,
      "bytes */" + bytes.length,
    ]);
    // A multi-range request and a Range guarded by another revision both get the whole object.
    expect((await get("movies/demo clip.mp4", { Range: "bytes=0-1,5-6" })).status).toBe(200);
    expect(
      (await get("movies/demo clip.mp4", { Range: "bytes=0-1", "If-Range": '"old"' })).status,
    ).toBe(200);
    expect((await get("movies/demo clip.mp4", { Range: "bytes=0-1", "If-Range": tag })).status).toBe(206);
    expect(
      (await get("movies/demo clip.mp4", {
        Range: "bytes=0-1",
        "If-Range": new Date(stored.mtimeMs).toUTCString(),
      })).status,
    ).toBe(200);
    expect((await get("movies/demo clip.mp4", { "If-None-Match": tag })).status).toBe(304);
    expect((await get("movies/demo clip.mp4", { "If-Match": '"old"' })).status).toBe(412);
    expect(
      (await get("movies/demo clip.mp4", {
        "If-Modified-Since": new Date(stored.mtimeMs + 1000).toUTCString(),
      })).status,
    ).toBe(304);

    // Scriptable types never get their own Content-Type.
    await vfs.put("pages/index.html", "<script>alert(1)</script>");
    expect((await get("pages/index.html")).headers.get("content-type")).toBe(
      "application/octet-stream",
    );

    const missing = await get("movies/absent.mp4");
    expect([missing.status, (await missing.json()).code]).toEqual([404, "NOT_FOUND"]);
    const short = await fetch(daemon.url + "/files/shop/acme", { headers });
    expect([short.status, (await short.json()).code]).toEqual([400, "INVALID_ARGUMENT"]);
    const posted = await fetch(daemon.url + path("movies/demo clip.mp4"), { method: "POST", headers });
    expect([posted.status, posted.headers.get("allow")]).toEqual([405, "GET, HEAD"]);
    expect((await fetch(daemon.url + path("movies/demo clip.mp4"))).status).toBe(401);
    expect(
      (await get("movies/demo clip.mp4", { Origin: "http://example.org" })).status,
    ).toBe(403);
  } finally {
    await stop();
  }
}, 30000);
