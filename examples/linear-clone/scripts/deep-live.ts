/** VERIFIED: `make e2e-live` runs it. The deep suite against the backplane this project's `.env` names, which
 * `make start` in the repository root runs: a second instance of the built app works in `_e2e_test_linear-clone`,
 * never in the configured workspace, and the app `make start` runs here is not touched. Results go to
 * output/deep-live.json. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDeep } from "./e2e-deep.ts";

const root = join(import.meta.dirname, "..");
const port = Number(process.env.BACKPLANE_PORT || 43127);
const apiKey = process.env.BACKPLANE_API_KEY ?? "";
if (!apiKey) throw new Error("BACKPLANE_API_KEY is not set: run make setup, which writes .env");
const ready = await fetch(`http://127.0.0.1:${port}/readyz`).then(
  (r) => r.ok,
  () => false,
);
if (!ready) throw new Error(`The backplane on port ${port} is not ready: run make start in the repository root`);
const work = await mkdtemp(join(tmpdir(), "linear-clone-deep-"));
let results: Awaited<ReturnType<typeof runDeep>>;
try {
  results = await runDeep({ root, work, backplane: { port, apiKey } });
} finally {
  await rm(work, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
await mkdir(join(root, "output"), { recursive: true });
await writeFile(join(root, "output/deep-live.json"), JSON.stringify({ at: new Date().toISOString(), backplanePort: port, results }, null, 2) + "\n");
for (const r of failed) console.log(`FAIL ${r.via} ${JSON.stringify(r.step)}: ${r.error?.slice(0, 600)}`);
console.log(JSON.stringify({ deep: failed.length ? "FAIL" : "PASS", steps: results.length, failed: failed.length, report: "output/deep-live.json" }));
if (failed.length) process.exit(1);
