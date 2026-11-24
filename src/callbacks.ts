/** VERIFIED: A schedule whose handler is `_rpc` needs no worker in the app: at each occurrence the daemon calls the
 * app's defuss-rpc function named in the payload, with the payload's arguments. defuss-scheduler 0.2.0 `ready` names
 * the scopes with due callbacks, so one dispatcher serves every app without claiming in idle scopes. */
import { isDeepStrictEqual } from "node:util";
import { DSON } from "defuss-dson";
import type { Json, Queue, Run, Scheduler, Scope, WorkerPort } from "defuss-scheduler";
import { PermanentFailure, startWorker } from "defuss-scheduler/worker";
import { reason } from "./log.js";

/** The handler the daemon runs itself. Handler names starting with `_` belong to the daemon, like app names. */
export const RPC_HANDLER = "_rpc";
/** Where and what the daemon calls: a defuss-rpc endpoint such as `http://127.0.0.1:3000/rpc` and one function. */
export type RpcCallback = { url: string; className: string; methodName: string; args?: Json[] };

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const POLL_MS = 250;
// A slow function keeps its lease through the worker's renewals; the deadline only bounds a hung connection.
const TIMEOUT_MS = 60_000;
const RESULT_BYTES = 64 * 1024;
const CONCURRENCY = 4;
// A scope's worker stops after a minute without due callbacks, so idle scopes hold no timers. A schedule that fires
// every minute or more often keeps its worker.
const IDLE_MS = 60_000;

/** Checks a callback payload. A TypeError becomes INVALID_ARGUMENT when a schedule is created or changed. Only
 * loopback and the operator's origins are allowed, because any bot-key holder can create schedules and the daemon
 * sends the bot key with each call. */
