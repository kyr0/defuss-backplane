/** VERIFIED: RPC and MCP reach one defuss-scheduler authority through these methods, which take the scope first like
 * the cache, db and vfs services. */
import type { Definition, Patch, Queue, Scheduler } from "defuss-scheduler";
import { callback, RPC_HANDLER } from "./callbacks.js";
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

/** A handler name starting with `_` is the daemon's: only `_rpc` exists, and no app worker may claim it. */
function handler(name: unknown) {
  if (typeof name === "string" && name.startsWith("_") && name !== RPC_HANDLER)
    throw new TypeError("Handler names starting with _ are reserved; use _rpc for an RPC callback");
}

/** Every queue method, with `_rpc` payloads checked when a schedule is created or changed, so a callback the daemon
 * would refuse fails at once instead of at its first occurrence. `origins` are the operator's callback origins. */
export function schedulerApi(owner: Scheduler, origins: ReadonlySet<string>) {
  const api = Object.fromEntries(
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
  return {
    ...api,
    create(scope, definition: Definition, ...rest) {
      handler(definition?.handler);
      if (definition?.handler === RPC_HANDLER) callback(definition.payload, origins);
      return api.create(scope, definition, ...rest);
    },
    async update(scope, id, patch: Patch, change) {
      handler(patch?.handler);
      if (patch?.handler === RPC_HANDLER || patch?.payload !== undefined) {
        const current = await api.get(scope, id);
        if ((patch.handler ?? current?.handler) === RPC_HANDLER)
          callback(patch.payload !== undefined ? patch.payload : current?.payload, origins);
      }
      return api.update(scope, id, patch, change);
    },
    claim(scope, input) {
      if (input?.handlers?.some((name) => typeof name === "string" && name.startsWith("_")))
        throw new TypeError("The daemon runs handlers starting with _ itself");
      return api.claim(scope, input);
    },
  } satisfies ScopedQueue;
}
