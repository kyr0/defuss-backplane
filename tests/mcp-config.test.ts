import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expand, merge } from "../scripts/mcp-config.js";

const script = resolve(import.meta.dir, "../scripts/mcp-config.ts");
const backplane = ["--name", "defuss-backplane", "--url", "http://127.0.0.1:${PORT:-43127}/mcp", "--header", "Authorization: Bearer ${API_KEY}"];

function run(dir: string, args: string[]) {
  const r = spawnSync("node", [script, ...args], { cwd: dir, encoding: "utf8" });
  return { code: r.status, out: JSON.parse(r.stdout) };
}

test("writes a streamable-HTTP entry with the bot key into a new file with mode 600, and prints no secret", async () => {
  const dir = await mkdtemp(join(tmpdir(), "backplane-mcp-config-"));
  try {
    await writeFile(join(dir, ".env"), "API_KEY=k3y\nPORT=43999\n");
    const r = run(dir, [...backplane, "--out", ".mcp.json", "--out", "copy.json"]);
    expect(r).toEqual({ code: 0, out: { name: "defuss-backplane", url: "http://127.0.0.1:43999/mcp", headers: ["Authorization"], written: [".mcp.json", "copy.json"] } });
    for (const file of [".mcp.json", "copy.json"]) {
      expect(JSON.parse(await readFile(join(dir, file), "utf8"))).toEqual({
        mcpServers: { "defuss-backplane": { type: "http", url: "http://127.0.0.1:43999/mcp", headers: { Authorization: "Bearer k3y" } } },
      });
      expect((await stat(join(dir, file))).mode & 0o777).toBe(0o600);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("merges into an existing file, keeping other servers and keys, and uses the default port", async () => {
  const dir = await mkdtemp(join(tmpdir(), "backplane-mcp-config-"));
  try {
    await writeFile(join(dir, ".env"), "API_KEY=k3y\n");
    await writeFile(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { other: { type: "stdio", command: "x" } }, extra: 1 }), { mode: 0o644 });
    expect(run(dir, [...backplane, "--out", ".mcp.json"]).code).toBe(0);
    const config = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8"));
    expect(Object.keys(config.mcpServers)).toEqual(["other", "defuss-backplane"]);
    expect(config.extra).toBe(1);
    expect(config.mcpServers["defuss-backplane"].url).toBe("http://127.0.0.1:43127/mcp");
    expect((await stat(join(dir, ".mcp.json"))).mode & 0o777).toBe(0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing env file or an unset key fails with the fix and writes nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "backplane-mcp-config-"));
  try {
    expect(run(dir, [...backplane, "--out", ".mcp.json"])).toEqual({ code: 1, out: { name: "defuss-backplane", error: ".env is missing", fix: "make setup" } });
    await writeFile(join(dir, ".env"), "PORT=1\n");
    expect(run(dir, [...backplane, "--out", ".mcp.json"]).out.error).toBe("API_KEY is not set in the env file");
    expect(run(dir, ["--name", "x", "--url", "u", "--header", "no colon", "--out", "o"]).out.error).toContain("is not \"Name: value\"");
    expect(await Bun.file(join(dir, ".mcp.json")).exists()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("expand fills keys and defaults; merge replaces only its own entry", () => {
  expect(expand("${A}:${B:-2}", { A: "1" })).toBe("1:2");
  expect(expand("${B:-2}", { B: "3" })).toBe("3");
  expect(merge({ mcpServers: { a: 1, b: 2 } }, "b", { type: "http" })).toEqual({ mcpServers: { a: 1, b: { type: "http" } } });
});
