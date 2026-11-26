/** VERIFIED: run once by scripts/deep/run.ts. A large object end to end: random bytes streamed up through the typed
 * client, then read back through the client's download, `/vfs/object`, `/files` and ranges over RPC and MCP, each
 * checked by SHA-256. While each transfer runs, the daemon's resident memory is sampled; it must grow by less than a
 * quarter of the object, which a daemon that buffered the object could not do. Free disk comes from the daemon's own
 * `backplane_storage_free` gauge. */
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Ops } from "./drivers.ts";
import type { Http } from "./http.ts";
import { assert, type Ctx } from "./kit.ts";

const MiB = 1048576;
type Streams = {
  upload(key: string, body: unknown): Promise<Record<string, unknown>>;
  download(key: string): Promise<{ found: boolean; revision: string | null; stream?: ReadableStream<Uint8Array> }>;
};
export type Transfer = { name: string; seconds: number; mibPerSecond: number; rssGrowthMiB: number | null };

/** The daemon's resident memory in MiB, or null without a pid. */
async function rss(pid: number | undefined) {
  if (!pid) return null;
  const { stdout } = await promisify(execFile)("ps", ["-o", "rss=", "-p", String(pid)]);
  return Number(stdout.trim()) / 1024;
}

/** Runs `transfer` while sampling the daemon's memory every 100 ms; returns its time and the largest growth. */
async function measured(name: string, mib: number, pid: number | undefined, transfer: () => Promise<void>): Promise<Transfer> {
  const before = await rss(pid);
  let peak = before ?? 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      peak = Math.max(peak, (await rss(pid)) ?? 0);
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  const started = performance.now();
  try {
    await transfer();
  } finally {
    sampling = false;
    await sampler;
  }
  const seconds = (performance.now() - started) / 1000;
  return { name, seconds: Math.round(seconds * 100) / 100, mibPerSecond: Math.round(mib / seconds), rssGrowthMiB: before === null ? null : Math.round(peak - before) };
}

async function sha(stream: ReadableStream<Uint8Array> | null | undefined) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of stream ?? []) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { digest: hash.digest("hex"), size };
}

export async function bigScenario({ rpc, app, tenant, bucket, step }: Ctx, mcp: Ops, http: Http, mib: number, pid: number | undefined, transfers: Transfer[]) {
  const key = "big/blob.bin";
  const streams = rpc.vfs(bucket) as unknown as Streams;
  const size = mib * MiB;
  const upload = createHash("sha256");
  let last = new Uint8Array();
  const bound = mib / 4;
  const check = (t: Transfer) => {
    transfers.push(t);
    if (t.rssGrowthMiB !== null) assert.ok(t.rssGrowthMiB < bound, `${t.name}: memory grew ${t.rssGrowthMiB} MiB, bound ${bound} MiB`);
  };
  let digest = "";
  await step(`the volume has room for ${mib} MiB three times over`, async () => {
    const metrics = await (await fetch(http.base + "/metrics", { headers: http.headers })).text();
    const free = Number(/^backplane_storage_free(?:\{[^}]*\})? (\d+(?:\.\d+)?(?:e\+\d+)?)/m.exec(metrics)?.[1]);
    assert.ok(free > 3 * size, `backplane_storage_free is ${Math.round(free / MiB)} MiB; the transfer needs ${3 * mib} MiB`);
  });
  await step(`upload streams ${mib} MiB of random bytes`, async () => {
    async function* body() {
      for (let i = 0; i < mib; i++) {
        const chunk = randomBytes(MiB);
        upload.update(chunk);
        if (i === mib - 1) last = new Uint8Array(chunk);
        yield chunk;
      }
    }
    check(
      await measured("upload", mib, pid, async () => {
        const meta = await streams.upload(key, body());
        assert.equal(meta.size, size);
      }),
    );
    digest = upload.digest("hex");
  });
  await step("download, /vfs/object and /files return the same bytes", async () => {
    check(
      await measured("client download", mib, pid, async () => {
        const read = await streams.download(key);
        assert.deepEqual(await sha(read.stream), { digest, size });
      }),
    );
    const object = `${http.base}/vfs/object?` + new URLSearchParams({ app, tenant, bucket, key });
    check(
      await measured("GET /vfs/object", mib, pid, async () => {
        assert.deepEqual(await sha((await fetch(object, { headers: http.headers })).body), { digest, size });
      }),
    );
    const files = `${http.base}/files/${[app, tenant, bucket].map(encodeURIComponent).join("/")}/${key}`;
    check(
      await measured("GET /files", mib, pid, async () => {
        const r = await fetch(files, { headers: http.headers });
        assert.equal(r.headers.get("x-size"), String(size));
        assert.deepEqual(await sha(r.body), { digest, size });
      }),
    );
    const tail = await fetch(files, { headers: { ...http.headers, Range: `bytes=${size - MiB}-` } });
    assert.equal(tail.status, 206);
    assert.deepEqual(new Uint8Array(await tail.arrayBuffer()), last);
  });
  await step("ranges at the end read the same bytes over RPC and MCP", async () => {
    assert.deepEqual((await rpc.vfs(bucket).get(key, { offset: size - MiB, length: MiB })).value, last);
    assert.deepEqual((await mcp.vfs(bucket).get(key, { offset: size - 4096, length: 4096 })).value, last.slice(MiB - 4096));
  });
  await step("cleanup deletes the object", async () => {
    assert.equal(await rpc.vfs(bucket).delete(key), true);
  });
}
