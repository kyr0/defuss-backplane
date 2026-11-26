/** VERIFIED: Reusing one disk root across fresh processes checks both restart durability and interchange between runtimes. */
import { openDatabase } from "defuss-db";
import { createFileBackend } from "defuss-dbsonl/server";
import { openFileLogStore } from "defuss-logs/server";
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  copyFile,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { request } from "node:http";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";

const exec = promisify(execFile);
const tmp = await mkdtemp(join(tmpdir(), "backplane-consumer-"));
const tarball = await realpath("output/defuss-backplane-0.3.0.tgz");
const fixture = resolve("input/acceptance.json");
const cli = join(tmp, "node_modules/defuss-backplane/dist/cli.js");
const consumerScripts = [
  "consumer.ts",
  "consumer-revisions.ts",
  "consumer-types.ts",
  "consumer-vfs.ts",
  "consumer-scheduler.ts",
  "consumer-mcp.ts",
  "consumer-equivalence.ts",
  "consumer-auth.ts",
  ...["run", "drivers", "kit", "auth", "cache", "db", "logs", "scheduler", "vfs", "http", "big", "video"].map((m) => `deep/${m}.ts`),
];
const bot = randomBytes(32).toString("hex");
const masterKey = randomBytes(32).toString("base64url");
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const address = listener.address();
if (!address || typeof address === "string")
  throw new Error("Port probe has no TCP address");
const port = address.port;
await new Promise((done) => listener.close(done));
const env = {
  ...process.env,
  API_KEY: bot,
  PORT: String(port),
  BACKPLANE_DATA_DIR: join(tmp, "data"),
};
const daemonEnv: NodeJS.ProcessEnv = { ...env };
for (const k of ["API_KEY", "PORT", "BACKPLANE_DATA_DIR", "BACKPLANE_CALLBACK_ORIGINS", "BACKPLANE_AUTH_MASTER_KEY"])
  delete daemonEnv[k];
const observed: Record<string, unknown>[] = [];
/** Matches the rejection of a promisified execFile that exited with `code` and printed `stderr`. */
const failedWith = (code: number, stderr: RegExp) => (error: unknown) => {
  const { code: actual, stderr: output } = error as {
    code?: unknown;
    stderr?: unknown;
  };
  return actual === code && stderr.test(String(output));
};
async function exitCode(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null)
    return child.exitCode;
  return (await once(child, "exit"))[0];
}
/** Starts one daemon under `runtime` on the shared data root, then runs the consumer under the same runtime and its
 * peer. VERIFIED: one daemon per phase on one disk root checks restart durability and cross-runtime reads together.
 * A scheduling phase runs only the scheduler consumer, under the peer runtime. */
