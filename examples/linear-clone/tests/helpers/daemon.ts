/** Starts the real defuss-backplane daemon from the installed package as a child process, on a free port with a
 * throwaway data directory and a random key. The child runs in that directory, so it reads no `.env` of this project. */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function freePort() {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  await new Promise<void>((done) => probe.close(() => done()));
  if (!address || typeof address === "string") throw new Error("No port");
  return address.port;
}

export type Daemon = Awaited<ReturnType<typeof startDaemon>>;

export async function startDaemon(env: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "linear-clone-backplane-"));
  const port = await freePort();
  const apiKey = randomBytes(24).toString("hex");
  const cli = join(import.meta.dir, "../../node_modules/defuss-backplane/dist/cli.js");
  const child = Bun.spawn([process.execPath, cli], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? "", PORT: String(port), API_KEY: apiKey, BACKPLANE_DATA_DIR: join(dir, "data"), ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const url = "http://127.0.0.1:" + port;
  const stop = async () => {
    child.kill("SIGTERM");
    await child.exited;
    await rm(dir, { recursive: true, force: true });
  };
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) break;
    const ready = await fetch(url + "/readyz").then(
      (r) => r.ok,
      () => false,
    );
    if (ready) return { port, apiKey, url, stop };
    await Bun.sleep(50);
  }
  const stderr = await new Response(child.stderr).text().catch(() => "");
  await stop();
  throw new Error("The backplane did not become ready: " + stderr.slice(0, 500));
}
