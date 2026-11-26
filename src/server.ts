/** VERIFIED: defuss-serve owns the one loopback listener. Every endpoint is a plugin that applies the same Host and
 * Origin checks before it reads a request body; all but the health probes and the auth routes also require the root
 * key or a bot key, and run as that caller (access.ts). The auth routes at /apps take the browser's Origin, which
 * cookie-mode logins need, and want an app's proxy key in X-Backplane-Key instead. */
import { createHash, timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { createMcpHttp } from "defuss-mcp/http";
import { createRpcServer } from "defuss-rpc/server";
import { openScheduler } from "defuss-scheduler";
import { createServer, type ServePlugin } from "defuss-serve";
import { createServices } from "./services.js";
import { makeTools } from "./tools.js";
import { observeMethods, withFaults, type Recorder } from "./faults.js";

/** Signing-key rotation and cleanup of expired sessions and keys, in every app and for the bots. */
const MAINTAIN_MS = 60 * 60 * 1000;
import { statuses, type ErrorCode } from "./errors.js";
import { createDaemonLog, reason } from "./log.js";
import { openOwnLog } from "./logs.js";
import { schedulerApi } from "./scheduler.js";
import { createTelemetry } from "./telemetry.js";
import { createTransfers, fault } from "./transfer.js";
import { authMasterKey, callbackOrigins, dataRoot, otlpEnabled, settings } from "./config.js";
import { callbackTokens, startCallbacks } from "./callbacks.js";
import { type Caller, allowApp, isAdmin, mayUseApp, requireAdmin, runAs } from "./access.js";
import { openAuth, PROXY_KEY_HEADER } from "./auth.js";
import { openBots } from "./bots.js";
import { capture } from "./faults.js";

const limit = 1024 * 1024;
const digest = (value: string) => createHash("sha256").update(value).digest();

/** Reads at most 1 MiB of a request body; a larger one gets 413 before the protocol sees it, after the rest of the
 * body was read and dropped. VERIFIED by probe with Node.js on both sides: a 413 sent while the client was still
 * sending closed the socket under it, and up to 9 of 10 clients saw EPIPE or ECONNRESET instead of the answer; a cap
 * on the drain only moved the race to larger bodies. Why reading it all is safe: this runs after the bot key check,
 * and a key holder can stream any size through /vfs/object anyway. */
async function bounded(request: Request) {
  if (!request.body) return Number(request.headers.get("content-length")) > limit ? fault(413, "Body exceeds 1 MiB") : undefined;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of request.body) {
    length += chunk.length;
    if (length <= limit) chunks.push(chunk);
  }
  return length > limit ? fault(413, "Body exceeds 1 MiB") : Buffer.concat(chunks);
}

/** Starts a daemon with an RPC server of its own, so daemons in one process serve only their own functions. The CLI
 * starts one; the tests start several in turn. */
