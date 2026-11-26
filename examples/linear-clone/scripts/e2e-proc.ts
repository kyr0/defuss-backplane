/** VERIFIED: scripts/e2e.ts and scripts/deep-live.ts start their processes with these. Child processes for the
 * end-to-end runs: a free loopback port, a start that waits for a ready line, and a stop by SIGTERM. */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { createServer } from "node:net";

export async function freePort() {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  await new Promise<void>((done) => probe.close(() => done()));
  if (!address || typeof address === "string") throw new Error("No port");
  return address.port;
}

/** Starts a child and resolves once a line of its stdout matches `ready`. */
export function launch(command: string[], cwd: string, env: Record<string, string>, ready: RegExp) {
  const child = spawn(command[0]!, command.slice(1), { cwd, env: { PATH: process.env.PATH ?? "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  return new Promise<ChildProcess>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Not ready: " + command.join(" ") + "\n" + output)), 20_000);
    const seen = (chunk: Buffer) => {
      output += chunk;
      if (ready.test(output)) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout!.on("data", seen);
    child.stderr!.on("data", (chunk: Buffer) => (output += chunk));
    child.on("exit", (code) => reject(new Error(command.join(" ") + " exited with " + code + "\n" + output)));
  });
}

export const stop = (child: ChildProcess) =>
  new Promise<void>((done) => {
    if (child.exitCode !== null) return done();
    child.removeAllListeners("exit");
    child.once("exit", () => done());
    child.kill("SIGTERM");
  });

/** Runs `make member` or `make apikey`'s command, `src/server/admin.ts`, with the instance's settings and `input` on
 * stdin, and returns its JSON line; a failure throws with that line. */
export function admin(root: string, env: Record<string, string>, args: string[], input = "") {
  const r = spawnSync("bun", [join(root, "src/server/admin.ts"), ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", ...env },
    input,
    encoding: "utf8",
  });
  const out = JSON.parse(r.stdout.trim() || "{}") as { ok?: boolean; key?: string; error?: string };
  if (r.status !== 0 || !out.ok) throw new Error("admin.ts " + args[0] + " failed: " + (r.stdout || r.stderr));
  return out;
}