let daemons = 0;
async function runPhase(
  runtime: string,
  phase: string,
  previous: string,
  scheduling = false,
) {
  const peer = runtime === "bun" ? "node" : "bun";
  const child = spawn(runtime, [cli], {
    cwd: tmp,
    env: daemonEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (data) => (log += data));
  child.stderr.on("data", (data) => (log += data));
  try {
    for (let i = 0; !log.includes("INFO listening "); i++) {
      if (i >= 250 || child.exitCode !== null)
        throw new Error("Daemon startup: " + log);
      await pause(40);
    }
    assert.ok(log.includes("INFO listening http://127.0.0.1:" + port));
    daemons++;
    const url = "http://127.0.0.1:" + port;
    const schema = await exec("curl", [
      "-fsS",
      "-X",
      "POST",
      "-H",
      "Authorization: Bearer " + bot,
      url + "/rpc/schema",
    ]);
    const modules: { moduleName: string }[] = JSON.parse(schema.stdout);
    assert.deepEqual(
      modules.map((item) => item.moduleName).sort(),
      ["auth", "bots", "cache", "callbacks", "db", "logs", "scheduler", "vfs"],
    );
    if (scheduling) {
      const { stdout } = await exec(peer, ["consumer-scheduler.ts", phase], {
        cwd: tmp,
        env,
        timeout: 30000,
      });
      observed.push({ daemon: runtime, ...JSON.parse(stdout.trim()) });
      return;
    }
    const rpc = await exec("curl", [
      "-fsS",
      "-H",
      "Authorization: Bearer " + bot,
      "--json",
      JSON.stringify({
        className: "cache",
        methodName: "set",
        args: [
          { app: "curl", tenant: "local", bucket: "items" },
          "hello",
          phase,
        ],
      }),
      url + "/rpc",
    ]);
    assert.ok(rpc.stdout.length > 0);
    // A curl PUT streams a file larger than the 1 MiB RPC body limit, and a GET returns the same bytes.
    const object =
      url +
      "/vfs/object?" +
      new URLSearchParams({
        app: "curl",
        tenant: "local",
        bucket: "files",
        key: "uploads/" + phase + ".bin",
      });
    const sent = join(tmp, phase + "-sent.bin"),
      received = join(tmp, phase + "-received.bin");
    await writeFile(sent, randomBytes(1536 * 1024));
    const put = await exec("curl", [
      "-fsS",
      "-T",
      sent,
      "-H",
      "Authorization: Bearer " + bot,
      object,
    ]);
    assert.equal(JSON.parse(put.stdout).size, 1536 * 1024);
    await exec("curl", [
      "-fsS",
      "-o",
      received,
      "-H",
      "Authorization: Bearer " + bot,
      object,
    ]);
    assert.deepEqual(await readFile(received), await readFile(sent));
    // The files route serves the same object over plain HTTP: curl asks for one byte range, as a seeking player does.
    const ranged = await exec("curl", [
      "-fsS",
      "-D",
      "-",
      "-o",
      received,
      "-r",
      "1048570-1048585",
      "-H",
      "Authorization: Bearer " + bot,
      url + "/files/curl/local/files/uploads/" + phase + ".bin",
    ]);
    assert.match(ranged.stdout, /^HTTP\/1\.1 206/);
    assert.match(ranged.stdout, /content-range: bytes 1048570-1048585\/1572864/i);
    assert.deepEqual(
      await readFile(received),
      (await readFile(sent)).subarray(1048570, 1048586),
    );
    assert.equal((await fetch(url + "/mcp", { method: "POST" })).status, 401);
    // A supervisor polls the probes without the key; the scrape needs it and counts the curl calls above.
    for (const probe of ["/health", "/healthz", "/livez", "/readyz"])
      assert.equal(JSON.parse((await exec("curl", ["-fsS", url + probe])).stdout).status, "pass");
    const scrape = await exec("curl", ["-fsS", "-H", "Authorization: Bearer " + bot, url + "/metrics"]);
    assert.match(
      scrape.stdout,
      /^backplane_operation_duration_count\{module="cache",method="set",app="curl",code="OK"[^}]*\} 1$/m,
    );
    assert.match(scrape.stdout, /^http_server_request_duration_count\{endpoint="files",[^}]*"206"[^}]*\} 1$/m);
    await assert.rejects(
      // Its own data root, because the scheduler's lock on the shared one would stop it before it binds.
      exec(runtime, [cli], { cwd: tmp, env: { ...daemonEnv, BACKPLANE_DATA_DIR: join(tmp, "busy-port") }, timeout: 8000 }),
      failedWith(1, /EADDRINUSE|port .* in use/i),
    );
    // VERIFIED: lsof prints `*:<port>` for IPv4 and IPv6 wildcard listeners. A connect probe to 127.0.0.2 cannot
    // discriminate on the macOS development host: the address is unassigned, so both kinds of listener time out.
    const sockets = await exec("lsof", [
      "-nP",
      "-a",
      "-p",
      String(child.pid),
      "-iTCP",
      "-sTCP:LISTEN",
      "-Fn",
    ]);
    assert.deepEqual(
      sockets.stdout.split("\n").filter((line) => line.startsWith("n")),
      ["n127.0.0.1:" + port],
      "daemon listeners",
    );
    const { stdout } = await exec(
      runtime,
      ["consumer.ts", phase, previous, fixture],
      { cwd: tmp, env, timeout: 30000 },
    );
    observed.push({ daemon: runtime, ...JSON.parse(stdout.trim()) });
    const mixed = await exec(
      peer,
      ["consumer.ts", phase + "-peer", phase, fixture],
      { cwd: tmp, env, timeout: 30000 },
    );
    observed.push({ daemon: runtime, ...JSON.parse(mixed.stdout.trim()) });
    // Every MCP tool against its RPC method, through the client config that make mcp-config wrote.
    const twins = await exec(runtime, ["consumer-equivalence.ts", phase], { cwd: tmp, env, timeout: 30000 });
    observed.push({ daemon: runtime, ...JSON.parse(twins.stdout.trim()) });
    // Auth and bot users through a defuss-serve proxy, on each daemon runtime.
    const authed = await exec(peer, ["consumer-auth.ts", phase], { cwd: tmp, env, timeout: 60000 });
    observed.push({ daemon: runtime, ...JSON.parse(authed.stdout.trim()) });
    // The deep suite once, against this Node.js daemon, whose pid bounds its memory during the 512 MiB transfer.
    if (phase === "node-first") {
      const deep = await exec(
        "node",
        ["deep/run.ts", "--mcp", "mcp.json", "--pid", String(child.pid), "--run", "e2e", "--report", resolve("output/deep.json")],
        { cwd: tmp, env, timeout: 900000, maxBuffer: 16 * 1024 * 1024 },
      );
      observed.push({ daemon: runtime, deep: JSON.parse(deep.stdout.trim().split("\n").at(-1) ?? "{}") });
    }
    // VERIFIED by probe: a client that stops reading a download larger than the socket buffers keeps its connection
    // open. The SIGTERM below must still exit 0 within the deadline.
    const stalled =
      url +
      "/vfs/object?" +
      new URLSearchParams({
        app: "curl",
        tenant: "local",
        bucket: "files",
        key: "stalled.bin",
      });
    const auth = { Authorization: "Bearer " + bot };
    assert.equal(
      (
        await fetch(stalled, {
          method: "PUT",
          headers: auth,
          body: new Blob([new Uint8Array(64 * 1024 * 1024)]),
        })
      ).status,
      200,
    );
    await new Promise<void>((started) =>
      request(stalled, { headers: auth }, (res) => {
        res.on("error", () => {});
        res.once("data", () => {
          res.pause();
          started();
        });
      })
        .on("error", () => {})
        .end(),
    );
  } finally {
    child.kill("SIGTERM");
    const deadline = setTimeout(() => child.kill("SIGKILL"), 8000);
    try {
      assert.equal(await exitCode(child), 0, "daemon exit: " + log);
    } finally {
      clearTimeout(deadline);
    }
  }
}
try {
  await writeFile(
    join(tmp, "package.json"),
    JSON.stringify({
      name: "isolated-backplane-consumer",
      private: true,
      type: "module",
      dependencies: {
        "defuss-backplane": "file:" + tarball,
        "@modelcontextprotocol/client": "2.4.0",
        "playwright-core": "1.65.1",
        "defuss-serve": "0.5.0",
      },
    }),
  );
  await exec(
    "npm",
    [
      "install",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
    ],
    { cwd: tmp, timeout: 120000 },
  );
  await mkdir(join(tmp, "deep"), { recursive: true });
  await mkdir(join(tmp, "input"), { recursive: true });
  await copyFile("input/video.webm", join(tmp, "input/video.webm"));
  for (const name of consumerScripts)
    await copyFile(join("scripts", name), join(tmp, name));
  // The consumer scripts run unbuilt under Node.js type stripping, so the check also rejects non-erasable syntax.
  await exec(
    "node",
    [
      resolve("node_modules/typescript/bin/tsc"),
      "--strict",
      "--skipLibCheck",
      "--noEmit",
      "--target",
      "ES2024",
      "--module",
      "NodeNext",
      "--allowImportingTsExtensions",
      "--verbatimModuleSyntax",
      "--erasableSyntaxOnly",
      "--types",
      "node",
      "--typeRoots",
      resolve("node_modules/@types"),
      ...consumerScripts,
    ],
    { cwd: tmp, timeout: 30000 },
  );
  await assert.rejects(
    exec("node", [cli], {
      cwd: tmp,
      env: { ...daemonEnv, API_KEY: "" },
      timeout: 8000,
    }),
    failedWith(1, /API_KEY/),
  );
  await writeFile(
    join(tmp, ".env"),
    "API_KEY=" + bot + "\nPORT=" + port + "\nBACKPLANE_DATA_DIR=./data\nBACKPLANE_AUTH_MASTER_KEY=" + masterKey + "\n",
    { mode: 0o600 },
  );
  // The consumers connect to MCP from the file `make mcp-config` writes, with this daemon's .env as its input.
  const written = await exec("make", ["-s", "mcp-config", "MCP_ENV=" + join(tmp, ".env"), "MCP_OUT=" + join(tmp, "mcp.json")]);
  assert.deepEqual(JSON.parse(written.stdout), {
    name: "defuss-backplane",
    url: "http://127.0.0.1:" + port + "/mcp",
    headers: ["Authorization"],
    written: [join(tmp, "mcp.json")],
  });
  await runPhase("node", "node-first", "-");
  await rm(join(tmp, "node_modules"), { recursive: true, force: true });
  await exec("bun", ["install"], { cwd: tmp, timeout: 120000 });
  await runPhase("bun", "bun-second", "node-first");
  await runPhase("node", "node-last", "bun-second");
  await runPhase("node", "scheduler-write", "-", true);
  await runPhase("bun", "scheduler-read", "scheduler-write", true);
  const scope: { app: string; tenant: string; bucket: string } = JSON.parse(
    await readFile(fixture, "utf8"),
  );
  // A lowercase ASCII word keeps its spelling on disk, followed by `-` and the first 8 hex digits of its SHA-256.
  const part = (value: string) => value + "-" + createHash("sha256").update(value).digest("hex").slice(0, 8);
  const native = await openDatabase(
    await createFileBackend(
      join(tmp, "data", part(scope.app), part(scope.tenant), "db", "main"),
    ),
  );
  try {
    assert.deepEqual(
      await native.collection(part(scope.bucket)).get("bun-second"),
      { id: "bun-second", runtime: "bun-second" },
    );
  } finally {
    await native.close();
  }
  // Each daemon start and stop left one line in the daemon's own log, which no caller can address.
  const own = await openFileLogStore(join(tmp, "data", "_backplane", "logs"), "log");
  const lines: string[] = [];
  try {
    for await (const record of own.records()) lines.push(record.level + " " + record.message);
  } finally {
    await own.close();
  }
  assert.equal(lines.filter((line) => line === "info listening http://127.0.0.1:" + port).length, daemons);
  assert.equal(lines.filter((line) => line === "info stopping").length, daemons);
  const evidence = {
    version: "0.3.0",
    platform: process.platform,
    arch: process.arch,
    tarballSha256: createHash("sha256")
      .update(await readFile(tarball))
      .digest("hex"),
    installers: ["npm", "bun"],
    upstreamReadback: "defuss-db 3.3.0",
    phases: observed,
  };
  await mkdir("output", { recursive: true });
  await writeFile("output/e2e.json", JSON.stringify(evidence, null, 2) + "\n");
  process.stdout.write(JSON.stringify(evidence) + "\n");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
