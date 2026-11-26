/** Starts the real defuss-backplane daemon from the installed package as a child process, on a free port with a
 * throwaway data directory, a random root key and a random auth master key. The child runs in that directory, so it
 * reads no `.env` of this project. `apiKey` is the app's own bot key, as `make bot APP=linear-clone` makes it;
 * `rootKey` is the daemon's `API_KEY`. */
import { randomBytes } from "node:crypto";
import { connectBackplane } from "defuss-backplane/client";
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
  const rootKey = randomBytes(24).toString("hex");
  const cli = join(import.meta.dir, "../../node_modules/defuss-backplane/dist/cli.js");
  const child = Bun.spawn([process.execPath, cli], {
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? "",
      PORT: String(port),
      API_KEY: rootKey,
      BACKPLANE_DATA_DIR: join(dir, "data"),
      BACKPLANE_AUTH_MASTER_KEY: randomBytes(32).toString("base64url"),
      ...env,
    },
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
    if (ready) {
      // With auth switched off by an empty master key there are no bots, so the app gets the root key.
      if (env.BACKPLANE_AUTH_MASTER_KEY === "") return { port, apiKey: rootKey, rootKey, url, stop };
      const root = await connectBackplane({ app: "linear-clone", port, apiKey: rootKey });
      const bot = await root.bots.create({ name: "linear-clone", apps: ["linear-clone"] });
      return { port, apiKey: bot.key, rootKey, url, stop };
    }
    await Bun.sleep(50);
  }
  const stderr = await new Response(child.stderr).text().catch(() => "");
  await stop();
  throw new Error("The backplane did not become ready: " + stderr.slice(0, 500));
}
