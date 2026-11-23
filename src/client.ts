/** VERIFIED: Headers are scoped to this connection and sent on the first schema fetch. The stock defuss-rpc 3.0.0 discovery fetch omits them. */
import { DSON } from "defuss-dson";
import type { Document, NewDocument } from "defuss-db";
import type { CacheResult } from "./cache.js";
import type { Row, Query } from "./db.js";
import type {
  VfsDownload,
  VfsHead,
  VfsListRequest,
  VfsObject,
  VfsPage,
  VfsRange,
  VfsRead,
} from "./vfs.js";
import type { Queue } from "defuss-scheduler";
import { settings } from "./config.js";

import { BackplaneError, statuses, type ErrorCode } from "./errors.js";
import type {
  CacheWriteOptions,
  Versioned,
  WriteOptions,
} from "./revisions.js";
export { BackplaneError };
export type { ErrorCode, CacheWriteOptions, Versioned, WriteOptions };
export type { Scope } from "./scope.js";
export type {
  Change,
  Claim,
  ClaimResult,
  Definition,
  Lease,
  Outcome,
  Page,
  PageOptions,
  Patch,
  Queue,
  Run,
  Schedule,
} from "defuss-scheduler";
export type { CacheResult } from "./cache.js";
export type { Row, InputRow, Query } from "./db.js";
export type {
  VfsDownload,
  VfsHead,
  VfsListRequest,
  VfsObject,
  VfsPage,
  VfsRange,
  VfsRead,
} from "./vfs.js";
/** Upload sources. An async iterable such as a Node.js file stream becomes a web stream before `fetch` sends it.
 * VERIFIED by the packed consumer's type check: with the default DOM library, the stream from `Readable.toWeb` is not
 * assignable to the global `ReadableStream`, while every Node.js readable is an async iterable. */
export type UploadBody =
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>
  | Blob
  | Uint8Array
  | string;
function sendable(body: UploadBody) {
  if (
    typeof body === "string" ||
    body instanceof Uint8Array ||
    body instanceof Blob ||
    body instanceof ReadableStream
  )
    return body;
  const chunks = body[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    async cancel(reason) {
      await chunks.return?.(reason);
    },
  });
}

