/** VERIFIED: Cache buckets are DBSONL stores, one per app, tenant and bucket. Conditional writes compare and write inside one DBSONL transaction. */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openDbsonl, type Lookup } from "defuss-dbsonl";
import { createFileBackend } from "defuss-dbsonl/server";
import { HandlePool } from "./pool.js";
import { address, checkedKey, type Scope } from "./scope.js";
import { containsStore, directory } from "./storage.js";
import {
  options,
  checkRevision,
  legacyRevision,
  missing,
  type CacheWriteOptions,
  type WriteOptions,
  type Versioned,
} from "./revisions.js";

export type CacheResult = { hit: false } | { hit: true; value: unknown };
type CacheEntry = { value: unknown; expires: number | null; token?: string };

export function createCache(root: string) {
  const stores = new HandlePool(
    async (path, create) =>
      openDbsonl<CacheEntry>(
        await createFileBackend(create ? await directory(path) : path),
        "entries",
        { create },
      ),
    32,
    containsStore,
  );
  function storePath(scope: Scope) {
    const { tenant, bucket } = address(root, scope);
    return join(tenant, "cache", bucket);
  }
  /** VERIFIED: An expired entry reads as a miss but stays on disk until an overwrite or delete, so a read never
   * writes. A v0.1 entry has no token; its revision derives from its address and DBSONL's persisted entry
   * revision, which stays stable across reads without a migration write. */
  function current(
    scope: Scope,
    id: string,
    entry: Lookup<CacheEntry>,
  ): Versioned<unknown> {
    if (
      !entry.found ||
      (entry.value.expires !== null && entry.value.expires <= Date.now())
    )
      return missing();
    return {
      found: true,
      value: entry.value.value,
      revision: entry.value.token ?? legacyRevision(scope, id, entry.revision),
    };
  }
  function read(scope: Scope, cacheKey: string) {
    const id = checkedKey(cacheKey);
    return stores.use(
      storePath(scope),
      async (store) => current(scope, id, await store.get(id)),
      missing,
    );
  }
  const api = {
    async get(scope: Scope, cacheKey: string): Promise<CacheResult> {
      const entry = await read(scope, cacheKey);
      return entry.found ? { hit: true, value: entry.value } : { hit: false };
    },
    getVersioned: read,
    async set(
      scope: Scope,
      cacheKey: string,
      value: unknown,
      settings?: number | CacheWriteOptions,
    ) {
      if (arguments.length < 3)
        throw new TypeError("A cache value is required");
      const id = checkedKey(cacheKey);
      const { ttlMs, ifRevision } = options(
        typeof settings === "number" ? { ttlMs: settings } : settings,
        true,
      );
      if (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || ttlMs < 0))
        throw new TypeError(
          "ttlMs must be a nonnegative safe integer in range",
        );
      const expires = ttlMs === undefined ? null : Date.now() + ttlMs;
      if (expires !== null && !Number.isSafeInteger(expires))
        throw new TypeError(
          "ttlMs must be a nonnegative safe integer in range",
        );
      const entry = { value, expires, token: randomUUID() };
      return stores.use(
        storePath(scope),
        async (store) => {
          if (ifRevision === undefined) await store.put(id, entry);
          else
            await store.transaction(async (tx) => {
              checkRevision(
                ifRevision,
                current(scope, id, await tx.get(id)).revision,
              );
              tx.put(id, entry);
            });
          return true;
        },
        // A token cannot match an absent store, so the conflict is reported without creating the store.
        typeof ifRevision === "string"
          ? () => {
              checkRevision(ifRevision, null);
              return false;
            }
          : undefined,
      );
    },
    async delete(scope: Scope, cacheKey: string, settings?: WriteOptions) {
      const id = checkedKey(cacheKey),
        { ifRevision } = options(settings);
      return stores.use(
        storePath(scope),
        async (store) => {
          if (ifRevision === undefined) await store.delete(id);
          else
            await store.transaction(async (tx) => {
              const entry = await tx.get(id);
              checkRevision(ifRevision, current(scope, id, entry).revision);
              if (entry.found) tx.delete(id);
            });
          return true;
        },
        // Deleting from an absent store succeeds without creating it; a token still conflicts.
        () => {
          checkRevision(ifRevision, null);
          return true;
        },
      );
    },
  };
  return { api, close: () => stores.close() };
}
