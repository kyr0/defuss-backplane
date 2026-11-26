/** The Makefile lifecycle verbs of a detached service: `node scripts/service.ts start|stop|status|log`. VERIFIED:
 * tests/service.test.ts runs every verb, a dead start, a missing .env and a failed build against real processes.
 *
 * Every verb prints JSON by default (`--format text` prints one readable line per object), so scripts and agents read
 * the state, pid, URL and recent errors without parsing prose. Why one Node script instead of shell in the Makefile:
 * JSON needs escaping that shell cannot do reliably, and the backplane and the linear-clone example share these verbs.
 * Why flags, not environment variables: they configure this tool, not the service, so they stay out of .env.
 *
 * Flags: --name (service name), --run (shell command; `exec` keeps the pid), --build (optional command run quietly
 * before start), --lines (log entries, default 50), --format (json | text), --ready-ms (start's wait for `listening`,
 * default 10000). Paths, relative to the working directory: tmp/<name>.pid, var/log/<name>.stdout|.stderr (appended),
 * var/log/<name>.build (last build). */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { setTimeout as pause } from "node:timers/promises";
import { parseArgs } from "node:util";

type Report = Record<string, unknown> & { service: string; state: string };
export type Entry = { ts: string | null; stream: "stdout" | "stderr"; level: string | null; msg: string; fields: Record<string, string> };

const { values: flags, positionals } = import.meta.main
  ? parseArgs({
      allowPositionals: true,
      options: {
        name: { type: "string", default: "service" },
        run: { type: "string" },
        build: { type: "string" },
        lines: { type: "string", default: "50" },
        format: { type: "string", default: "json" },
        "ready-ms": { type: "string", default: "10000" },
      },
    })
  : { values: { name: "service", lines: "50", format: "json", "ready-ms": "10000" } as Record<string, string | undefined>, positionals: [] };
const name = flags.name ?? "service";
const text = flags.format === "text";
const paths = {
  pid: `tmp/${name}.pid`,
  stdout: `var/log/${name}.stdout`,
  stderr: `var/log/${name}.stderr`,
  build: `var/log/${name}.build`,
};
const LINE = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) ([A-Z]+) (.*)$/;
const FIELD = /\s([^\s=]+)=("(?:[^"\\]|\\.)*"|[^\s"=]+)$/;

/** One log line: `<ISO-8601> <LEVEL> <message> key=value…`; a JSON-quoted value is decoded. Other lines (stack traces,
 * tool output) keep the previous line's timestamp, so they sort with it, and have no level. */
export function parse(line: string, stream: Entry["stream"], previous: string | null): Entry {
  const m = LINE.exec(line);
  if (!m) return { ts: previous, stream, level: null, msg: line, fields: {} };
  let msg = " " + m[3];
  const fields: Record<string, string> = {};
  for (let f = FIELD.exec(msg); f; f = FIELD.exec(msg)) {
    fields[f[1]] = f[2].startsWith('"') ? (JSON.parse(f[2]) as string) : f[2];
    msg = msg.slice(0, f.index);
  }
  return { ts: m[1], stream, level: m[2], msg: msg.trim(), fields: Object.fromEntries(Object.entries(fields).reverse()) };
}

/** The last lines of a file within its final 1 MiB: the logs are appended across restarts and only grow. */
function lines(path: string): string[] {
  if (!existsSync(path)) return [];
  const size = statSync(path).size;
  const length = Math.min(size, 1 << 20);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  readSync(fd, buffer, 0, length, size - length);
  closeSync(fd);
  const all = buffer.toString("utf8").split("\n");
  return (length < size ? all.slice(1) : all).filter(Boolean);
}

function entries(stream: Entry["stream"]): Entry[] {
  const out: Entry[] = [];
  for (const line of lines(paths[stream])) {
    if (line) out.push(parse(line, stream, out.at(-1)?.ts ?? null));
  }
  return out;
}

