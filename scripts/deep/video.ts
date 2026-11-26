/** VERIFIED: run once by scripts/deep/run.ts. Video streaming from vfs the way the README describes the browser path:
 * the backend proxies `/files` with the bot key, so the browser never holds it. Chromium plays the committed WebM
 * (`make fixtures` regenerates it) through such a proxy and seeks; the seek must fetch from the middle of the object
 * with a Range request that the daemon answers with 206. Why a proxy instead of extra browser headers: the daemon
 * refuses any request with an Origin header, and a real page never sees the key. VERIFIED: with a 130 KB clip,
 * Chromium read everything with one `bytes=0-` request, at full speed and at 40 KB/s, and seeked in its buffer; the
 * fixture is therefore 4 MB, and the proxy delivers it at a link's rate. */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { chromium } from "playwright-core";
import type { Http } from "./http.ts";
import { assert, type Ctx } from "./kit.ts";

type Proxied = { range: string | null; status: number };

export async function videoScenario({ rpc, app, tenant, bucket, step }: Ctx, http: Http, fixture: string) {
  const key = "media/clip.webm";
  const seen: Proxied[] = [];
  const page = `<!doctype html><title>clip</title><video id="v" src="/media/clip.webm" muted preload="auto"></video>`;
  const proxy = createServer(async (req, res) => {
    if (req.url === "/") return res.writeHead(200, { "Content-Type": "text/html" }).end(page);
    const forward: Record<string, string> = { ...http.headers };
    for (const name of ["range", "if-range"]) if (req.headers[name]) forward[name] = String(req.headers[name]);
    const upstream = await fetch(`${http.base}/files/${[app, tenant, bucket].map(encodeURIComponent).join("/")}/${key}`, { headers: forward });
    seen.push({ range: req.headers.range ?? null, status: upstream.status });
    const headers: Record<string, string> = {};
    for (const name of ["content-type", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    const length = upstream.headers.get("content-length") ?? (upstream.status === 200 ? upstream.headers.get("x-size") : null);
    if (length) headers["content-length"] = length;
    res.writeHead(upstream.status, headers);
    // About 200 KB/s, just above the clip's 1.5 Mbit/s: Chromium keeps reading one connection for a near seek, so the
    // seek target must lie megabytes beyond what has arrived. A request the browser abandons stops here.
    const reader = upstream.body?.getReader();
    try {
      for (let r = await reader?.read(); r && !r.done && !res.destroyed; r = await reader?.read())
        for (let at = 0; at < r.value.length && !res.destroyed; at += 4096) {
          res.write(r.value.subarray(at, at + 4096));
          await new Promise((done) => setTimeout(done, 20));
        }
    } finally {
      await reader?.cancel().catch(() => {});
      res.end();
    }
  });
  await step("Chromium plays the video through a proxy of /files and seeks with a 206 range", async () => {
    const streams = rpc.vfs(bucket) as unknown as { upload(k: string, b: Uint8Array): Promise<unknown> };
    await streams.upload(key, new Uint8Array(await readFile(fixture)));
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const browser = await chromium.launch();
    try {
      const tab = await browser.newPage();
      await tab.goto(`http://127.0.0.1:${(proxy.address() as { port: number }).port}/`);
      const played = await tab.evaluate(async () => {
        const v = document.getElementById("v") as HTMLVideoElement;
        const event = (name: string) => new Promise((done, fail) => {
          v.addEventListener(name, done, { once: true });
          v.addEventListener("error", () => fail(new Error("media error " + v.error?.code)), { once: true });
        });
        if (v.readyState < 1) await event("loadedmetadata");
        const duration = v.duration;
        await v.play();
        while (v.currentTime < 0.5) await new Promise((r) => setTimeout(r, 50));
        v.currentTime = 15;
        await event("seeked");
        while (v.currentTime < 15.3) await new Promise((r) => setTimeout(r, 50));
        return { duration, at: v.currentTime, error: v.error?.code ?? null, width: v.videoWidth };
      });
      assert.equal(Math.round(played.duration), 20);
      assert.deepEqual([played.error, played.width], [null, 640]);
      assert.ok(played.at >= 15.3, "playback went on after the seek");
    } finally {
      await browser.close();
      proxy.close();
    }
    const ranged = seen.filter((p) => p.status === 206);
    assert.ok(ranged.length > 0, "the browser read with Range: " + JSON.stringify(seen));
    assert.ok(ranged.some((p) => /^bytes=[1-9]\d*-/.test(p.range ?? "")), "the seek read from inside the object: " + JSON.stringify(seen));
  });
  await step("cleanup deletes the video", async () => {
    assert.equal(await rpc.vfs(bucket).delete(key), true);
  });
}
