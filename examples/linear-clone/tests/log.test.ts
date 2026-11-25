import { expect, test } from "bun:test";
import { createLog, format } from "../src/server/log.ts";

const at = new Date("2026-10-03T12:00:00.123Z");

test("a line is the ISO timestamp, the level, the message and key=value pairs", () => {
  expect(format("info", "listening", { url: "http://127.0.0.1:43180", ready: true, skipped: undefined }, at)).toBe(
    "2026-10-03T12:00:00.123Z INFO listening url=http://127.0.0.1:43180 ready=true",
  );
});

test("values with spaces, quotes or line breaks are quoted, so one event stays one line", () => {
  const line = format("warn", "bad\nmessage", { error: 'said "no"\nthen left', key: "a=b" }, at);
  expect(line).toBe('2026-10-03T12:00:00.123Z WARN bad\\nmessage error="said \\"no\\"\\nthen left" key="a=b"');
  expect(line.includes("\n")).toBe(false);
});

test("without a backplane the log still prints, info to stdout and warnings to stderr", async () => {
  const printed: string[] = [];
  const log = createLog(null, (level, line) => printed.push(level + "|" + line.split(" ").slice(1).join(" ")));
  log.info("one");
  log.warn("two", { n: 2 });
  log.error("three");
  await log.flush();
  await log.close();
  expect(printed).toEqual(["info|INFO one", "warn|WARN two n=2", "error|ERROR three"]);
});
