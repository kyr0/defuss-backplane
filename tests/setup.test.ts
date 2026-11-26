import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const key = (text: string) => /^BACKPLANE_AUTH_MASTER_KEY=(.*)$/m.exec(text)?.[1] ?? "";

// `make setup` ends with `make env`. It runs in a throwaway copy of the files it reads, so the repository's .env is
// never touched.
test("make env creates .env with both keys, gives an existing .env a missing master key, and never replaces one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "backplane-setup-"));
  const file = join(dir, ".env");
  const env = () => spawnSync("make", ["-s", "env"], { cwd: dir, encoding: "utf8" });
  const mode = async () => (await stat(file)).mode & 0o777;
  try {
    await mkdir(join(dir, "scripts"));
    for (const f of ["Makefile", ".env.example", "scripts/master-key.ts"]) await copyFile(join(repo, f), join(dir, f));
    expect(env().status).toBe(0);
    const created = await readFile(file, "utf8");
    expect(Buffer.from(key(created), "base64url").toString("base64url")).toBe(key(created));
    expect(Buffer.from(key(created), "base64url")).toHaveLength(32);
    expect(await mode()).toBe(0o600);
    expect(env().stdout).toContain("left unchanged");
    expect(await readFile(file, "utf8")).toBe(created);
    // A .env from before the key keeps its lines and gains the key at the end, still readable by its owner only.
    await writeFile(file, "API_KEY=abc\nPORT=43127");
    expect(env().stdout).toContain("added BACKPLANE_AUTH_MASTER_KEY");
    const upgraded = await readFile(file, "utf8");
    expect(upgraded).toMatch(/^API_KEY=abc\nPORT=43127\nBACKPLANE_AUTH_MASTER_KEY=[A-Za-z0-9_-]{43}\n$/);
    expect(await mode()).toBe(0o600);
    // An empty key line is filled where it stands.
    await writeFile(file, "BACKPLANE_AUTH_MASTER_KEY=\nAPI_KEY=abc\n");
    expect(env().status).toBe(0);
    expect(await readFile(file, "utf8")).toMatch(/^BACKPLANE_AUTH_MASTER_KEY=[A-Za-z0-9_-]{43}\nAPI_KEY=abc\n$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
