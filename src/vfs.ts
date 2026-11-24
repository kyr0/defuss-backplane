/** VERIFIED: VFS buckets are defuss-vfs volumes, one per app, tenant and bucket. Each conditional write compares the
 * object's content revision inside the volume transaction that publishes it. */
import { join } from "node:path";
import {
  createVfs,
  type ObjectHead,
  type Vfs,
  type WriteCondition,
} from "defuss-vfs";
import { BackplaneError } from "./errors.js";
import { HandlePool } from "./pool.js";
import { address, record, type Scope } from "./scope.js";
import { containsStore, directory } from "./storage.js";
import {
  options,
  checkRevision,
  conflict,
  type WriteOptions,
} from "./revisions.js";

/** Calls on `/rpc` and MCP return at most 1 MiB of object bytes. Larger objects use the streaming endpoint. */
const INLINE_LIMIT = 1024 * 1024;
const WINDOW = 256 * 1024;

export type VfsObject = {
  key: string;
  size: number;
  revision: string;
  mtimeMs: number;
};
type Absent = { found: false; revision: null };
const missing = (): Absent => ({ found: false, revision: null });
export type VfsHead = Absent | ({ found: true } & VfsObject);
export type VfsRead = Absent | ({ found: true; value: Uint8Array } & VfsObject);
export type VfsDownload =
  | Absent
  | ({ found: true; stream: ReadableStream<Uint8Array> } & VfsObject);
export type VfsRange = { offset?: number; length?: number };
export type VfsListRequest = {
  prefix?: string;
  after?: string | null;
  limit?: number;
};
export type VfsPage = { objects: VfsObject[]; nextAfter: string | null };
type Source =
  | Iterable<Uint8Array>
  | AsyncIterable<Uint8Array>
  | ReadableStream<Uint8Array>;

const allowed = (part: string) => part !== "" && part !== "." && part !== "..";
/** Checks a key before a volume opens, so an absent volume rejects the same keys an existing one does. A prefix may
 * be empty or end with `/`. defuss-vfs applies the same segment rules; the 1024-byte cap matches cache keys. */
export function objectKey(value: unknown, prefix = false) {
  if (
    typeof value !== "string" ||
    !value.isWellFormed() ||
    value.includes("\0") ||
    Buffer.byteLength(value) > 1024 ||
    (!prefix && !value) ||
    (value !== "" &&
      !value
        .split("/")
        .every(
          (part, i, all) =>
            allowed(part) || (prefix && part === "" && i === all.length - 1),
        ))
  )
    throw new TypeError(
      "VFS keys are relative paths of 1 to 1024 valid UTF-8 bytes without empty, . or .. segments",
    );
  return value;
}
function integer(value: unknown, name: string, min: number, max: number) {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    throw new TypeError(`${name} must be an integer from ${min} to ${max}`);
  return value as number;
}
function info({ key, size, revision, mtimeMs }: ObjectHead): VfsObject {
  return { key, size, revision, mtimeMs };
}
function condition(ifRevision: string | null | undefined): WriteCondition {
  if (ifRevision === undefined) return {};
  return ifRevision === null ? { ifAbsent: true } : { ifMatch: ifRevision };
}
/** A key without an object reads as absent. VERIFIED by probe: defuss-vfs reports ENOENT for a missing key, EISDIR for
 * a key that is a directory prefix of other keys, and ENOTDIR for a key below an existing object. */
function noObject(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR";
}
async function found<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch (error) {
    if (noObject(error)) return undefined;
    throw error;
  }
}

