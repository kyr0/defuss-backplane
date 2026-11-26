import { afterAll, beforeAll, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectBackplane } from "defuss-backplane/client";
import { openWorkspace } from "../src/server/workspace.ts";
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

test("the account commands give a person a sign-in from stdin and print an agent's key once", async () => {
  const admin = (args: string[], stdin = "") =>
    Bun.spawn([process.execPath, join(import.meta.dir, "../src/server/admin.ts"), ...args], {
      cwd: home,
      env: { PATH: process.env.PATH ?? "", BACKPLANE_PORT: String(daemon.port), BACKPLANE_API_KEY: daemon.apiKey, WORKSPACE: "accounts" },
      stdin: new Blob([stdin]),
      stdout: "pipe",
    });
  const result = async (child: ReturnType<typeof admin>) => ({
    code: await child.exited,
    out: JSON.parse((await new Response(child.stdout).text()).trim()),
  });
  const member = await result(admin(["member", "ada@example.com", "ada", "Ada Lovelace"], "correct horse battery staple\n"));
  expect(member).toMatchObject({ code: 0, out: { ok: true, person: "ada", created: true } });
  const agent = await result(admin(["apikey", "Triage Bot"]));
  expect(agent).toMatchObject({ code: 0, out: { ok: true, person: "agent-triage-bot" } });
  expect(agent.out.key).toStartWith("dfa_");
  const ws = await openWorkspace({ port: daemon.port, apiKey: daemon.apiKey, workspace: "accounts", timeZone: "UTC" });
  try {
    expect(await ws.members.personOf(member.out.subjectId)).toMatchObject({ id: "ada", name: "Ada Lovelace" });
    const who = await ws.members.authenticate("ApiKey " + agent.out.key);
    expect((await ws.members.personOf(who.subjectId))?.id).toBe("agent-triage-bot");
  } finally {
    await ws.close();
  }
  expect(await result(admin(["member", "bob@example.com", "bob"]))).toMatchObject({ code: 1, out: { ok: false, fix: expect.stringContaining("password") } });
  expect(await result(admin(["member"]))).toMatchObject({ code: 1, out: { ok: false, error: "EMAIL and PERSON are required" } });
  expect(await result(admin(["nothing"]))).toMatchObject({ code: 1, out: { ok: false } });
});

test("the bot command writes the app's bot key into .env, keeps it on setup, rotates it when forced, and names each fix", async () => {
  const own = await startDaemon();
  const off = await startDaemon({ BACKPLANE_AUTH_MASTER_KEY: "" });
  const dir = await mkdtemp(join(tmpdir(), "linear-clone-bot-"));
  const envFile = join(dir, ".env");
  const keyOf = async () => /^BACKPLANE_API_KEY=(.*)$/m.exec(await readFile(envFile, "utf8"))![1]!;
  // No BACKPLANE_* in the environment: Bun loads them from .env in the working directory, as under make.
  const bot = async (args: string[], rootKey: string) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/server/admin.ts"), "bot", ...args], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? "" },
      stdin: new Blob([rootKey + "\n"]),
      stdout: "pipe",
    });
    return { code: await child.exited, out: JSON.parse((await new Response(child.stdout).text()).trim()) };
  };
  const status = (apiKey: string) =>
    connectBackplane({ app: "linear-clone", port: own.port, apiKey }).then((b) => b.auth.status()).then(
      (s) => s.app,
      (e: { code?: string }) => e.code,
    );
  try {
    await writeFile(envFile, `BACKPLANE_PORT=${own.port}\nBACKPLANE_API_KEY=${own.rootKey}\nWORKSPACE=bots\n`, { mode: 0o600 });
    // The daemon helper made a bot named linear-clone, so the command rotates its key instead of adding a second bot.
    expect(await bot(["--if-needed"], own.rootKey)).toMatchObject({ code: 0, out: { ok: true, bot: "linear-clone", rotated: true, wrote: ".env" } });
    const written = await keyOf();
    expect(written).toStartWith("dfa_");
    expect(await readFile(envFile, "utf8")).toContain("WORKSPACE=bots\n");
    expect((await stat(envFile)).mode & 0o777).toBe(0o600);
    expect(await status(written)).toBe("linear-clone");
    expect(await status(own.apiKey)).toBe("UNAUTHORIZED");
    // Setup again: a bot key stays, and no root key is needed.
    expect(await bot(["--if-needed"], "")).toMatchObject({ code: 0, out: { ok: true, kept: true } });
    expect(await keyOf()).toBe(written);
    // Forced: a new key for the same bot.
    expect(await bot([], own.rootKey)).toMatchObject({ code: 0, out: { ok: true, rotated: true } });
    expect(await keyOf()).not.toBe(written);
    expect(await status(written)).toBe("UNAUTHORIZED");
    const bots = await (await connectBackplane({ app: "linear-clone", port: own.port, apiKey: own.rootKey })).bots.list();
    expect(bots.filter((b) => b.name === "linear-clone")).toHaveLength(1);
    // Refusals name their fix: no root key, a wrong one, auth off and no daemon.
    expect(await bot([], "")).toMatchObject({ code: 1, out: { ok: false, fix: expect.stringContaining("make bot") } });
    expect(await bot([], "wrong")).toMatchObject({ code: 1, out: { ok: false, fix: expect.stringContaining("API_KEY") } });
    await writeFile(envFile, `BACKPLANE_PORT=${off.port}\nBACKPLANE_API_KEY=${off.rootKey}\n`);
    expect(await bot(["--if-needed"], off.rootKey)).toMatchObject({ code: 1, out: { ok: false, fix: expect.stringContaining("BACKPLANE_AUTH_MASTER_KEY") } });
    await writeFile(envFile, `BACKPLANE_PORT=${await freePort()}\nBACKPLANE_API_KEY=${off.rootKey}\n`);
    expect(await bot([], off.rootKey)).toMatchObject({ code: 1, out: { ok: false, fix: expect.stringContaining("make start") } });
  } finally {
    await own.stop();
    await off.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 60000);
