/** VERIFIED: Each connection is a defuss-rpc 4.4.0 client context with the bot key, so the application's `addHook()`
 * and `setHeaders()` never reach backplane calls. VERIFIED by probe with 4.1.0: through the process-wide client, a
 * client guard of the application blocked a backplane call. Every failure is a `BackplaneError`. */
import { createRpcContext } from "defuss-rpc/client";
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
import type { LogRecord } from "defuss-logs";
import type { LogEntry, LogPage, LogReadRequest } from "./logs.js";
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
export type { LogEntry, LogPage, LogReadRequest, LogScope } from "./logs.js";
export type { LogLevel, LogRecord } from "defuss-logs";
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
  const authorization = "Bearer " + apiKey;
  /** The daemon's error body `{ code, error }` as a `BackplaneError`. */
  function faultOf(status: number, body: string) {
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
      typeof fault.error === "string" ? fault.error : "Backplane HTTP " + status,
      status,
    );
  }
  const failure = async (response: Response) => faultOf(response.status, await response.text());
  /** A failed RPC or schema request carries `status` and `body` since defuss-rpc 4.2.0; network and guard errors stay
   * as they are. */
  function rethrow(error: unknown): never {
    const { status, body } = (error ?? {}) as { status?: unknown; body?: unknown };
    throw typeof status === "number" && typeof body === "string" ? faultOf(status, body) : error;
  }
  // A 307 would re-send a call's arguments to another address, where fetch drops only the Authorization header, so
  // every request of the context, the schema request included, refuses redirects.
  const context = createRpcContext({
    baseUrl: base,
    headers: { Authorization: authorization },
    fetch: (input, init) => fetch(input, { ...init, redirect: "error" }),
  });
  const schema = await context.getSchema().catch(rethrow);
  const methods = new Set(
    schema.flatMap((m) =>
      Object.keys(m.methods).map((k) => (m.kind === "module" ? m.moduleName : m.className) + "." + k),
    ),
  );
  type Caller = (...args: unknown[]) => Promise<unknown>;
  // Built from the schema in hand, so a connection sends one schema request.
  const rpc = await context.getRpcClient<Record<string, Record<string, Caller>>>({ schema });
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
    return (await rpc[className][methodName](...args).catch(rethrow)) as T;
  }
  /** One log: the app's own, or one tenant's when `tenant` is given. The handle is also a defuss-logs batch writer, so
   * `createBatchSink(handle)` lets a defuss-logs logger in the application write here. VERIFIED by probe: DSON text
   * spells binary arguments at up to 3.6 times their encoded size, so a batch of at most 256 KiB stays under the
   * 1 MiB RPC body limit. */
  function logs(tenant?: string) {
    const scope = tenant === undefined ? { app } : { app, tenant };
    const write = (entries: readonly LogEntry[]) =>
      call<{ written: number }>("logs", "write", [scope, entries]);
    return {
      write,
      read: (request: LogReadRequest = {}) => call<LogPage>("logs", "read", [scope, request]),
      maxIngestBatchRecords: 1000,
      maxIngestBatchBytes: 256 * 1024,
      maxLogRecordBytes: 256 * 1024,
      appendBatchAtomic: (records: readonly LogRecord[]) => write(records),
      async appendMany(records: Iterable<LogRecord>) {
        const all = [...records];
        let written = 0,
          batches = 0;
        for (let at = 0; at < all.length; at += 1000, batches++)
          written += (await write(all.slice(at, at + 1000))).written;
        return { written, batches };
      },
    };
  }
  return {
    /** The app's own log, for records that belong to no tenant. */
    logs: () => logs(),
    tenant(tenant: string) {
      return {
        /** This tenant's log of the app. */
        logs: () => logs(tenant),
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
        /** One scheduler queue. It is also a defuss-scheduler WorkerPort, so `startWorker` accepts it. A schedule with
         * handler `_rpc` needs no worker: the daemon calls the app's RPC function named in its payload. */
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
                  Authorization: authorization,
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
                headers: { Authorization: authorization },
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
                // Bun drops Content-Length from streamed bodies, so the daemon repeats it in x-size.
                size: Number(
                  response.headers.get("x-size") ?? response.headers.get("content-length"),
                ),
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