export function callback(payload: unknown, origins: ReadonlySet<string>): RpcCallback {
  const p = payload as Record<string, unknown> | null;
  if (
    !p ||
    typeof p !== "object" ||
    Array.isArray(p) ||
    Object.keys(p).some((k) => !["url", "className", "methodName", "args"].includes(k))
  )
    throw new TypeError("An _rpc payload holds url, className, methodName and optional args");
  if (typeof p.className !== "string" || !p.className || typeof p.methodName !== "string" || !p.methodName)
    throw new TypeError("className and methodName must be non-empty strings");
  if (p.args !== undefined && !Array.isArray(p.args)) throw new TypeError("args must be an array");
  let url: URL;
  try {
    url = new URL(p.url as string);
  } catch {
    throw new TypeError("url must be an absolute URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw new TypeError("url must use http or https, without credentials or fragment");
  if (!LOOPBACK.has(url.hostname) && !origins.has(url.origin))
    throw new TypeError("url must be on loopback or an origin listed in BACKPLANE_CALLBACK_ORIGINS");
  return { url: url.href, className: p.className, methodName: p.methodName, args: (p.args as Json[]) ?? [] };
}

/** At most RESULT_BYTES of the response text; undefined for a longer body, which is cancelled. */
async function bounded(response: Response) {
  if (!response.body) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > RESULT_BYTES) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function startCallbacks(
  scheduler: Scheduler,
  options: {
    apiKey: string;
    origins: ReadonlySet<string>;
    warn: (message: string) => void;
    record: (app: string, outcome: "ok" | "failed" | "rejected", seconds: number) => void;
  },
) {
  /** Scopes that `ready` named since their last empty claim. */
  const due = new Set<string>();
  const workers = new Map<string, { worker: ReturnType<typeof startWorker>; seen: number; running: number }>();

  /** One call. A 4xx answer other than 408 and 429 fails the run for good: the same request fails again. */
  async function call(run: Run, signal: AbortSignal): Promise<Json> {
    let target: RpcCallback;
    try {
      target = callback(run.payload, options.origins);
    } catch (error) {
      throw new PermanentFailure(reason(error));
    }
    const response = await fetch(target.url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + options.apiKey,
        // Delivery is at least once: the app drops a repeated run ID.
        "x-backplane-schedule": run.scheduleId,
        "x-backplane-run": run.id,
        "x-backplane-attempt": String(run.attempt),
      },
      body: DSON.stringify({ className: target.className, methodName: target.methodName, args: target.args }),
    });
    const text = await bounded(response);
    if (!response.ok) {
      const message = "HTTP " + response.status + (text ? " " + text.slice(0, 512) : "");
      if (response.status < 500 && response.status !== 408 && response.status !== 429)
        throw new PermanentFailure(message);
      throw new Error(message);
    }
    // VERIFIED by test: defuss-rpc answers in DSON's tagged encoding. The run stores JSON, so a result that dates,
    // binary, bigints or cycles would change stays out of it.
    let result: Json = null;
    try {
      const value = text ? DSON.parse(text) : null;
      if (isDeepStrictEqual(value, JSON.parse(JSON.stringify(value)))) result = value as Json;
    } catch {
      result = null;
    }
    return { status: response.status, result };
  }

  function port(key: string, queue: Queue): WorkerPort {
    return {
      // Until `ready` names the scope, a claim answers empty without reading the store.
      async claim(input) {
        if (!due.has(key)) return { kind: "empty", retryAfterMs: POLL_MS };
        const reply = await queue.claim(input);
        if (reply.kind === "empty") due.delete(key);
        return reply;
      },
      renew: (input) => queue.renew(input),
      complete: (input) => queue.complete(input),
      fail: (input) => queue.fail(input),
    };
  }

  function serve(scope: Scope, key: string) {
    const entry = {
      seen: Date.now(),
      running: 0,
      worker: startWorker(port(key, scheduler.scope(scope)), {
        workerId: "defuss-backplane",
        concurrency: CONCURRENCY,
        onError: (error) =>
          options.warn("callback worker error app=" + JSON.stringify(scope.app) + " error=" + JSON.stringify(reason(error))),
        handlers: {
          [RPC_HANDLER]: async (run, context) => {
            const started = performance.now();
            entry.running++;
            let outcome: "ok" | "failed" | "rejected" = "ok";
            try {
              return await call(run, context.signal);
            } catch (error) {
              outcome = error instanceof PermanentFailure ? "rejected" : "failed";
              options.warn(
                `callback failed app=${JSON.stringify(scope.app)} schedule=${JSON.stringify(run.scheduleId)} run=${run.id} attempt=${run.attempt} error=${JSON.stringify(reason(error))}`,
              );
              throw error;
            } finally {
              entry.running--;
              entry.seen = Date.now();
              options.record(scope.app, outcome, (performance.now() - started) / 1000);
            }
          },
        },
      }),
    };
    workers.set(key, entry);
  }

  async function poll() {
    const now = Date.now();
    for (const scope of await scheduler.ready({ handlers: [RPC_HANDLER], limit: 128 })) {
      const key = JSON.stringify([scope.app, scope.tenant, scope.bucket]);
      due.add(key);
      const entry = workers.get(key);
      if (entry) entry.seen = now;
      else serve(scope, key);
    }
    for (const [key, entry] of workers)
      if (!entry.running && !due.has(key) && now - entry.seen > IDLE_MS) {
        workers.delete(key);
        void entry.worker.stop({ drainMs: 0 });
      }
  }

  let closed = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    polling: Promise<void> | undefined;
  function arm() {
    if (closed) return;
    timer = setTimeout(async () => {
      try {
        await (polling = poll());
      } catch (error) {
        if (!closed) options.warn('callback poll failed error="' + reason(error) + '"');
      } finally {
        arm();
      }
    }, POLL_MS);
  }
  arm();
  return {
    /** Stops polling and gives calls in flight up to 2.5 seconds, inside the daemon's stop budget. */
    async close() {
      closed = true;
      clearTimeout(timer);
      await polling?.catch(() => {});
      await Promise.all([...workers.values()].map(({ worker }) => worker.stop({ drainMs: 2500 })));
    },
  };
}
