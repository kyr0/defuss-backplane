import { afterAll, beforeAll, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Daemon, freePort, startDaemon } from "./helpers/daemon.ts";

const cli = join(import.meta.dir, "../src/server/cli.ts");
let daemon: Daemon;
/** A project directory as `make start` runs in: dist/public and input/seed.json, and no .env. */
let home: string;

beforeAll(async () => {
  daemon = await startDaemon();
  home = await mkdtemp(join(tmpdir(), "linear-clone-home-"));
  await mkdir(join(home, "dist/public"), { recursive: true });
  await mkdir(join(home, "input"));
  await writeFile(join(home, "dist/public/index.html"), "<!doctype html><title>Vector</title>");
  await cp(join(import.meta.dir, "../input/seed.json"), join(home, "input/seed.json"));
});
afterAll(async () => {
  await daemon?.stop();
  await rm(home, { recursive: true, force: true });
});

const run = (env: Record<string, string>) =>
  Bun.spawn([process.execPath, cli], {
    cwd: home,
    env: { PATH: process.env.PATH ?? "", BACKPLANE_PORT: String(daemon.port), BACKPLANE_API_KEY: daemon.apiKey, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

test("an invalid configuration value fails startup with exit code 1 and names the key", async () => {
  const child = run({ PORT: "99999" });
  expect(await child.exited).toBe(1);
  expect(await new Response(child.stderr).text()).toMatch(/^\S+Z ERROR startup failed error=".*PORT must be an integer/);
});

test("a backplane that is not ready fails startup with exit code 1", async () => {
  const child = run({ PORT: String(await freePort()), BACKPLANE_PORT: String(await freePort()) });
  expect(await child.exited).toBe(1);
  expect(await new Response(child.stderr).text()).toContain('error="The backplane is not ready"');
});

test("the service starts, serves, and exits with 0 on SIGTERM", async () => {
  const port = await freePort();
  const child = run({ PORT: String(port) });
  const reader = child.stdout.getReader();
  let out = "";
  while (!out.includes(" INFO listening ")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("exited: " + (await new Response(child.stderr).text()));
    out += new TextDecoder().decode(value);
  }
  expect(out).toContain(" INFO workspace seeded workspace=vector");
  expect((await fetch("http://127.0.0.1:" + port + "/rpc/schema")).ok).toBe(true);
  child.kill("SIGTERM");
  expect(await child.exited).toBe(0);
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) out += new TextDecoder().decode(chunk.value);
  expect(out).toContain(" INFO stopped ");
});