export function createVfsService(root: string) {
  const stores = new HandlePool<Vfs>(
    async (path, create) =>
      createVfs({ root: create ? await directory(path) : path }),
    32,
    containsStore,
  );
  function volume(scope: Scope) {
    const { tenant, bucket } = address(root, scope);
    return join(tenant, "vfs", bucket);
  }
  /** A token cannot match an absent volume, so the conflict is reported without creating the volume. */
  function write(
    scope: Scope,
    ifRevision: string | null | undefined,
    work: (vfs: Vfs) => Promise<ObjectHead>,
  ) {
    return stores.use(
      volume(scope),
      async (vfs) => info(await work(vfs)),
      typeof ifRevision === "string" ? conflict : undefined,
    );
  }
  const api = {
    async put(
      scope: Scope,
      key: string,
      data: string | Uint8Array,
      settings?: WriteOptions,
    ): Promise<VfsObject> {
      objectKey(key);
      if (typeof data !== "string" && !ArrayBuffer.isView(data))
        throw new TypeError("VFS data must be a string or binary");
      const { ifRevision } = options(settings);
      return write(scope, ifRevision, (vfs) =>
        vfs.objects.put(key, data, condition(ifRevision)),
      );
    },
    async get(scope: Scope, key: string, range: VfsRange = {}): Promise<VfsRead> {
      objectKey(key);
      record(range, "range");
      if (Object.keys(range).some((k) => k !== "offset" && k !== "length"))
        throw new TypeError("Unsupported range field");
      const offset = integer(range.offset ?? 0, "offset", 0, Number.MAX_SAFE_INTEGER);
      if (range.length !== undefined)
        integer(range.length, "length", 0, INLINE_LIMIT);
      return stores.use(
        volume(scope),
        async (vfs) => {
          // Reading one byte past the limit detects an oversized object without loading all of it.
          const read = await found(
            vfs.objects.getWithMetadata(key, {
              offset,
              length: range.length ?? INLINE_LIMIT + 1,
            }),
          );
          if (!read) return missing();
          if (read.data.byteLength > INLINE_LIMIT)
            throw new BackplaneError(
              "PAYLOAD_TOO_LARGE",
              "The object exceeds 1 MiB. Read a range or download it",
            );
          return { found: true, value: read.data, ...info(read.metadata) };
        },
        missing,
      );
    },
    async head(scope: Scope, key: string): Promise<VfsHead> {
      objectKey(key);
      return stores.use(
        volume(scope),
        async (vfs) => {
          const head = await found(vfs.objects.head(key));
          return head ? { found: true, ...info(head) } : missing();
        },
        missing,
      );
    },
    async list(scope: Scope, request: VfsListRequest = {}): Promise<VfsPage> {
      record(request, "request");
      if (Object.keys(request).some((k) => !["prefix", "after", "limit"].includes(k)))
        throw new TypeError("Unsupported list field");
      const { prefix = "", after = null, limit = 100 } = request;
      objectKey(prefix, true);
      if (after !== null) objectKey(after);
      integer(limit, "limit", 1, 1000);
      return stores.use(
        volume(scope),
        async (vfs) => {
          const page = await vfs.objects.list({ prefix, after, limit });
          return { objects: page.objects.map(info), nextAfter: page.nextAfter };
        },
        () => ({ objects: [], nextAfter: null }),
      );
    },
    async delete(scope: Scope, key: string, settings?: WriteOptions) {
      objectKey(key);
      const { ifRevision } = options(settings);
      return stores.use(
        volume(scope),
        async (vfs) => {
          // A null token requires absence. Nothing is deleted on this path, so the check needs no transaction.
          if (ifRevision === null) {
            checkRevision(null, (await found(vfs.objects.head(key)))?.revision ?? null);
            return false;
          }
          try {
            return await vfs.objects.delete(
              key,
              ifRevision === undefined ? {} : { ifMatch: ifRevision },
            );
          } catch (error) {
            if (!noObject(error)) throw error;
            checkRevision(ifRevision, null);
            return false;
          }
        },
        () => {
          checkRevision(ifRevision, null);
          return false;
        },
      );
    },
  };
  /** Streams `source` into one object. VERIFIED: defuss-vfs putStream publishes one inode update after the last chunk,
   * so a failed or aborted upload leaves the previous object visible. */
  async function upload(
    scope: Scope,
    key: string,
    source: Source,
    settings?: WriteOptions,
    signal?: AbortSignal,
  ) {
    objectKey(key);
    const { ifRevision } = options(settings);
    return write(scope, ifRevision, (vfs) =>
      vfs.objects.putStream(key, source, { ...condition(ifRevision), signal }),
    );
  }
  /** Opens one object version for streaming. VERIFIED by probe: closing a volume fails its open getStream reads, so the
   * volume lease lasts until the returned stream ends, fails or is cancelled. */
  function download(scope: Scope, key: string) {
    objectKey(key);
    return new Promise<VfsDownload>((resolve, reject) => {
      stores
        .use(
          volume(scope),
          async (vfs) => {
            const opened = await found(vfs.objects.getStream(key));
            if (!opened) return resolve(missing());
            let release!: () => void;
            const released = new Promise<void>((done) => (release = done));
            const reader = opened.stream.getReader();
            const stream = new ReadableStream<Uint8Array>({
              async pull(controller) {
                try {
                  const chunk = await reader.read();
                  if (!chunk.done) return controller.enqueue(chunk.value);
                  controller.close();
                } catch (error) {
                  controller.error(error);
                }
                release();
              },
              async cancel(reason) {
                await reader.cancel(reason).catch(() => {});
                release();
              },
            });
            resolve({ found: true, stream, ...info(opened.metadata) });
            await released;
          },
          () => resolve(missing()),
        )
        .catch(reject);
    });
  }
  /** Streams `length` bytes from `offset` of the object revision `revision`, one 256 KiB window per pull. defuss-vfs
   * getStream starts at byte 0, so a seek into a large video would read everything before it. Each window is its own
   * read, so the stream fails with REVISION_CONFLICT when a write replaced the object since the first one. */
  function readRange(
    scope: Scope,
    key: string,
    revision: string,
    offset: number,
    length: number,
  ) {
    objectKey(key);
    let position = offset;
    const end = offset + length;
    return new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          const size = Math.min(WINDOW, end - position);
          const read = await stores.use(
            volume(scope),
            (vfs) =>
              found(vfs.objects.getWithMetadata(key, { offset: position, length: size })),
            () => undefined,
          );
          if (read?.metadata.revision !== revision || read.data.byteLength !== size)
            throw new BackplaneError(
              "REVISION_CONFLICT",
              "The object changed during the read",
            );
          position += size;
          controller.enqueue(read.data);
          if (position >= end) controller.close();
        },
      },
      { highWaterMark: 0 },
    );
  }
  return {
    api,
    upload,
    download,
    readRange,
    handles: () => stores.stats(),
    close: () => stores.close(),
  };
}
