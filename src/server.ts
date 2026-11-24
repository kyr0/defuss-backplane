/** VERIFIED: defuss-serve owns the one loopback listener. Every endpoint is a plugin that applies the same Host and
 * Origin checks before it reads a request body; all but the health probes also require the bot key. */
import { createHash, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { createMcpHttp } from "defuss-mcp/http";
import { createRpcServer } from "defuss-rpc/server";
import { openScheduler } from "defuss-scheduler";
import { createServer, type ServePlugin } from "defuss-serve";
import { createServices } from "./services.js";
import { makeTools } from "./tools.js";
import { observeMethods, withFaults, type Recorder } from "./faults.js";
import { statuses, type ErrorCode } from "./errors.js";
import { createDaemonLog, reason } from "./log.js";
import { openOwnLog } from "./logs.js";
import { schedulerApi } from "./scheduler.js";
import { createTelemetry } from "./telemetry.js";
import { createTransfers, fault } from "./transfer.js";
import { callbackOrigins, dataRoot, otlpEnabled, settings } from "./config.js";
import { startCallbacks } from "./callbacks.js";

const limit = 1024 * 1024;
const digest = (value: string) => createHash("sha256").update(value).digest();

/** Reads at most 1 MiB of a request body; a larger one gets 413 before the protocol sees it. */
async function bounded(request: Request) {
  if (Number(request.headers.get("content-length")) > limit)
    return fault(413, "Body exceeds 1 MiB");
  if (!request.body) return undefined;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of request.body) {
    length += chunk.length;
    if (length > limit) return fault(413, "Body exceeds 1 MiB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Starts a daemon with an RPC server of its own, so daemons in one process serve only their own functions. The CLI
 * starts one; the tests start several in turn. */
export async function listen() {
  const config = settings();
  const push = otlpEnabled();
  const origins = callbackOrigins();
  // A data root the daemon cannot write fails here, before anything listens.
  const ownLog = await openOwnLog(dataRoot());
  const log = createDaemonLog(ownLog);
  const telemetry = createTelemetry({ root: dataRoot(), push, warn: log.warn });
  const credential = digest("Bearer " + config.apiKey);
  /** Times each call, and gives a server-side fault a line in the daemon's log with the error the method threw. BUSY
   * only means a full pool or queue, which the metrics count; a line per rejected call would flood the log. */
  const meter = (module: string): Recorder => {
    const timed = telemetry.meter(module);
    return (method, scope, code, seconds, thrown) => {
      timed(method, scope, code, seconds);
      if (code !== "BUSY" && statuses[code as ErrorCode] >= 500)
        log.error(`call failed module=${module} method=${method} code=${code} error="${reason(thrown)}"`);
    };
  };
  // App directories end with `-` and 8 hex digits (see scope.ts), so none can be named `scheduler` or `_backplane`. The scheduler's file lock makes a
  // second daemon on the same data root fail here, before it registers or listens.
  let scheduler;
  try {
    scheduler = await openScheduler({
      directory: join(dataRoot(), "scheduler"),
      onError(error) {
        telemetry.schedulerFault();
        log.error('scheduler fault error="' + reason(error) + '"');
      },
    });
  } catch (error) {
    await telemetry.obs.shutdown();
    await log.close();
    throw error;
  }
  const services = createServices(dataRoot(), meter, ownLog);
  const rpc = createRpcServer({
    ...services.api,
    scheduler: observeMethods(schedulerApi(scheduler, origins), meter("scheduler")),
  });
  const mcp = createMcpHttp(makeTools(rpc), {
    mode: "json",
    maxBodyBytes: limit,
    allowedOrigins: [],
  });
  const transfers = createTransfers(services, (route, code, thrown) => {
    if (code !== "BUSY" && statuses[code] >= 500)
      log.error(`transfer failed route=${route} code=${code} error="${reason(thrown)}"`);
  });
  const accepted = new Set([
    "127.0.0.1:" + config.port,
    "localhost:" + config.port,
  ]);
  type Endpoint = (request: Request) => Response | Promise<Response>;
  /** Wraps an endpoint in the Host and Origin checks. defuss-serve already limits Host names, but not the port or
   * Origin, so a page in a browser cannot read even the probes through DNS rebinding. */
  function local(name: string, routes: ServePlugin["routes"], endpoint: Endpoint): ServePlugin {
    return {
      name,
      routes,
      fetch: (request) =>
        !accepted.has(request.headers.get("host") ?? "") || request.headers.has("origin")
          ? fault(403, "Forbidden origin or host")
          : endpoint(request),
    };
  }
  /** Adds the bot key check. The routes declare no methods, so an unauthenticated request gets 401 rather than 405
   * and learns nothing about them. */
  function guarded(name: string, routes: ServePlugin["routes"], endpoint: Endpoint) {
    return local(name, routes, (request) =>
      timingSafeEqual(credential, digest(request.headers.get("authorization") ?? ""))
        ? endpoint(request)
        : fault(401, "Bot key required", {
            "WWW-Authenticate": 'Bearer realm="defuss-backplane"',
          }),
    );
  }
  /** RPC and MCP calls carry at most 1 MiB, buffered here so both protocols reject larger bodies alike. */
  async function call(request: Request, isMcp: boolean) {
    if (!isMcp && request.method !== "POST")
      return fault(405, "POST required", { Allow: "POST" });
    const body = await bounded(request);
    if (body instanceof Response) return body;
    const headers = new Headers(request.headers);
    if (!isMcp) headers.set("Content-Type", "application/json");
    const forwarded = new Request(request.url, {
      method: request.method,
      headers,
      signal: request.signal,
      body,
    });
    return withFaults(isMcp, () => (isMcp ? mcp.fetch(forwarded) : rpc.fetch(forwarded)));
  }
  const server = createServer({
    host: "127.0.0.1",
    port: config.port,
    plugins: [
      guarded("rpc", [{ path: "/rpc" }, { path: "/rpc/schema" }], (r) => call(r, false)),
      guarded("mcp", [{ path: "/mcp" }], (r) => call(r, true)),
      guarded("vfs-object", [{ path: "/vfs/object" }], transfers.object),
      guarded("files", [{ path: "/files", prefix: true }], transfers.files),
      // A supervisor polls the probes without the key. They report only pass or fail per check; /metrics names apps.
      local("probes", ["/health", "/healthz", "/livez", "/readyz"].map((path) => ({ path })), telemetry.obs.fetch),
      guarded("metrics", [{ path: "/metrics" }], telemetry.obs.fetch),
    ],
    // Uploads have no size or time limit, so long transfers can finish. RPC and MCP bodies stop at 1 MiB above.
    maxBodyBytes: Number.MAX_SAFE_INTEGER,
    bodyTimeoutMs: 0,
    headersTimeoutMs: 15_000,
    // Requests get 3 seconds to finish, below the 5 seconds `make stop` allows before SIGKILL. VERIFIED by probe: a
    // client that stops reading a download keeps its connection open, so without this cut-off it blocks shutdown.
    shutdownTimeoutMs: 3000,
    onRequest: telemetry.request,
    // Diagnostics carry a code and a plugin name only, never request data.
    onDiagnostic: (event) =>
      log.warn("serve " + event.code + (event.plugin ? " plugin=" + event.plugin : "")),
  });
  const release = () =>
    Promise.all([
      rpc.close(),
      mcp.close(),
      services.close(),
      scheduler?.close(),
      telemetry.obs.shutdown(),
    ]).finally(() => log.close());
  try {
    await server.start();
  } catch (error) {
    await release();
    throw error;
  }
  if (server.url?.hostname !== "127.0.0.1") {
    await server.stop();
    await release();
    throw new Error("Unexpected listener address");
  }
  telemetry.watch(() => server.stats, services.handles);
  // Callbacks start once the daemon listens, so no failed startup has calls in flight.
  const callbacks = startCallbacks(scheduler, {
    apiKey: config.apiKey,
    origins,
    warn: log.warn,
    record: telemetry.callback,
  });
  return {
    url: "http://127.0.0.1:" + server.port,
    log,
    async close() {
      // Readiness fails before the listener closes. Closing a connection aborts an unfinished upload, which keeps the
      // previous object. The final OTLP export runs after the requests drain and before the stores close. The log
      // closes last, so a fault while closing still gets its line. Callbacks in flight get 2.5 s while requests drain.
      log.info("stopping");
      telemetry.obs.drain();
      await Promise.all([server.stop(), callbacks.close()]);
      try {
        await telemetry.obs.shutdown();
      } finally {
        try {
          await mcp.close();
          await rpc.close();
          await Promise.all([services.close(), scheduler.close()]);
        } finally {
          await log.close();
        }
      }
    },
  };
}
