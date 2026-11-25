/** VERIFIED: tests/cli.test.ts. Starts the service: validates the configuration, checks that the backplane is ready,
 * seeds an empty workspace, and stops cleanly on SIGTERM or SIGINT. It reads `dist/public` and `input/seed.json` from
 * the working directory, which is the project directory under `make start`; Bun loads `.env` from there too. */
import { resolve } from "node:path";
import type { Seed } from "../core/seed.ts";
import { type Config, loadConfig } from "./config.ts";
import { format } from "./log.ts";
import { startServer } from "./server.ts";

const fail = (message: string, fields: Record<string, string> = {}): never => {
  process.stderr.write(format("error", message, fields) + "\n");
  process.exit(1);
};

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  fail("startup failed", { error: (error as Error).message });
}
const backplane = "http://127.0.0.1:" + config!.backplanePort;
const ready = await fetch(backplane + "/readyz", { signal: AbortSignal.timeout(5000) }).then(
  (r) => r.ok,
  () => false,
);
if (!ready) fail("startup failed", { error: "The backplane is not ready", url: backplane + "/readyz" });
const seed: Seed = await Bun.file(resolve("input/seed.json")).json();
const server = await startServer(config!, { publicDir: resolve("dist/public"), seed }).catch((error: Error) =>
  fail("startup failed", { error: error.message }),
);
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    void server.close().then(() => process.exit(0));
  });
