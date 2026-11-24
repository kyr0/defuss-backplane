/** VERIFIED: Logs are defuss-logs 0.3.0 stores. Each app has one log, and each of its tenants one more inside the
 * tenant directory, so deleting a tenant's directory deletes its log with its data. Records keep their DSON types. */
import { join } from "node:path";
import {
  LOG_LEVELS,
  newLogId,
  recordKey,
  type LogLevel,
  type LogRecord,
  type LogStore,
} from "defuss-logs";
import { openFileLogStore } from "defuss-logs/server";
import { HandlePool } from "./pool.js";
import { appComponent, component, record } from "./scope.js";
import { containsStore, directory } from "./storage.js";

/** Without a tenant, the scope names the app's own log. */
export type LogScope = { app: string; tenant?: string };
/** A record to append. The daemon assigns `id` and `ts` when the caller leaves them out. */
export type LogEntry = {
  readonly level: LogLevel;
  readonly message: string;
  readonly args?: readonly unknown[];
  readonly context?: Readonly<Record<string, unknown>>;
  readonly ts?: Date;
  readonly id?: string;
  readonly v?: 1;
};
export type LogReadRequest = {
  from?: Date;
  before?: Date;
  levels?: LogLevel[];
  limit?: number;
  after?: string | null;
};
export type LogPage = { records: LogRecord[]; nextAfter: string | null };

/** The app name of the daemon's own log. `appComponent` rejects it, so no caller can write it; `logs.read` reads it
 * through the daemon's handle, so agents and people can debug the daemon without access to its data root. */
export const OWN_APP = "_backplane";
const MAX_ENTRIES = 1000;
// VERIFIED from the defuss-logs README: the level index is fixed on first open, and it serves a read of one or two
// levels without scanning the others. Reading warnings and errors is the common query.
const options = { levelIndex: true, maxBatchRecords: MAX_ENTRIES } as const;
const CURSOR = /^r\/\d{16}\/[a-f0-9-]{16,64}$/i;

/** `<app>/logs` or `<app>/<tenant>/logs`. Encoded names end with `-` and 8 hex digits, so `logs` collides with no
 * tenant directory, and a tenant directory holds only `cache`, `db`, `vfs` and `logs`. */
function logPath(root: string, scope: LogScope, app: (value: unknown) => string) {
  record(scope, "scope");
  if (Object.keys(scope).some((k) => k !== "app" && k !== "tenant"))
    throw new TypeError("A log scope holds app and an optional tenant");
  const base = join(root, app(scope.app));
  return scope.tenant === undefined
    ? join(base, "logs")
    : join(base, component(scope.tenant), "logs");
}
function toRecord(entry: unknown, now: Date): LogRecord {
  record(entry, "log entry");
  if (
    Object.keys(entry).some(
      (k) => !["v", "id", "ts", "level", "message", "args", "context"].includes(k),
    )
  )
    throw new TypeError("Unsupported log entry field");
  const { v = 1, id = newLogId(), ts = now, level, message, args = [], context } = entry;
  if (v !== 1) throw new TypeError("Log entries have version 1");
  if (!(ts instanceof Date)) throw new TypeError("ts must be a Date");
  if (!LOG_LEVELS.includes(level as LogLevel))
    throw new TypeError("level must be one of " + LOG_LEVELS.join(", "));
  if (typeof message !== "string") throw new TypeError("message must be a string");
  if (!Array.isArray(args)) throw new TypeError("args must be an array");
  if (context !== undefined) record(context, "context");
  const result = {
    v: 1,
    id,
    ts,
    level,
    message,
    args,
    ...(context !== undefined && { context }),
  } as LogRecord;
  // Checks the ID's form and that the timestamp is a valid date after 1970.
  recordKey(result);
  return result;
}
function date(value: unknown, name: string) {
  if (value !== undefined && !(value instanceof Date && !Number.isNaN(value.getTime())))
    throw new TypeError(name + " must be a valid Date");
  return value as Date | undefined;
}
/** Checks a read request before any store opens, so an absent log rejects the same requests an existing one does. */
function scan(request: LogReadRequest) {
  record(request, "request");
  if (Object.keys(request).some((k) => !["from", "before", "levels", "limit", "after"].includes(k)))
    throw new TypeError("Unsupported read field");
  const { levels, limit = 100, after = null } = request;
  let from = date(request.from, "from");
  const before = date(request.before, "before");
  if (levels !== undefined && (!Array.isArray(levels) || !levels.length))
    throw new TypeError("levels must name at least one level");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ENTRIES)
    throw new TypeError("limit must be an integer from 1 to 1000");
  if (after !== null) {
    if (typeof after !== "string" || !CURSOR.test(after))
      throw new TypeError("after must be a nextAfter value");
    const cursor = new Date(Number(after.slice(2, 18)));
    if (!from || cursor > from) from = cursor;
  }
  return { from, before, levels, limit, after };
}
/** Reads one page in time order. `after` is the key of the last record of the previous page, so records written in
 * the same millisecond are neither repeated nor skipped: keys order them by ID. */
async function page(log: LogStore, { from, before, levels, limit, after }: ReturnType<typeof scan>): Promise<LogPage> {
  const records: LogRecord[] = [];
  let last: string | null = null;
  for await (const entry of log.entries({ from, before, levels })) {
    if (after !== null && entry.key <= after) continue;
    if (records.length === limit) return { records, nextAfter: last };
    records.push(entry.record);
    last = entry.key;
  }
  return { records, nextAfter: null };
}

/** Opens the daemon's own log outside the pool: no caller can address it, and it stays open while the daemon runs. */
export async function openOwnLog(root: string) {
  // `_backplane` itself names the directory: no encoded name starts with `_`, so no app directory collides with it.
  return openFileLogStore(await directory(logPath(root, { app: OWN_APP }, () => OWN_APP)), "log", options);
}

/** True for exactly `{ app: "_backplane" }`: the daemon's log has no tenant logs. */
function isOwnLog(scope: LogScope) {
  return (
    (scope as LogScope | null)?.app === OWN_APP &&
    scope.tenant === undefined &&
    Object.keys(scope).every((k) => k === "app" || k === "tenant")
  );
}

/** `own` is the daemon's open log. Without it, as in the storage tests, `_backplane` stays reserved for reads too. */
export function createLogs(root: string, own?: LogStore) {
  const stores = new HandlePool<LogStore>(
    async (path, create) =>
      openFileLogStore(create ? await directory(path) : path, "log", { ...options, create }),
    32,
    containsStore,
  );
  const api = {
    /** Appends 1 to 1000 entries in one transaction: all of them or none. */
    async write(scope: LogScope, entries: readonly LogEntry[]): Promise<{ written: number }> {
      const path = logPath(root, scope, appComponent);
      if (!Array.isArray(entries) || !entries.length || entries.length > MAX_ENTRIES)
        throw new TypeError("entries must hold 1 to 1000 log entries");
      const now = new Date();
      const records = entries.map((entry) => toRecord(entry, now));
      return stores.use(path, (log) => log.appendBatchAtomic(records));
    },
    async read(scope: LogScope, request: LogReadRequest = {}): Promise<LogPage> {
      // The handle the daemon writes with, so no second handle opens the same store in this process.
      if (own && isOwnLog(scope)) return page(own, scan(request));
      const path = logPath(root, scope, appComponent);
      const options = scan(request);
      return stores.use(
        path,
        (log) => page(log, options),
        () => ({ records: [], nextAfter: null }),
      );
    },
  };
  return {
    api,
    handles: () => stores.stats(),
    close: () => stores.close(),
  };
}
