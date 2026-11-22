import { test, expect } from "bun:test";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HandlePool } from "../src/pool.js";

test("active real file handles survive contention, and failed opens allow retries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "backplane-pool-"));
  const pool = new HandlePool((name) => open(join(dir, name), "a+"), 1);
  try {
    await expect(pool.use("missing/inner", (f) => f.stat())).rejects.toThrow();
    let release!: () => void, started!: () => void;
    const pin = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = pool.use("first", async (f) => {
      started();
      await pin;
      return f.stat();
    });
    await ready;
    const ino = await pool.use("first", async (f) => (await f.stat()).ino);
    await expect(pool.use("second", (f) => f.stat())).rejects.toMatchObject({
      code: "BUSY",
      status: 503,
    });
    release();
    expect((await first).ino).toBe(ino);
    await pool.use("second", async (f) => {
      await f.writeFile("two");
    });
    expect((await pool.use("first", (f) => f.stat())).ino).toBe(ino);
    await pool.close();
    await expect(pool.use("first", (f) => f.stat())).rejects.toThrow("closing");
  } finally {
    await pool.close();
    await rm(dir, { recursive: true, force: true });
  }
});