export async function connectBackplane(options: {
  app: string;
  apiKey?: string;
  port?: number;
}) {
  const { app } = options;
  const { base, apiKey } = settings(options);
  const headers = {
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json",
  };
  async function failure(response: Response) {
    const body = await response.text();
    let fault: { code?: ErrorCode; error?: string } = {};
    try {
      fault = JSON.parse(body) ?? {};
    } catch {
      /* Older or non-JSON server. */
    }
    return new BackplaneError(
      fault.code && Object.hasOwn(statuses, fault.code)
        ? fault.code
        : "INTERNAL_ERROR",
      typeof fault.error === "string"
        ? fault.error
        : "Backplane HTTP " + response.status,
      response.status,
    );
  }
  async function post(path: string, body?: string) {
    const response = await fetch(base + path, {
      method: "POST",
      headers,
      body,
      redirect: "error",
    });
    if (!response.ok) throw await failure(response);
    return response;
  }
  const schema: { moduleName?: string; methods: Record<string, unknown> }[] =
    await (await post("/rpc/schema")).json();
  const methods = new Set(
    schema.flatMap((m) =>
      Object.keys(m.methods).map((k) => m.moduleName + "." + k),
    ),
  );
  function ensure(method: string) {
    if (!methods.has(method))
      throw new Error("Method missing from server schema");
  }
  async function call<T>(
    className: string,
    methodName: string,
    args: unknown[],
  ): Promise<T> {
    ensure(className + "." + methodName);
    const response = await post(
      "/rpc",
      DSON.stringify({ className, methodName, args }),
    );
    return DSON.parse(await response.text()) as T;
  }
  return {
    tenant(tenant: string) {
      return {
        cache(bucket: string) {
          const scope = { app, tenant, bucket };
          return {
            get: (key: string) =>
              call<CacheResult>("cache", "get", [scope, key]),
            getVersioned: (key: string) =>
              call<Versioned<unknown>>("cache", "getVersioned", [scope, key]),
            set: (
              key: string,
              value: unknown,
              ttlMs?: number | CacheWriteOptions,
            ) => call<boolean>("cache", "set", [scope, key, value, ttlMs]),
            delete: (key: string, options?: WriteOptions) =>
              call<boolean>("cache", "delete", [scope, key, options]),
          };
        },
        db<T extends Document = Row>(bucket: string) {
          const scope = { app, tenant, bucket };
          return {
            get: (id: T["id"]) => call<T | null>("db", "get", [scope, id]),
            getVersioned: (id: T["id"]) =>
              call<Versioned<T>>("db", "getVersioned", [scope, id]),
            insert: (doc: NewDocument<T>, options?: { ifRevision?: null }) =>
              call<T["id"]>("db", "insert", [scope, doc, options]),
            update: (
              id: T["id"],
              patch: Partial<Omit<T, "id">>,
              options?: WriteOptions,
            ) => call<boolean>("db", "update", [scope, id, patch, options]),
            delete: (id: T["id"], options?: WriteOptions) =>
              call<boolean>("db", "delete", [scope, id, options]),
            query: (request: Query = {}) =>
              call<{ rows: Partial<T>[] }>("db", "query", [scope, request]),
          };
        },
        /** One scheduler queue. It is also a defuss-scheduler WorkerPort, so `startWorker` accepts it. Against a
         * daemon started without BACKPLANE_SCHEDULER=1, every call rejects with "Method missing from server schema". */
        scheduler(bucket: string): Queue {
          const scope = { app, tenant, bucket };
          const method =
            <K extends keyof Queue>(name: K) =>
            (...args: Parameters<Queue[K]>) =>
              call<Awaited<ReturnType<Queue[K]>>>("scheduler", name, [
                scope,
                ...args,
              ]);
          return {
            create: method("create"),
            get: method("get"),
            list: method("list"),
            update: method("update"),
            pause: method("pause"),
            resume: method("resume"),
            remove: method("remove"),
            getRun: method("getRun"),
            listRuns: method("listRuns"),
            scheduleHistory: method("scheduleHistory"),
            runHistory: method("runHistory"),
            terminate: method("terminate"),
            claim: method("claim"),
            renew: method("renew"),
            complete: method("complete"),
            fail: method("fail"),
          };
        },
        vfs(bucket: string) {
          const scope = { app, tenant, bucket };
          const object = (key: string) =>
            base +
            "/vfs/object?" +
            new URLSearchParams({ app, tenant, bucket, key });
          return {
            put: (key: string, data: string | Uint8Array, options?: WriteOptions) =>
              call<VfsObject>("vfs", "put", [scope, key, data, options]),
            get: (key: string, range?: VfsRange) =>
              call<VfsRead>("vfs", "get", [scope, key, range]),
            head: (key: string) => call<VfsHead>("vfs", "head", [scope, key]),
            list: (request: VfsListRequest = {}) =>
              call<VfsPage>("vfs", "list", [scope, request]),
            delete: (key: string, options?: WriteOptions) =>
              call<boolean>("vfs", "delete", [scope, key, options]),
            /** Streams `body` into one object, which replaces the previous one only after the last byte arrives. */
            async upload(
              key: string,
              body: UploadBody,
              options: WriteOptions = {},
            ): Promise<VfsObject> {
              ensure("vfs.put");
              const condition: Record<string, string> =
                options.ifRevision === null
                  ? { "If-None-Match": "*" }
                  : typeof options.ifRevision === "string"
                    ? { "If-Match": '"' + options.ifRevision + '"' }
                    : {};
              const response = await fetch(object(key), {
                method: "PUT",
                headers: {
                  Authorization: headers.Authorization,
                  "Content-Type": "application/octet-stream",
                  ...condition,
                },
                body: sendable(body),
                duplex: "half",
                redirect: "error",
              } as RequestInit);
              if (!response.ok) throw await failure(response);
              return response.json();
            },
            /** Opens one object version as a byte stream. Read or cancel the stream to release it on the daemon. */
            async download(key: string): Promise<VfsDownload> {
              // The schema check tells a missing object apart from a daemon without the VFS service.
              ensure("vfs.get");
              const response = await fetch(object(key), {
                headers: { Authorization: headers.Authorization },
                redirect: "error",
              });
              if (response.status === 404) {
                await response.body?.cancel();
                return { found: false, revision: null };
              }
              if (!response.ok || !response.body) throw await failure(response);
              return {
                found: true,
                key,
                size: Number(response.headers.get("content-length")),
                revision: (response.headers.get("etag") ?? "").slice(1, -1),
                mtimeMs: Number(response.headers.get("x-mtime-ms")),
                stream: response.body,
              };
            },
          };
        },
      };
    },
  };
}
