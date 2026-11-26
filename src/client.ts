/** VERIFIED: Each connection is a defuss-rpc client context with the bot key, so the application's `addHook()`
 * and `setHeaders()` never reach backplane calls. Its RPC client is typed with `BackplaneApi`, the namespace the daemon
 * serves, so every handle method is checked against the server's signature; plain defuss-rpc callers use the same type. VERIFIED by probe with 4.1.0: through the process-wide client, a
 * client guard of the application blocked a backplane call. Every failure is a `BackplaneError`. */
import { createRpcContext } from "defuss-rpc/client";
import { proxyPlugin } from "defuss-serve/plugins";
import type { Document, NewDocument } from "defuss-db";
import type { CacheResult } from "./cache.js";
import type { InputRow, Query, Row } from "./db.js";
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
import type { BackplaneApi } from "./api.js";
import type { Registration } from "./auth.js";
import type { NewBot } from "./bots.js";
import type {
  CacheWriteOptions,
  Versioned,
  WriteOptions,
} from "./revisions.js";
export { BackplaneError };
export type { BackplaneApi } from "./api.js";
export type { AuthMode, Member, NewApiKey, Registration } from "./auth.js";
export type { Bot, NewBot } from "./bots.js";
export type { CallbackCall } from "./callbacks.js";
export type { HostPrincipal } from "defuss-auth/host";
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
  // A bot key from bots.create starts with defuss-auth's `dfa_`; the root API_KEY travels as a bearer token.
  const authorization = (apiKey.startsWith("dfa_") ? "ApiKey " : "Bearer ") + apiKey;
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
  // Built from the schema in hand, so a connection sends one schema request.
  const rpc = await context.getRpcClient<BackplaneApi>({ schema });
  /** The streaming routes are no RPC methods; the schema still tells a daemon without the VFS service apart. */
  function ensure(method: string) {
    if (!methods.has(method))
      throw new Error("Method missing from server schema");
  }
  /** Every failure of a call becomes a BackplaneError. */
  const run = <T>(call: Promise<T>) => call.catch(rethrow);
  /** One log: the app's own, or one tenant's when `tenant` is given. The handle is also a defuss-logs batch writer, so
   * `createBatchSink(handle)` lets a defuss-logs logger in the application write here. VERIFIED by probe: DSON text
   * spells binary arguments at up to 3.6 times their encoded size, so a batch of at most 256 KiB stays under the
   * 1 MiB RPC body limit. */
  function logs(tenant?: string) {
    const scope = tenant === undefined ? { app } : { app, tenant };
    const write = (entries: readonly LogEntry[]) => run(rpc.logs.write(scope, entries));
    return {
      write,
      read: (request: LogReadRequest = {}): Promise<LogPage> => run(rpc.logs.read(scope, request)),
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
    auth: {
      /** Registers the app's user authentication with its public origin. */
      configure: (registration: Registration) => run(rpc.auth.configure({ app }, registration)),
      /** Whether auth is on and how the app registered, for debugging; it answers while auth is off. */
      status: () => run(rpc.auth.status({ app })),
      /** A defuss-serve plugin for the app's own listener that forwards its browser's `/auth/*` to this daemon, with
       * this connection's key in `X-Backplane-Key`. It mounts at `/auth` only, because the refresh cookie's path is
       * `/auth`. */
      proxy: () => proxyPlugin("/auth", `${base}/apps/${encodeURIComponent(app)}/auth`, { headers: { "X-Backplane-Key": apiKey }, name: "backplane-auth" }),
    },
    /** The backplane's bot users, for the root key or an admin bot. */
    bots: {
      create: (bot: NewBot) => run(rpc.bots.create(bot)),
      list: () => run(rpc.bots.list()),
      rotate: (id: string) => run(rpc.bots.rotate(id)),
      revoke: (id: string) => run(rpc.bots.revoke(id)),
    },
    /** The scheduled call a callback's `X-Backplane-Callback` token belongs to, while that call runs. */
    callbacks: {
      verify: (token: string) => run(rpc.callbacks.verify(token)),
    },
    tenant(tenant: string) {
      const members = { app, tenant };
      return {
        /** This tenant's log of the app. */
        logs: () => logs(tenant),
        /** The app's users and API keys in this tenant. */
        auth: {
          /** Who sent a request, from its `Authorization` field; fails unless the credential is live in this tenant. */
          authenticate: (authorization: string, options?: { claims?: string[]; anyClaims?: string[] }) =>
            run(rpc.auth.authenticate(members, authorization, options)),
          addMember: (member: { email: string; password?: string; claims?: string[] }) =>
            run(rpc.auth.addMember(members, member)),
          removeMember: (subjectId: string) => run(rpc.auth.removeMember(members, subjectId)),
          setPassword: (subjectId: string, password: string) => run(rpc.auth.setPassword(members, subjectId, password)),
          createApiKey: (key: { name: string; claims?: string[] }) => run(rpc.auth.createApiKey(members, key)),
          /** The tenant's members with email, status and claims; pass `next` as `after` for the next page. */
          members: (page?: { limit?: number; after?: string }) => run(rpc.auth.members(members, page)),
          listApiKeys: () => run(rpc.auth.listApiKeys(members)),
          revokeApiKey: (id: string) => run(rpc.auth.revokeApiKey(members, id)),
        },
        cache(bucket: string) {
          const scope = { app, tenant, bucket };
          return {
            get: (key: string): Promise<CacheResult> => run(rpc.cache.get(scope, key)),
            getVersioned: (key: string) => run(rpc.cache.getVersioned(scope, key)) as Promise<Versioned<unknown>>,
            set: (key: string, value: unknown, ttlMs?: number | CacheWriteOptions) =>
              run(rpc.cache.set(scope, key, value, ttlMs)),
            delete: (key: string, options?: WriteOptions) => run(rpc.cache.delete(scope, key, options)),
          };
        },
        db<T extends Document = Row>(bucket: string) {
          const scope = { app, tenant, bucket };
          return {
            // The daemon stores any document; `T` narrows what this handle reads and writes.
            get: (id: T["id"]) => run(rpc.db.get(scope, id)) as Promise<T | null>,
            getVersioned: (id: T["id"]) => run(rpc.db.getVersioned(scope, id)) as Promise<Versioned<T>>,
            insert: (doc: NewDocument<T>, options?: { ifRevision?: null }) =>
              run(rpc.db.insert(scope, doc as InputRow, options)) as Promise<T["id"]>,
            update: (id: T["id"], patch: Partial<Omit<T, "id">>, options?: WriteOptions) =>
              run(rpc.db.update(scope, id, patch, options)),
            delete: (id: T["id"], options?: WriteOptions) => run(rpc.db.delete(scope, id, options)),
            query: (request: Query = {}) => run(rpc.db.query(scope, request)) as Promise<{ rows: Partial<T>[] }>,
          };
        },
        /** One scheduler queue. It is also a defuss-scheduler WorkerPort, so `startWorker` accepts it. A schedule with
         * handler `_rpc` needs no worker: the daemon calls the app's RPC function named in its payload. */
        scheduler(bucket: string): Queue {
          const scope = { app, tenant, bucket };
          const method =
            <K extends keyof Queue>(name: K) =>
            (...args: Parameters<Queue[K]>) =>
              run<Awaited<ReturnType<Queue[K]>>>(
                (rpc.scheduler[name] as unknown as (...a: unknown[]) => Promise<Awaited<ReturnType<Queue[K]>>>)(scope, ...args),
              );
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
            put: (key: string, data: string | Uint8Array, options?: WriteOptions): Promise<VfsObject> =>
              run(rpc.vfs.put(scope, key, data, options)),
            get: (key: string, range?: VfsRange): Promise<VfsRead> => run(rpc.vfs.get(scope, key, range)),
            head: (key: string): Promise<VfsHead> => run(rpc.vfs.head(scope, key)),
            list: (request: VfsListRequest = {}): Promise<VfsPage> => run(rpc.vfs.list(scope, request)),
            delete: (key: string, options?: WriteOptions) => run(rpc.vfs.delete(scope, key, options)),
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
