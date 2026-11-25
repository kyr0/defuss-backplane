/** VERIFIED: tests/log.test.ts and tests/workspace.test.ts. The service's own log: one line per event on stdout or stderr, ISO-8601 UTC timestamp first, and the same event as a
 * defuss-logs record in the backplane's app log of `linear-clone`, where agents read it with `logs.read`. Why both: the
 * console line survives a backplane that is down, and the record is searchable without access to the host. */
import { createBatchSink, createLogger } from "defuss-logs/client";

export type Level = "info" | "warn" | "error";
export type Fields = Record<string, string | number | boolean | null | undefined>;
type Writer = Parameters<typeof createBatchSink>[0];

/** `key=value` pairs; a value with spaces, quotes, `=` or line breaks is JSON-quoted, so a line stays one line. */
export function format(level: Level, message: string, fields: Fields = {}, now = new Date()) {
  const pairs = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const text = String(value);
      return key + "=" + (/^[^\s"=]+$/.test(text) ? text : JSON.stringify(text));
    });
  return [now.toISOString(), level.toUpperCase(), JSON.stringify(message).slice(1, -1), ...pairs].join(" ");
}

export type Log = ReturnType<typeof createLog>;

/** A log that prints each line and writes it to `writer`, the backplane client's `logs()` handle. A failed write is
 * printed once per failure and never throws into the caller. */
export function createLog(writer: Writer | null, print: (level: Level, line: string) => void = defaultPrint) {
  const logger = writer
    ? createLogger({
        sink: createBatchSink(writer),
        parallelSink: true,
        context: { service: "linear-clone" },
        onError: (error) => print("warn", format("warn", "log record not stored", { error: String(error) })),
      })
    : null;
  const emit = (level: Level) => (message: string, fields: Fields = {}) => {
    print(level, format(level, message, fields));
    // VERIFIED: a probe showed that extra arguments of `write` are formatted into the message (`probe line [Object]`), so the
    // fields go into a child logger's context and the stored message stays the message.
    const context = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
    logger?.child(context).write(level, message).catch((error) =>
      print("warn", format("warn", "log record not stored", { error: String(error) })),
    );
  };
  return {
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    /** Waits until every record so far is stored. */
    flush: async () => {
      await logger?.flush();
    },
    close: async () => {
      await logger?.close();
    },
  };
}

function defaultPrint(level: Level, line: string) {
  (level === "info" ? process.stdout : process.stderr).write(line + "\n");
}