export async function listen() {
  const config = settings();
  const push = otlpEnabled();
  const origins = callbackOrigins();
  const masterKey = authMasterKey();
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
  // defuss-auth refuses a directory path that passes a symlink, such as /var on macOS, so it gets the real path.
  let auth, bots;
  try {
    const root = await realpath(dataRoot());
    bots = await openBots(root, masterKey);
    auth = await openAuth(root, masterKey, log.warn);
  } catch (error) {
    await bots?.close();
    await scheduler.close();
    await telemetry.obs.shutdown();
    await log.close();
    throw error;
  }
  const tokens = callbackTokens();
  const services = createServices(dataRoot(), meter, ownLog);
  const rpc = createRpcServer({
    ...services.api,
    scheduler: observeMethods(schedulerApi(scheduler, origins), meter("scheduler")),
    auth: observeMethods(auth.api, meter("auth")),
    bots: observeMethods(bots.api, meter("bots")),
    callbacks: observeMethods(tokens.api, meter("callbacks")),
  });
  // Every call names its app in the scope it takes first, except the bot users (admin only) and the callback check,
  // which checks the token's app itself. MCP tools reach the same functions through rpc.fetch, so this covers both.
  rpc.addHook({
    phase: "guard",
    fn: (namespace, _method, args) => {
      try {
        if (namespace === "bots") requireAdmin();
        else if (namespace !== "callbacks") allowApp((args[0] as { app?: unknown } | null | undefined)?.app);
        return true;
      } catch (error) {
        capture(error);
        return false;
      }
    },
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
  /** The root key as `Bearer <API_KEY>`, or a bot's as `ApiKey <key>`; null for anything else. */
  async function identify(authorization: string): Promise<Caller | null> {
    if (timingSafeEqual(credential, digest(authorization))) return { kind: "root" };
    return /^ApiKey /i.test(authorization) ? bots!.authenticate(authorization) : null;
  }
  /** Adds the key check and runs the endpoint as the caller. The routes declare no methods, so an unauthenticated
   * request gets 401 rather than 405 and learns nothing about them. */
  function guarded(name: string, routes: ServePlugin["routes"], endpoint: Endpoint) {
    return local(name, routes, async (request) => {
      let who: Caller | null;
      try {
        who = await identify(request.headers.get("authorization") ?? "");
      } catch (error) {
        log.error(`bot check failed error="${reason(error)}"`);
        return fault(503, "Bot keys cannot be checked now");
      }
      return who
        ? runAs(who, () => endpoint(request))
        : fault(401, "Bot key required", { "WWW-Authenticate": 'Bearer realm="defuss-backplane"' });
    });
  }
  /** The auth routes of every app at /apps/<app>/, for the app's proxy. The proxy sends its key in X-Backplane-Key
   * because Authorization carries the end user's credential. The key must be the root key, an admin bot's or the bot
   * key of the app in the path, so one app's key cannot drive another app's logins or choose its rate keys. */
  const hosted: ServePlugin = {
    name: "auth",
    routes: [{ path: "/apps", prefix: true }],
    async fetch(request) {
      if (!accepted.has(request.headers.get("host") ?? "")) return fault(403, "Forbidden origin or host");
      if (!auth!.enabled()) return fault(404, "Auth is off: set BACKPLANE_AUTH_MASTER_KEY");
      const key = request.headers.get(PROXY_KEY_HEADER) ?? "";
      let app: string, who: Caller | null;
      try {
        app = decodeURIComponent(new URL(request.url).pathname.split("/")[2] ?? "");
      } catch {
        return fault(400, "Malformed percent-encoding in the path");
      }
      try {
        // The header carries the bare key: the root key, or a bot's.
        who = key ? ((await identify("Bearer " + key)) ?? (await identify("ApiKey " + key))) : null;
      } catch (error) {
        log.error(`bot check failed error="${reason(error)}"`);
        return fault(503, "Bot keys cannot be checked now");
      }
      if (!who || !mayUseApp(app, who)) return fault(403, "A proxy key for this app is required");
      return auth!.fetch(request);
    },
  };
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
      // The metrics name every app, so an app's bot sees the lines of its apps and those that name no app.
      guarded("metrics", [{ path: "/metrics" }], async (request) => {
        const answer = await telemetry.obs.fetch(request);
        if (isAdmin() || !answer.ok) return answer;
        const lines = (await answer.text()).split("\n").filter((line) => {
          const app = /[{,]app="((?:[^"\\]|\\.)*)"/.exec(line)?.[1];
          return app === undefined || mayUseApp(JSON.parse('"' + app + '"'));
        });
        const headers = new Headers(answer.headers);
        headers.delete("content-length");
        return new Response(lines.join("\n"), { status: answer.status, headers });
      }),
      hosted,
    ],
    // The app proxies on loopback set X-Forwarded-For, which the auth routes' per-client login limits read.
    trustedProxies: ["127.0.0.1"],
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
      auth.close(),
      bots.close(),
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
    tokens,
    origins,
    warn: log.warn,
    record: telemetry.callback,
  });
  const maintenance = setInterval(() => {
    for (const [name, run] of [["auth", () => auth.maintain()], ["bots", () => bots.maintain()]] as const)
      run().then(
        (outcome) => {
          for (const [app, result] of Object.entries(outcome ?? {}))
            if ((result as { error?: string } | null)?.error) log.warn(`auth maintenance failed app=${app} error=${(result as { error: string }).error}`);
        },
        (error) => log.warn(`${name} maintenance failed error="${reason(error)}"`),
      );
  }, MAINTAIN_MS);
  maintenance.unref();
  return {
    url: "http://127.0.0.1:" + server.port,
    log,
    async close() {
      // Readiness fails before the listener closes. Closing a connection aborts an unfinished upload, which keeps the
      // previous object. The final OTLP export runs after the requests drain and before the stores close. The log
      // closes last, so a fault while closing still gets its line. Callbacks in flight get 2.5 s while requests drain.
      log.info("stopping");
      clearInterval(maintenance);
      telemetry.obs.drain();
      await Promise.all([server.stop(), callbacks.close()]);
      try {
        await telemetry.obs.shutdown();
      } finally {
        try {
          await mcp.close();
          await rpc.close();
          await Promise.all([services.close(), scheduler.close(), auth.close(), bots.close()]);
        } finally {
          await log.close();
        }
      }
    },
  };
}
