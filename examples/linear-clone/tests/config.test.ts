import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/server/config.ts";

const key = { BACKPLANE_API_KEY: "bot-key" };

test("only the bot key is required; every other key has a default", () => {
  expect(loadConfig(key)).toEqual({
    port: 43180,
    backplanePort: 43127,
    backplaneApiKey: "bot-key",
    workspace: "vector",
    publicOrigin: "http://127.0.0.1:43180",
    authMode: "cookie",
    timeZone: "UTC",
    digestCron: "0 9 * * *",
    rolloverCron: "0 0 * * 1",
  });
});

test("the keys of .env.example, filled in, configure the service", () => {
  const example = Object.fromEntries(
    readFileSync(new URL("../.env.example", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as [string, string]),
  );
  expect(Object.keys(example).sort()).toEqual([
    "AGENT_API_KEY",
    "AUTH_MODE",
    "BACKPLANE_API_KEY",
    "BACKPLANE_PORT",
    "DIGEST_CRON",
    "PORT",
    "PUBLIC_ORIGIN",
    "ROLLOVER_CRON",
    "TIME_ZONE",
    "WORKSPACE",
  ]);
  const config = loadConfig({
    ...example,
    ...key,
    PORT: "8080",
    WORKSPACE: "cafe-ops",
    PUBLIC_ORIGIN: "https://tracker.example",
    AUTH_MODE: "token",
    TIME_ZONE: "Europe/Berlin",
  });
  expect(config).toMatchObject({
    port: 8080,
    backplanePort: 43127,
    workspace: "cafe-ops",
    publicOrigin: "https://tracker.example",
    authMode: "token",
    timeZone: "Europe/Berlin",
  });
});

test("an empty key takes its default, as a copied .env.example leaves them", () => {
  expect(loadConfig({ ...key, PORT: "", WORKSPACE: "", PUBLIC_ORIGIN: "", AUTH_MODE: "" })).toMatchObject({
    port: 43180,
    workspace: "vector",
    publicOrigin: "http://127.0.0.1:43180",
    authMode: "cookie",
  });
});

test.each([
  [{ PORT: "0" }, "PORT must be an integer from 1 to 65535"],
  [{ PORT: "65536" }, "PORT must be an integer from 1 to 65535"],
  [{ PORT: "80.5" }, "PORT must be an integer from 1 to 65535"],
  [{ BACKPLANE_PORT: "http" }, "BACKPLANE_PORT must be an integer from 1 to 65535"],
  [{ BACKPLANE_API_KEY: "" }, "BACKPLANE_API_KEY is required"],
  [{ BACKPLANE_API_KEY: "bot key" }, "BACKPLANE_API_KEY must contain printable ASCII without whitespace"],
  [{ BACKPLANE_API_KEY: "schlüssel" }, "BACKPLANE_API_KEY must contain printable ASCII without whitespace"],
  [{ WORKSPACE: "Café Ops" }, "WORKSPACE must have 1 to 48 letters, digits, - and _"],
  [{ WORKSPACE: "w".repeat(49) }, "WORKSPACE must have 1 to 48 letters, digits, - and _"],
  [{ PUBLIC_ORIGIN: "https://tracker.example/app" }, "PUBLIC_ORIGIN must be an origin"],
  [{ AUTH_MODE: "session" }, "AUTH_MODE must be cookie or token"],
  [{ TIME_ZONE: "Mars/Olympus" }, "TIME_ZONE must be an IANA time zone such as Europe/Berlin"],
  [{ DIGEST_CRON: "daily" }, "DIGEST_CRON must be a cron expression of 5 or 6 fields"],
  [{ ROLLOVER_CRON: "0 0 * *" }, "ROLLOVER_CRON must be a cron expression of 5 or 6 fields"],
])("%p fails startup with %p", (overrides, message) => {
  expect(() => loadConfig({ ...key, ...overrides })).toThrow(message);
});

test("one error names every invalid key", () => {
  expect(() => loadConfig({ PORT: "x", BACKPLANE_PORT: "0" })).toThrow(
    "Invalid configuration: PORT must be an integer from 1 to 65535; BACKPLANE_PORT must be an integer from 1 to 65535; BACKPLANE_API_KEY is required",
  );
});
