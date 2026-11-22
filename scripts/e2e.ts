/** VERIFIED: Reusing one disk root across fresh processes checks both restart durability and interchange between runtimes. */
import { openDatabase } from "defuss-db";
import { createFileBackend } from "defuss-dbsonl/server";
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
  cp,
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
const tarball = await realpath("output/defuss-backplane-0.2.0.tgz");
const fixture = resolve("input/acceptance.json");
const cli = join(tmp, "node_modules/defuss-backplane/dist/cli.js");
const consumerScripts = [
  "consumer.ts",
  "consumer-revisions.ts",
  "consumer-types.ts",
  "consumer-vfs.ts",
];
const bot = randomBytes(32).toString("hex");
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
for (const k of ["API_KEY", "PORT", "BACKPLANE_DATA_DIR"]) delete daemonEnv[k];
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
 * peer. VERIFIED: one daemon per phase on one disk root checks restart durability and cross-runtime reads together. */
async function runPhase(runtime: string, phase: string, previous: string) {
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
    assert.deepEqual(modules.map((item) => item.moduleName).sort(), [
      "cache",
      "db",
      "vfs",
    ]);
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
    assert.equal((await fetch(url + "/mcp", { method: "POST" })).status, 401);
    await assert.rejects(
      exec(runtime, [cli], { cwd: tmp, env: daemonEnv, timeout: 8000 }),
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
    const peer = runtime === "bun" ? "node" : "bun";
    const mixed = await exec(
      peer,
      ["consumer.ts", phase + "-peer", phase, fixture],
      { cwd: tmp, env, timeout: 30000 },
    );
    observed.push({ daemon: runtime, ...JSON.parse(mixed.stdout.trim()) });
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
    "API_KEY=" + bot + "\nPORT=" + port + "\nBACKPLANE_DATA_DIR=./data\n",
    { mode: 0o600 },
  );
  await cp("input/v0.1.0", join(tmp, "data"), { recursive: true });
  await runPhase("node", "node-first", "-");
  await rm(join(tmp, "node_modules"), { recursive: true, force: true });
  await exec("bun", ["install"], { cwd: tmp, timeout: 120000 });
  await runPhase("bun", "bun-second", "node-first");
  await runPhase("node", "node-last", "bun-second");
  const scope: { app: string; tenant: string; bucket: string } = JSON.parse(
    await readFile(fixture, "utf8"),
  );
  const part = (value: string) => "x" + Buffer.from(value).toString("hex");
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
  const evidence = {
    version: "0.2.0",
    platform: process.platform,
    arch: process.arch,
    tarballSha256: createHash("sha256")
      .update(await readFile(tarball))
      .digest("hex"),
    installers: ["npm", "bun"],
    upgradeFixture: "v0.1.0 packed daemon",
    upstreamReadback: "defuss-db 3.1.0",
    phases: observed,
  };
  await mkdir("output", { recursive: true });
  await writeFile("output/e2e.json", JSON.stringify(evidence, null, 2) + "\n");
  process.stdout.write(JSON.stringify(evidence) + "\n");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
