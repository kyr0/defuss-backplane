/** VERIFIED: The daemon writes every line of its own through one defuss-logs logger. A line goes to stdout or stderr
 * as before, so `make log` and supervisors keep reading it, and into the `_backplane` app log, where it keeps its
 * level and timestamp as typed fields. */
import { createBatchSink, createLogger, type LogLevel } from "defuss-logs/client";
import type { LogStore } from "defuss-logs";

const errors = new Set<LogLevel>(["warn", "error", "fatal"]);
/** One line: ISO-8601 UTC timestamp, level, message. Warnings and errors go to stderr. A line break in the message,
 * such as one in an app's response body, is escaped, so no message can split a line or forge the next one. */
export function print(level: LogLevel, message: string, ts = new Date()) {
  (errors.has(level) ? process.stderr : process.stdout).write(
    ts.toISOString() + " " + level.toUpperCase() + " " + message.replace(/\r/g, "\\r").replace(/\n/g, "\\n") + "\n",
  );
}
export const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createDaemonLog(store: LogStore) {
  const batch = createBatchSink(store);
  // The logger or its store failed, so the failure goes to stderr only.
  const failed = (error: unknown) => print("error", 'log write failed error="' + reason(error) + '"');
  const logger = createLogger({
    sink: (record) => {
      print(record.level, record.message, record.ts);
      return batch(record);
    },
    parallelSink: true,
    // A bearer token that reaches an error message stays out of both the line and the store.
    redact: { rules: [{ pattern: /Bearer\s+\S+/gi }] },
    onError: failed,
  });
  const write = (level: LogLevel) => (message: string) => void logger.write(level, message).catch(failed);
  return {
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    /** Writes the pending lines, then closes the store. */
    async close() {
      try {
        await logger.close();
        await batch.close();
      } finally {
        await store.close();
      }
    },
  };
}
export type DaemonLog = ReturnType<typeof createDaemonLog>;
