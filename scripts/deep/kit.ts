/** VERIFIED: scripts/deep/run.ts passes it to every scenario. The context of one scenario run: the transport under
 * test, the RPC driver for setup that only RPC can do (native values, worker leases, streams), a bucket of its own and
 * a step recorder whose results become output/deep.json. */
import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { Fault, type Ops } from "./drivers.ts";

export type Result = { subsystem: string; via: string; step: string; ok: boolean; ms: number; error?: string };

export interface Ctx {
  ops: Ops;
  /** The RPC driver on the same tenant, for what MCP cannot carry. */
  rpc: Ops;
  /** The transport under test, bound to the daemon's own app `_backplane`. */
  own: Ops;
  /** The callback check over RPC, as the app of a scheduled call uses it while the call runs. */
  callbacks: { verify(token: string): Promise<Record<string, unknown>> };
  bucket: string;
  app: string;
  tenant: string;
  step(name: string, run: () => Promise<void>): Promise<void>;
}

export const results: Result[] = [];

/** Runs the steps of one scenario in order and stops at the first failure, because later steps build on its state. */
export function context(subsystem: string, base: Omit<Ctx, "step">, via: string = base.ops.via): Ctx & { failed(): boolean } {
  let failed = false;
  return {
    ...base,
    failed: () => failed,
    async step(name, run) {
      if (failed) return;
      const started = performance.now();
      try {
        await run();
        results.push({ subsystem, via, step: name, ok: true, ms: Math.round(performance.now() - started) });
      } catch (error) {
        failed = true;
        const text = error instanceof Error ? error.message : String(error);
        results.push({ subsystem, via, step: name, ok: false, ms: Math.round(performance.now() - started), error: text.slice(0, 800) });
      }
    },
  };
}

/** Asserts that `call` fails with `code` and `status`. */
export async function rejects(call: Promise<unknown>, code: string, status: number) {
  try {
    await call;
  } catch (e) {
    assert.ok(e instanceof Fault, "a Fault, got " + String(e));
    assert.deepEqual([e.code, e.status], [code, status], e.message);
    return;
  }
  assert.fail("expected " + code + " " + status + ", the call succeeded");
}

export const sleep = pause;
export { assert };
