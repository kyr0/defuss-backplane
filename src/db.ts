/** VERIFIED: Document buckets are defuss-db collections. Each document's revision token lives in a companion collection written in the same native transaction. */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createFileBackend } from "defuss-dbsonl/server";
import { openDatabase } from "defuss-db";
import type {
  Database,
  Document,
  FindRequest,
  PrimaryKey,
} from "defuss-db";
import { HandlePool } from "./pool.js";
import { address, checkedId, record, type Scope } from "./scope.js";
import { containsStore, directory } from "./storage.js";
import {
  options,
  checkRevision,
  legacyRevision,
  missing,
  type WriteOptions,
  type Versioned,
} from "./revisions.js";

export type Row = Document & Record<string, unknown>;
export type InputRow = Record<string, unknown> & { id?: PrimaryKey };
export type Query = Pick<
  FindRequest,
  "filters" | "sorters" | "offset" | "limit"
> & { projection?: string[] };
type Stamp = { id: PrimaryKey; token: string };
/** What `version` reads from a snapshot or a transaction. VERIFIED by tsc: defuss-db 3.3.0 overloads `collection` for
 * `_collections`, and TypeScript resolves no overload of a method called on the union of the two classes. */
type Reader = { collection(name: string): { get(id: PrimaryKey): Promise<unknown> } };

/** The companion revision collection. No encoded bucket name contains `_`, so no bucket can address it, and the
 * longest stamp name holds 61 of defuss-db's 64 code units. */
function stampName(name: string) {
  return name + "_rev";
}

export function createDb(root: string) {
  const stores = new HandlePool(
    async (path, create) =>
      openDatabase(
        await createFileBackend(create ? await directory(path) : path),
        { create },
      ),
    32,
    containsStore,
  );
  /** Runs `work` on the bucket's collection in the tenant's one database. An encoded bucket name fits a defuss-db
   * collection name, so it is the collection name. */
  function collection<R>(
    scope: Scope,
    work: (db: Database, name: string) => Promise<R>,
    absent?: () => R,
  ) {
    const { tenant, bucket } = address(root, scope);
    return stores.use(
      join(tenant, "db", "main"),
      (db) => work(db, bucket),
      absent,
    );
  }
  /** VERIFIED: A document written before 0.2 has no stamp. Its token derives from the scope, the typed ID and the
   * database identity, so it stays stable across reads and differs between databases holding the same ID. */
  async function version(
    view: Reader,
    name: string,
    id: PrimaryKey,
    scope: Scope,
    storeId: string,
  ): Promise<Versioned<Row>> {
    const value = (await view.collection(name).get(id)) as Row | undefined;
    if (value === undefined) return missing();
    const stamp = (await view.collection(stampName(name)).get(id)) as Stamp | undefined;
    return {
      found: true,
      value,
      revision: stamp?.token ?? legacyRevision(scope, id, storeId),
    };
  }
  /** Updates with `patch`, or deletes when it is undefined. The revision check and the write share one transaction.
   * VERIFIED: in the packed race test, exactly one of two writers holding the same token succeeds. */
  async function change(
    scope: Scope,
    id: PrimaryKey,
    patch: Record<string, unknown> | undefined,
    settings?: WriteOptions,
  ) {
    checkedId(id);
    const { ifRevision } = options(settings);
    return collection(
      scope,
      async (store, name) =>
        (
          await store.transaction(async (tx) => {
            if (ifRevision !== undefined)
              checkRevision(
                ifRevision,
                (await version(tx, name, id, scope, store.storeId)).revision,
              );
            const docs = tx.collection<Row>(name);
            const changed =
              patch === undefined
                ? await docs.delete(id)
                : await docs.update(id, patch);
            if (changed) {
              if (patch === undefined)
                await tx.collection<Stamp>(stampName(name)).delete(id);
              else
                await tx
                  .collection<Stamp>(stampName(name))
                  .put({ id, token: randomUUID() });
            }
            return changed;
          })
        ).result,
      () => {
        checkRevision(ifRevision, null);
        return false;
      },
    );
  }
  const api = {
    async insert(scope: Scope, document: InputRow, settings?: WriteOptions) {
      record(document, "document");
      if (document.id !== undefined) checkedId(document.id);
      const { ifRevision } = options(settings);
      if (typeof ifRevision === "string")
        throw new TypeError("Insert accepts only null for ifRevision");
      return collection(
        scope,
        async (store, name) =>
          (
            await store.transaction(async (tx) => {
              const docs = tx.collection<Row>(name);
              // A null token requires absence, so an existing ID is a revision conflict, not a duplicate key.
              if (
                ifRevision === null &&
                document.id !== undefined &&
                (await docs.has(document.id))
              )
                checkRevision(null, "present");
              const id = await docs.insert(document);
              await tx
                .collection<Stamp>(stampName(name))
                .put({ id, token: randomUUID() });
              return id;
            })
          ).result,
      );
    },
    async get(scope: Scope, id: PrimaryKey) {
      checkedId(id);
      return collection(
        scope,
        async (store, name) =>
          (await store.collection<Row>(name).get(id)) ?? null,
        () => null,
      );
    },
    async getVersioned(scope: Scope, id: PrimaryKey) {
      checkedId(id);
      return collection(
        scope,
        async (store, name) => {
          const snapshot = await store.snapshot();
          try {
            return await version(snapshot, name, id, scope, store.storeId);
          } finally {
            await snapshot.close();
          }
        },
        missing,
      );
    },
    async update(
      scope: Scope,
      id: PrimaryKey,
      patch: Record<string, unknown>,
      settings?: WriteOptions,
    ) {
      record(patch, "patch");
      if (Object.hasOwn(patch, "id"))
        throw new TypeError("A patch cannot change the document ID");
      return change(scope, id, patch, settings);
    },
    async delete(scope: Scope, id: PrimaryKey, settings?: WriteOptions) {
      return change(scope, id, undefined, settings);
    },
    async query(scope: Scope, request: Query = {}) {
      record(request, "request");
      const { filters, sorters, offset = 0, limit = 100, projection } = request;
      if (
        Object.keys(request).some(
          (k) =>
            !["filters", "sorters", "offset", "limit", "projection"].includes(
              k,
            ),
        )
      )
        throw new TypeError("Unsupported query field");
      if (
        !Number.isSafeInteger(limit) ||
        limit < 0 ||
        limit > 1000 ||
        !Number.isSafeInteger(offset) ||
        offset < 0
      )
        throw new TypeError(
          "Query requires limit 0..1000 and a nonnegative offset",
        );
      if (
        projection !== undefined &&
        (!Array.isArray(projection) ||
          !projection.every((k) => typeof k === "string"))
      )
        throw new TypeError("projection must be an array of field names");
      if (
        (filters !== undefined && !Array.isArray(filters)) ||
        (sorters !== undefined && !Array.isArray(sorters))
      )
        throw new TypeError("filters and sorters must be arrays");
      const rows = await collection(
        scope,
        (store, name) =>
          store.collection<Row>(name).find({ filters, sorters, offset, limit }),
        () => [],
      );
      return {
        rows: projection
          ? rows.map((row) =>
              Object.fromEntries(
                projection
                  .filter((k) => Object.hasOwn(row, k))
                  .map((k) => [k, row[k]]),
              ),
            )
          : rows,
      };
    },
  };
  return { api, handles: () => stores.stats(), close: () => stores.close() };
}
