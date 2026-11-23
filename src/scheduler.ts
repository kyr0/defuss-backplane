/** VERIFIED: RPC and MCP reach one defuss-scheduler authority through these methods, which take the scope first like
 * the cache, db and vfs services. */
import type { Queue, Scheduler } from "defuss-scheduler";
import { checkedScope, type Scope } from "./scope.js";

/** Every queue method. The record type fails the build if defuss-scheduler adds or removes one. */
const methods: Record<keyof Queue, true> = {
  create: true,
  get: true,
  list: true,
  update: true,
  pause: true,
  resume: true,
  remove: true,
  getRun: true,
  listRuns: true,
  scheduleHistory: true,
  runHistory: true,
  terminate: true,
  claim: true,
  renew: true,
  complete: true,
  fail: true,
};
export type ScopedQueue = {
  [K in keyof Queue]: (
    scope: Scope,
    ...args: Parameters<Queue[K]>
  ) => ReturnType<Queue[K]>;
};

export function schedulerApi(owner: Scheduler) {
  return Object.fromEntries(
    Object.keys(methods).map((name) => [
      name,
      (scope: Scope, ...args: unknown[]) => {
        const queue = owner.scope(checkedScope(scope));
        const method = queue[name as keyof Queue] as (
          ...input: unknown[]
        ) => Promise<unknown>;
        return method(...args);
      },
    ]),
  ) as ScopedQueue;
}
