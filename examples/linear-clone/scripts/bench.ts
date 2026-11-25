/** VERIFIED: `make bench` writes output/bench.json with it. Times the hot path, the `Issues.list` round trip the
 * browser makes on every load, over 1,000 issues: a throwaway backplane daemon, the app server in this process on a
 * seed grown to 1,000 issues, and the defuss-rpc client over loopback HTTP, as the browser calls it. Why the whole
 * path instead of the core sort: the list's cost is the backplane query and the RPC encoding, not the sort. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRpcContext } from "defuss-rpc/client";
import seedFile from "../input/seed.json" with { type: "json" };
import { issueId } from "../src/core/ids.ts";
import type { Seed } from "../src/core/seed.ts";
import type { Api } from "../src/server/api.ts";
import { loadConfig } from "../src/server/config.ts";
import { startServer } from "../src/server/server.ts";
import { freePort, startDaemon } from "../tests/helpers/daemon.ts";

const ISSUES = 1000;
const ITERATIONS = 50;
const log = (message: string, fields: Record<string, string | number>) =>
  console.log([new Date().toISOString(), "INFO bench", message, ...Object.entries(fields).map(([k, v]) => k + "=" + v)].join(" "));

/** The seed with its issues repeated as ENG-1 to ENG-1000; comments, events and notifications keep their IDs. */
function grown(seed: Seed): Seed {
  const team = seed.teams[0]!.id;
  const issues = Array.from({ length: ISSUES }, (_, i) => ({ ...seed.issues[i % seed.issues.length]!, id: issueId(team, i + 1) }));
  return { ...seed, issues, teams: seed.teams.map((t) => ({ ...t, next: ISSUES + 1 })) };
}

const seed = grown(seedFile as Seed);
const daemon = await startDaemon();
const publicDir = await mkdtemp(join(tmpdir(), "linear-clone-bench-"));
let server: Awaited<ReturnType<typeof startServer>> | undefined;
try {
  const config = loadConfig({
    PORT: String(await freePort()),
    BACKPLANE_PORT: String(daemon.port),
    BACKPLANE_API_KEY: daemon.apiKey,
    WORKSPACE: "bench",
  });
  server = await startServer(config, { publicDir, seed });
  const api = await createRpcContext({ baseUrl: server.url }).getRpcClient<Api>();
  const count = (await api.Issues.list()).length;
  if (count !== ISSUES) throw new Error(`Expected ${ISSUES} issues, listed ${count}`);
  for (let i = 0; i < 5; i++) await api.Issues.list();
  const ms: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await api.Issues.list();
    ms.push(performance.now() - start);
  }
  ms.sort((a, b) => a - b);
  const at = (q: number) => Number(ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]!.toFixed(2));
  const result = {
    at: new Date().toISOString(),
    path: "Issues.list over RPC",
    issues: ISSUES,
    iterations: ITERATIONS,
    ms: { min: at(0), p50: at(0.5), p95: at(0.95), max: at(1), mean: Number((ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2)) },
  };
  await mkdir(join(import.meta.dir, "../output"), { recursive: true });
  await writeFile(join(import.meta.dir, "../output/bench.json"), JSON.stringify(result, null, 2) + "\n");
  log("Issues.list", { issues: ISSUES, iterations: ITERATIONS, p50_ms: result.ms.p50, p95_ms: result.ms.p95, report: "output/bench.json" });
} finally {
  await server?.close();
  await daemon.stop();
  await rm(publicDir, { recursive: true, force: true });
}