/** Both streams merged by timestamp; each stream keeps its own order, so a trace stays below its line. */
export function merge(a: Entry[], b: Entry[]): Entry[] {
  const out: Entry[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const takeA = j >= b.length || (i < a.length && (a[i].ts ?? "") <= (b[j].ts ?? ""));
    out.push(takeA ? a[i++] : b[j++]);
  }
  return out;
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function pidOf(): number | null {
  if (!existsSync(paths.pid)) return null;
  const pid = Number(readFileSync(paths.pid, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

const tail = (path: string, n: number) => lines(path).slice(-n);

/** The URL of the newest `listening` line written since `since`, or null. */
function url(since: string) {
  const line = entries("stdout").findLast((e) => e.ts !== null && e.ts >= since && /\blistening\b/.test(e.msg));
  return line ? (line.fields.url ?? /https?:\/\/\S+/.exec(line.msg)?.[0] ?? null) : null;
}

function status(): { report: Report; code: number } {
  const pid = pidOf();
  if (pid === null) return { report: { service: name, state: "stopped" }, code: 0 };
  const since = new Date(statSync(paths.pid).mtimeMs - 1000).toISOString();
  if (alive(pid)) {
    const startedAt = statSync(paths.pid).mtime.toISOString();
    return { report: { service: name, state: "running", pid, url: url(since), startedAt, logs: [paths.stdout, paths.stderr] }, code: 0 };
  }
  return { report: { service: name, state: "dead", pid, stderr: tail(paths.stderr, 3), fix: "make log" }, code: 1 };
}

function print(report: Report) {
  if (!text) return console.log(JSON.stringify(report));
  const { service: _service, state, ...rest } = report;
  const scalars = Object.entries(rest).filter(([, v]) => v !== null && typeof v !== "object");
  console.log([state, ...scalars.map(([k, v]) => `${k}=${v}`)].join(" "));
  // Captured output (stderr of a dead service, a failed build) follows, indented; the log paths stay in the JSON.
  for (const v of [rest.stderr, rest.output]) if (Array.isArray(v)) for (const l of v) console.log("  " + l);
}

async function start(): Promise<number> {
  const now = status();
  if (now.report.state === "running") return (print({ ...now.report, started: false }), 0);
  if (!existsSync(".env")) return (print({ service: name, state: "unconfigured", error: ".env is missing", fix: "make setup" }), 6);
  const run = flags.run;
  if (!run) return (print({ service: name, state: "unconfigured", error: "--run is unset" }), 6);
  mkdirSync("var/log", { recursive: true });
  mkdirSync("tmp", { recursive: true });
  if (flags.build) {
    const log = openSync(paths.build, "w");
    const built = spawnSync("sh", ["-c", flags.build], { stdio: ["ignore", log, log] });
    closeSync(log);
    if (built.status !== 0)
      return (print({ service: name, state: "build-failed", log: paths.build, output: tail(paths.build, 20), fix: "make build" }), 1);
  }
  const since = new Date().toISOString();
  const out = openSync(paths.stdout, "a");
  const err = openSync(paths.stderr, "a");
  // detached: the service leads its own process group, so stop can signal the group and an SSH drop cannot kill it.
  const child = spawn("sh", ["-c", run], { detached: true, stdio: ["ignore", out, err] });
  closeSync(out);
  closeSync(err);
  child.unref();
  if (!child.pid) return (print({ service: name, state: "dead", error: "spawn failed", fix: "make log" }), 1);
  writeFileSync(paths.pid, String(child.pid) + "\n");
  // Ready when it logs `listening`; a service that never does counts as running after the wait.
  for (let end = Date.now() + Number(flags["ready-ms"]); Date.now() < end; await pause(100)) {
    if (!alive(child.pid)) break;
    if (url(since)) break;
  }
  const after = status();
  print(after.report.state === "running" ? { ...after.report, started: true } : after.report);
  return after.code;
}

async function stop(): Promise<number> {
  const pid = pidOf();
  let signal: string | null = null;
  const was = pid === null ? "stopped" : alive(pid) ? "running" : "dead";
  if (pid !== null && was === "running") {
    const group = (sig: NodeJS.Signals) => {
      try {
        process.kill(-pid, sig);
      } catch {
        if (alive(pid)) process.kill(pid, sig);
      }
    };
    signal = "TERM";
    group("SIGTERM");
    for (let i = 0; i < 50 && alive(pid); i++) await pause(100);
    if (alive(pid)) {
      signal = "KILL";
      group("SIGKILL");
    }
  }
  rmSync(paths.pid, { force: true });
  print({ service: name, state: "stopped", was, pid, signal });
  return 0;
}

function log(): number {
  const all = merge(entries("stdout"), entries("stderr"));
  if (!all.length) {
    console.error(`no logs for ${name} in ${paths.stdout} or ${paths.stderr}`);
    return 0;
  }
  for (const e of all.slice(-Number(flags.lines))) {
    if (!text) console.log(JSON.stringify(e));
    else {
      const fields = Object.entries(e.fields).map(([k, v]) => ` ${k}=${/^[^\s"=]+$/.test(v) ? v : JSON.stringify(v)}`);
      console.log(`${e.stream === "stderr" ? "err" : "out"} ${e.ts ?? "-"} ${e.level ?? ""} ${e.msg}${fields.join("")}`);
    }
  }
  return 0;
}

const verbs: Record<string, () => number | Promise<number>> = {
  start,
  stop,
  status: () => {
    const now = status();
    print(now.report);
    return now.code;
  },
  log,
};
if (import.meta.main) {
  const verb = verbs[positionals[0] ?? ""];
  if (!verb) {
    console.error("usage: node scripts/service.ts start|stop|status|log --name <service> [--run <cmd>] [--build <cmd>]");
    process.exit(2);
  }
  process.exitCode = await verb();
}
