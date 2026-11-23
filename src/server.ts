/** VERIFIED: One listener applies the same Host, Origin and bearer checks before RPC, MCP or the file transfer route sees a request body. */
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { createMcpHttp } from "defuss-mcp/http";
import { createRpcServer, rpcRoute } from "defuss-rpc/server";
import { createServices } from "./services.js";
import { makeTools } from "./tools.js";
import { capture, httpCode, observeMethods, withFaults } from "./faults.js";
import type { WriteOptions } from "./revisions.js";
import type { Scope } from "./scope.js";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { join } from "node:path";
import { openScheduler } from "defuss-scheduler";
import { schedulerApi } from "./scheduler.js";
import { dataRoot, schedulerEnabled, settings } from "./config.js";

const limit = 1024 * 1024;
const digest = (value: string) => createHash("sha256").update(value).digest();
function end(res: ServerResponse, status: number, message: string) {
  res
    .writeHead(status, { "content-type": "application/json" })
    .end(JSON.stringify({ error: message, code: httpCode(status), status }));
}
/** Object transfers take a quoted revision in If-Match or `*` in If-None-Match, the HTTP forms of `ifRevision`. */
function precondition(headers: IncomingHttpHeaders): WriteOptions {
  const match = headers["if-match"],
    none = headers["if-none-match"];
  if (match === undefined && none === undefined) return {};
  if (match === undefined && none === "*") return { ifRevision: null };
  if (none === undefined && match !== undefined && /^"[^"]+"$/.test(match))
    return { ifRevision: match.slice(1, -1) };
  throw new TypeError(
    "Send one quoted revision in If-Match or * in If-None-Match",
  );
}
/** One daemon owns the defuss-rpc process registry. Invoked exclusively by the CLI. */
export async function listen() {
  const config = settings();
  const credential = digest("Bearer " + config.apiKey);
  // App directories start with `x` (see scope.ts), so none can be named `scheduler`. The scheduler's file lock makes a
  // second daemon on the same data root fail here, before it registers or listens.
  const scheduler = schedulerEnabled()
    ? await openScheduler({ directory: join(dataRoot(), "scheduler") })
    : undefined;
  const services = createServices(dataRoot());
  createRpcServer({
    ...services.api,
    ...(scheduler && { scheduler: observeMethods(schedulerApi(scheduler)) }),
  });
  const mcp = createMcpHttp(makeTools(!!scheduler), {
    mode: "json",
    maxBodyBytes: limit,
    allowedOrigins: [],
  });
  const accepted = new Set([
    "127.0.0.1:" + config.port,
    "localhost:" + config.port,
  ]);
  /** Streams one VFS object in either direction without the 1 MiB body limit. The query names the scope and key, and
   * faults use the `/rpc` error body. */
  async function transfer(
    req: IncomingMessage,
    res: ServerResponse,
    query: URLSearchParams,
  ) {
    if (req.method !== "GET" && req.method !== "PUT") {
      res.setHeader("Allow", "GET, PUT");
      return end(res, 405, "GET or PUT required");
    }
    const scope = {
      app: query.get("app"),
      tenant: query.get("tenant"),
      bucket: query.get("bucket"),
    } as Scope;
    const key = query.get("key") as string;
    const abort = new AbortController();
    res.once("close", () => abort.abort());
    try {
      if (req.method === "PUT") {
        const stored = await services.transfers.upload(
          scope,
          key,
          req,
          precondition(req.headers),
          abort.signal,
        );
        res
          .writeHead(200, {
            "content-type": "application/json",
            etag: '"' + stored.revision + '"',
          })
          .end(JSON.stringify(stored));
        return;
      }
      const read = await services.transfers.download(scope, key);
      if (!read.found) return end(res, 404, "No object at this key");
      res.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": read.size,
        etag: '"' + read.revision + '"',
        "x-mtime-ms": read.mtimeMs,
      });
      // Destroying the Node stream cancels the web stream, which releases the volume lease.
      await pipeline(
        Readable.fromWeb(read.stream as unknown as NodeReadableStream<Uint8Array>),
        res,
      );
    } catch (error) {
      if (res.headersSent) return void res.destroy();
      const fault = capture(error);
      // An upload rejected before its body was read leaves the connection unusable.
      res.setHeader("connection", "close");
      res
        .writeHead(fault.status, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            code: fault.code,
            error: fault.message,
            status: fault.status,
          }),
        );
    }
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (
      !accepted.has(req.headers.host ?? "") ||
      req.headers.origin !== undefined
    )
      return end(res, 403, "Forbidden origin or host");
    if (!timingSafeEqual(credential, digest(req.headers.authorization ?? ""))) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="defuss-backplane"');
      return end(res, 401, "Bot key required");
    }
    const target = new URL(req.url ?? "/", config.base);
    if (target.pathname === "/vfs/object")
      return transfer(req, res, target.searchParams);
    const isMcp = req.url === "/mcp";
    if (!isMcp && req.url !== "/rpc/schema" && req.url !== "/rpc")
      return end(res, 404, "Unknown endpoint");
    if (!isMcp && req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return end(res, 405, "POST required");
    }
    if (Number(req.headers["content-length"]) > limit)
      return end(res, 413, "Body exceeds 1 MiB");
    let length = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      length += chunk.length;
      if (length > limit) {
        req.resume();
        return end(res, 413, "Body exceeds 1 MiB");
      }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
    if (!isMcp) headers.set("Content-Type", "application/json");
    const abort = new AbortController();
    res.once("close", () => abort.abort());
    const request = new Request(config.base + req.url, {
      method: req.method,
      headers,
      signal: abort.signal,
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : Buffer.concat(chunks),
    });
    const response = await withFaults(isMcp, () =>
      isMcp ? mcp.fetch(request) : rpcRoute({ request }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) await pipeline(response.body, res);
    else res.end();
  }
  const active = new Set<Promise<void>>();
  const server = createServer((req, res) => {
    const task = handle(req, res).catch(() => {
      if (!res.headersSent && !res.destroyed) end(res, 500, "Request failed");
      else res.destroy();
    });
    active.add(task);
    void task.finally(() => active.delete(task));
  });
  // An upload or download may outlast any fixed request deadline. Shutdown bounds open transfers instead.
  server.requestTimeout = 0;
  server.headersTimeout = 15_000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await Promise.all([services.close(), scheduler?.close()]);
    createRpcServer({});
    throw error;
  }
  const socket = server.address();
  if (!socket || typeof socket === "string" || socket.address !== "127.0.0.1") {
    server.close();
    throw new Error("Unexpected listener address");
  }
  return {
    url: "http://" + socket.address + ":" + socket.port,
    async close() {
      const closed = new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      // Requests get 3 seconds to finish, below the 5 seconds `make stop` allows before SIGKILL. VERIFIED by probe: a
      // client that stops reading a download keeps its connection open, so without this cut-off it blocks shutdown.
      // Closing the connection aborts an unfinished upload, which keeps the previous object.
      const cutoff = setTimeout(() => server.closeAllConnections(), 3000);
      try {
        await closed;
      } finally {
        clearTimeout(cutoff);
      }
      await Promise.allSettled(active);
      await mcp.close();
      await Promise.all([services.close(), scheduler?.close()]);
      // The registry is process-wide and keeps its first registration, so a later daemon in this process needs it empty.
      createRpcServer({});
    },
  };
}
