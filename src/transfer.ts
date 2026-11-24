/** VERIFIED: Both routes stream VFS objects over plain HTTP without the 1 MiB `/rpc` body limit. `/vfs/object` is the
 * typed client's upload and download endpoint. `/files/<app>/<tenant>/<bucket>/<key>` serves reads with ETags,
 * conditional requests and byte ranges, so curl, a proxy or a media player can fetch and seek. */
import type { ErrorCode } from "./errors.js";
import { capture, httpCode } from "./faults.js";
import { contentType, decide, etag } from "./ranges.js";
import type { WriteOptions } from "./revisions.js";
import type { Scope } from "./scope.js";
import type { createServices } from "./services.js";
import type { VfsObject } from "./vfs.js";

/** A fault in the `/rpc` error body, so every route reports `{ error, code, status }`. */
export function fault(status: number, message: string, headers: Record<string, string> = {}) {
  return Response.json({ error: message, code: httpCode(status), status }, { status, headers });
}
/** Reports a route's fault with the value thrown before it became a code. */
type Report = (route: "vfs-object" | "files", code: ErrorCode, thrown: unknown) => void;
/** Object transfers take a quoted revision in If-Match or `*` in If-None-Match, the HTTP forms of `ifRevision`. */
function precondition(headers: Headers): WriteOptions {
  const match = headers.get("if-match"),
    none = headers.get("if-none-match");
  if (match === null && none === null) return {};
  if (match === null && none === "*") return { ifRevision: null };
  if (none === null && match !== null && /^"[^"]+"$/.test(match))
    return { ifRevision: match.slice(1, -1) };
  throw new TypeError("Send one quoted revision in If-Match or * in If-None-Match");
}
/** Validators for the files route. `x-size` repeats the length because Bun drops Content-Length from streamed bodies. */
function described(key: string, object: VfsObject) {
  return {
    etag: etag(object),
    "last-modified": new Date(object.mtimeMs).toUTCString(),
    "accept-ranges": "bytes",
    "cache-control": "private, no-cache",
    "content-type": contentType(key),
    "x-content-type-options": "nosniff",
    "x-size": String(object.size),
  };
}
/** Splits `/files/<app>/<tenant>/<bucket>/<key>` and decodes each name. defuss-serve rejects an encoded slash, so an
 * app, tenant or bucket name containing `/` is reachable only over RPC. */
function address(request: Request): { scope: Scope; key: string } {
  const parts = new URL(request.url).pathname.split("/").slice(2);
  if (parts.length < 4)
    throw new TypeError("Name the object as /files/<app>/<tenant>/<bucket>/<key>");
  try {
    const [app, tenant, bucket] = parts.slice(0, 3).map(decodeURIComponent);
    return { scope: { app, tenant, bucket }, key: decodeURIComponent(parts.slice(3).join("/")) };
  } catch {
    throw new TypeError("Malformed percent-encoding in the path");
  }
}

export function createTransfers(services: ReturnType<typeof createServices>, report: Report) {
  const { transfers, api } = services;
  function failure(route: "vfs-object" | "files", error: unknown) {
    const { code, message, status } = capture(error);
    report(route, code, error);
    return Response.json({ code, error: message, status }, { status });
  }
  /** Streams one object in either direction. The query names the scope and key. */
  async function object(request: Request) {
    if (request.method !== "GET" && request.method !== "PUT")
      return fault(405, "GET or PUT required", { Allow: "GET, PUT" });
    const query = new URL(request.url).searchParams;
    const scope = {
      app: query.get("app"),
      tenant: query.get("tenant"),
      bucket: query.get("bucket"),
    } as Scope;
    const key = query.get("key") as string;
    try {
      if (request.method === "PUT") {
        const stored = await transfers.upload(
          scope,
          key,
          request.body ?? [],
          precondition(request.headers),
          request.signal,
        );
        return Response.json(stored, { headers: { etag: '"' + stored.revision + '"' } });
      }
      const read = await transfers.download(scope, key);
      if (!read.found) return fault(404, "No object at this key");
      return new Response(read.stream, {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(read.size),
          "x-size": String(read.size),
          etag: '"' + read.revision + '"',
          "x-mtime-ms": String(read.mtimeMs),
        },
      });
    } catch (error) {
      return failure("vfs-object", error);
    }
  }
  /** Answers GET and HEAD with the object's validators. A whole-object GET streams one snapshot; a range reads windows
   * of the revision the decision was made on. */
  async function files(request: Request) {
    if (request.method !== "GET" && request.method !== "HEAD")
      return fault(405, "GET or HEAD required", { Allow: "GET, HEAD" });
    try {
      const { scope, key } = address(request);
      const head = await api.vfs.head(scope, key);
      if (!head.found) return fault(404, "No object at this key");
      let decision = decide(request.method, request.headers, head);
      if (decision.status === 206) {
        const { offset, length } = decision;
        return new Response(transfers.readRange(scope, key, head.revision, offset, length), {
          status: 206,
          headers: {
            ...described(key, head),
            "content-range": `bytes ${offset}-${offset + length - 1}/${head.size}`,
            "content-length": String(length),
          },
        });
      }
      if (decision.status !== 200 || request.method === "HEAD")
        return answer(decision.status, key, head);
      const read = await transfers.download(scope, key);
      if (!read.found) return fault(404, "No object at this key");
      // A write between the head and the download changes the validators, so the preconditions are checked again.
      if (read.revision !== head.revision)
        decision = decide(request.method, without(request.headers), read);
      if (decision.status !== 200) {
        await read.stream.cancel();
        return answer(decision.status, key, read);
      }
      return new Response(read.stream, {
        headers: { ...described(key, read), "content-length": String(read.size) },
      });
    } catch (error) {
      return failure("files", error);
    }
  }
  return { object, files };
}
/** A bodyless answer: 200 for HEAD, 304 with validators, 412, or 416 with the size. */
function answer(status: number, key: string, object: VfsObject) {
  const headers: Record<string, string> = described(key, object);
  if (status === 200) headers["content-length"] = String(object.size);
  if (status === 416) headers["content-range"] = "bytes */" + object.size;
  return new Response(null, { status, headers });
}
/** The request headers without Range and If-Range, so a re-check after a write sends the whole new object. */
function without(headers: Headers) {
  const copy = new Headers(headers);
  copy.delete("range");
  copy.delete("if-range");
  return copy;
}
