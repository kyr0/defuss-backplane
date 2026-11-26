/** VERIFIED: defuss-o11y 0.3.0 turns the daemon's checks, gauges and timed calls into health probes, a Prometheus
 * scrape and an opt-in OTLP push. Labels carry module, method, app, endpoint, HTTP method, status and fault code
 * only: tenant, bucket and key names, request data and credentials never become labels. */
import { constants } from "node:fs";
import { access, statfs } from "node:fs/promises";
import { dirname } from "node:path";
import { createO11y } from "defuss-o11y";
import type { RequestEvent, ServeStats } from "defuss-serve";
import type { Recorder } from "./faults.js";
import { appComponent } from "./scope.js";

const OPERATION = "backplane.operation.duration";
const REQUEST = "http.server.request.duration";
const CALLBACK = "backplane.callback.duration";
const BUCKETS = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
/** RFC 9110 methods. Any other method is reported as `_OTHER`, so a client cannot add label values. */
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "CONNECT", "TRACE"]);
type Handles = Record<string, { open: number; busy: number }>;

/** The volume holding `root`. A daemon that has written nothing has no data root yet, so the nearest existing parent
 * stands in: the first write creates the root there. */
async function volume(root: string) {
  for (let path = root; ; path = dirname(path)) {
    try {
      return { path, stats: await statfs(path) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(path) === path)
        throw error;
    }
  }
}
/** The scope's app when the services would accept it, so a rejected scope cannot put arbitrary text in a label. */
function app(scope: unknown) {
  const value = (scope as { app?: unknown } | null | undefined)?.app;
  try {
    appComponent(value);
    return value as string;
  } catch {
    return undefined;
  }
}
/** A metric write never fails the call it describes. After shutdown the instance rejects writes, so they are dropped. */
function quiet(write: () => void) {
  try {
    write();
  } catch {
    // Dropped: only a late write after shutdown reaches this.
  }
}

export function createTelemetry(options: { root: string; push: boolean; warn: (message: string) => void }) {
  const obs = createO11y({
    serviceName: "defuss-backplane",
    serviceVersion: "0.3.0",
    // The SDK reads the endpoint and headers from OTEL_EXPORTER_OTLP_METRICS_ENDPOINT and _HEADERS. An export gets
    // 1.5 s, so the final one at shutdown still fits the 5 s `make stop` budget after the 3 s request drain.
    ...(options.push && {
      otlp: {
        timeoutMs: 1500,
        // One line per failed attempt, at most one a minute, so a lost receiver shows in the log.
        // VERIFIED by probe: a refused connection can fail with an empty message and the code ECONNREFUSED.
        onExportError: ({ source, error }) => {
          const reason = error.message || String((error as { code?: unknown }).code ?? error.name);
          options.warn("otlp export failed source=" + source + ' error="' + reason + '"');
        },
      },
    }),
  });
  obs.defineHistogram(OPERATION, {
    unit: "s",
    description: "Duration of cache, db, vfs, logs and scheduler calls over RPC and MCP",
    explicitBucketBoundaries: BUCKETS,
  });
  obs.defineHistogram(REQUEST, {
    unit: "s",
    description: "Time until response headers, per endpoint",
    explicitBucketBoundaries: BUCKETS,
  });
  obs.defineHistogram(CALLBACK, {
    unit: "s",
    description: "Duration of scheduled RPC callbacks to apps, by outcome",
    explicitBucketBoundaries: BUCKETS,
  });
  obs.check("storage", async () => {
    const { path, stats } = await volume(options.root);
    await access(path, constants.W_OK);
    return stats.bavail > 0;
  });
  obs.observe(
    "backplane.storage.free",
    async () => {
      const { stats } = await volume(options.root);
      return stats.bavail * stats.bsize;
    },
    { unit: "By", description: "Bytes available to the daemon on the data root's volume" },
  );
  const schedulerFaults = obs.bindCounter("backplane.scheduler.errors");
  // A counter without a sample is not exported; adding 0 makes the documented series exist from the start, so an
  // alert on its rate has data before the first fault.
  schedulerFaults(0);
  return {
    obs,
    /** The recorder for one module's calls over RPC and MCP. */
    meter:
      (module: string): Recorder =>
      (method, scope, code, seconds) =>
        quiet(() =>
          obs.sink.recordHistogram(OPERATION, seconds, { module, method, app: app(scope), code }),
        ),
    /** defuss-serve's onRequest callback. The endpoint is the plugin name, or `http` for the host's own 403 and 404. */
    request: (event: RequestEvent) =>
      quiet(() =>
        obs.sink.recordHistogram(REQUEST, event.durationMs / 1000, {
          endpoint: event.handler,
          "http.request.method": METHODS.has(event.method) ? event.method : "_OTHER",
          "http.response.status_code": event.status,
        }),
      ),
    /** One scheduled RPC callback: `ok`, `failed` (retried) or `rejected` (failed for good). */
    callback: (app: string, outcome: string, seconds: number) =>
      quiet(() => obs.sink.recordHistogram(CALLBACK, seconds, { app, outcome })),
    /** Counts a fault of the scheduler's background loop, which no request sees. */
    schedulerFault: () => quiet(() => schedulerFaults()),
    /** Registers the gauges that read the listener and the store pools, once both exist. */
    watch(server: () => ServeStats, handles: () => Handles) {
      obs.observe(
        "backplane.http.active",
        () => {
          const stats = server();
          return [
            { value: stats.activeRequests, attributes: { kind: "requests" } },
            { value: stats.activeStreams, attributes: { kind: "streams" } },
            { value: stats.activeUploads, attributes: { kind: "uploads" } },
          ];
        },
        { description: "Requests in progress, response bodies streaming and request bodies arriving" },
      );
      obs.observe(
        "backplane.store.handles",
        () =>
          Object.entries(handles()).flatMap(([module, pool]) => [
            { value: pool.busy, attributes: { module, state: "busy" } },
            { value: pool.open - pool.busy, attributes: { module, state: "idle" } },
          ]),
        { description: "Open store handles per module. A module keeps at most 32 and answers BUSY beyond" },
      );
    },
  };
}
