import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { merge, parse } from "../scripts/service.js";

const script = resolve(import.meta.dir, "../scripts/service.ts");

/** A throwaway project directory with a service script: it logs `listening` on stdout and an error on stderr. */
async function project(env = true) {
  const dir = await mkdtemp(join(tmpdir(), "backplane-service-"));
  if (env) await writeFile(join(dir, ".env"), "");
  await writeFile(
    join(dir, "svc.mjs"),
    `const at = () => new Date().toISOString();
     if (process.argv[2] === "die") { console.error(at() + " ERROR API_KEY is missing"); process.exit(1); }
     console.log(at() + " INFO listening url=http://127.0.0.1:1 note=" + JSON.stringify("a b"));
     setTimeout(() => console.error(at() + " WARN slow"), 20);
     process.on("SIGTERM", () => process.exit(0));
     setInterval(() => {}, 1000);`,
  );
  return dir;
}

function verb(dir: string, name: string, flags: Record<string, string> = {}) {
  const args = Object.entries({ name: "probe", run: "exec node svc.mjs", ...flags }).flatMap(([k, v]) => ["--" + k, v]);
  const r = spawnSync("node", [script, ...args, name], { cwd: dir, encoding: "utf8" });
  return { code: r.status, out: r.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
}

test("start, status, log and stop report a detached service as JSON", async () => {
  const dir = await project();
  try {
    const started = verb(dir, "start");
    expect(started.code).toBe(0);
    expect(started.out[0]).toMatchObject({ service: "probe", state: "running", started: true, url: "http://127.0.0.1:1" });
    expect(verb(dir, "start").out[0]).toMatchObject({ state: "running", started: false, pid: started.out[0].pid });
    expect(verb(dir, "status")).toMatchObject({ code: 0, out: [{ state: "running", pid: started.out[0].pid }] });
    await Bun.sleep(100);
    const log = verb(dir, "log").out;
    expect(log.map((e) => [e.stream, e.level, e.msg])).toEqual([
      ["stdout", "INFO", "listening"],
      ["stderr", "WARN", "slow"],
    ]);
    expect(log[0].fields).toEqual({ url: "http://127.0.0.1:1", note: "a b" });
    expect(verb(dir, "stop").out[0]).toMatchObject({ state: "stopped", was: "running", signal: "TERM" });
    expect(verb(dir, "status")).toMatchObject({ code: 0, out: [{ state: "stopped" }] });
  } finally {
    verb(dir, "stop");
    await rm(dir, { recursive: true, force: true });
  }
});

test("a service that exits at startup is dead, with its stderr lines, and status exits 1", async () => {
  const dir = await project();
  try {
    const started = verb(dir, "start", { run: "exec node svc.mjs die" });
    expect(started.code).toBe(1);
    expect(started.out[0]).toMatchObject({ state: "dead", fix: "make log" });
    expect(started.out[0].stderr.at(-1)).toEndWith("ERROR API_KEY is missing");
    expect(verb(dir, "status")).toMatchObject({ code: 1, out: [{ state: "dead" }] });
    expect(verb(dir, "stop").out[0]).toMatchObject({ state: "stopped", was: "dead", signal: null });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("start refuses without .env and reports a failed build without starting", async () => {
  const bare = await project(false);
  const dir = await project();
  try {
    expect(verb(bare, "start")).toMatchObject({ code: 6, out: [{ state: "unconfigured", error: ".env is missing", fix: "make setup" }] });
    const built = verb(dir, "start", { build: "echo compile error; exit 3" });
    expect(built).toMatchObject({ code: 1, out: [{ state: "build-failed", output: ["compile error"] }] });
    expect(verb(dir, "status").out[0].state).toBe("stopped");
  } finally {
    await rm(bare, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});

test("--format text prints one readable line", async () => {
  const dir = await project();
  try {
    const r = spawnSync("node", [script, "--name", "probe", "--format", "text", "status"], { cwd: dir, encoding: "utf8" });
    expect(r.stdout).toBe("stopped\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("log lines merge by time across streams, and an untimed line stays with the line above it", () => {
  const out = ["2026-11-26T06:00:00.000Z INFO a", "2026-11-26T06:00:02.000Z INFO c"];
  const err = ["2026-11-26T06:00:01.000Z ERROR b k=v", "    at frame (x.ts:1)"];
  const parsed = (lines: string[], stream: "stdout" | "stderr") =>
    lines.reduce<ReturnType<typeof parse>[]>((all, l) => [...all, parse(l, stream, all.at(-1)?.ts ?? null)], []);
  const merged = merge(parsed(out, "stdout"), parsed(err, "stderr"));
  expect(merged.map((e) => e.msg)).toEqual(["a", "b", "    at frame (x.ts:1)", "c"]);
  expect(merged[1]).toMatchObject({ level: "ERROR", fields: { k: "v" } });
  expect(merged[2]).toMatchObject({ ts: "2026-11-26T06:00:01.000Z", level: null });
});

test("probe and metrics read the running service's routes, with the key from .env, and refuse a stopped service", async () => {
  const dir = await project();
  await writeFile(join(dir, ".env"), "API_KEY=k1\n");
  await writeFile(
    join(dir, "http.mjs"),
    `import { createServer } from "node:http";
     const json = (res, status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
     const server = createServer((req, res) => {
       if (req.url === "/readyz") return json(res, 200, { status: "pass" });
       if (req.url === "/down") return json(res, 503, { status: "fail" });
       if (req.url === "/metrics")
         return req.headers.authorization === "Bearer k1" ? res.end('# HELP a\\na_total{app="shop"} 1\\nb_total{app="other"} 2\\n') : res.writeHead(401).end();
       res.writeHead(404).end();
     });
     server.listen(0, "127.0.0.1", () => console.log(new Date().toISOString() + " INFO listening url=http://127.0.0.1:" + server.address().port));
     process.on("SIGTERM", () => process.exit(0));`,
  );
  const raw = (name: string, flags: Record<string, string>) => {
    const args = Object.entries({ name: "probe", ...flags }).flatMap(([k, v]) => ["--" + k, v]);
    const r = spawnSync("node", [script, ...args, name], { cwd: dir, encoding: "utf8" });
    return { code: r.status, out: r.stdout.trim() };
  };
  try {
    expect(verb(dir, "probe")).toMatchObject({ code: 1, out: [{ state: "stopped", fix: "make start" }] });
    expect(verb(dir, "start", { run: "exec node http.mjs" }).code).toBe(0);
    expect(verb(dir, "probe")).toMatchObject({ code: 0, out: [{ state: "running", status: 200, ok: true, body: { status: "pass" } }] });
    expect(verb(dir, "probe", { path: "/down" })).toMatchObject({ code: 1, out: [{ status: 503, ok: false, body: { status: "fail" } }] });
    expect(raw("metrics", { "key-env": "API_KEY", app: "shop" })).toEqual({ code: 0, out: 'a_total{app="shop"} 1' });
    expect(raw("metrics", { "key-env": "API_KEY" }).out.split("\n")).toHaveLength(3);
    expect(verb(dir, "metrics")).toMatchObject({ code: 1, out: [{ ok: false, status: 401 }] });
    expect(verb(dir, "metrics", { "key-env": "NONE" })).toMatchObject({ code: 1, out: [{ ok: false, fix: "make env" }] });
  } finally {
    verb(dir, "stop");
    await rm(dir, { recursive: true, force: true });
  }
});
