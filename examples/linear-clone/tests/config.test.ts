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
    viewer: "aron",
  });
});

test("the keys of .env.example, filled in, configure the service", () => {
  const example = Object.fromEntries(
    readFileSync(new URL("../.env.example", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => line.split("=", 2) as [string, string]),
  );
  expect(Object.keys(example).sort()).toEqual(["BACKPLANE_API_KEY", "BACKPLANE_PORT", "PORT", "VIEWER", "WORKSPACE"]);
  const config = loadConfig({ ...example, ...key, PORT: "8080", WORKSPACE: "Café Ops", VIEWER: "anna" });
  expect(config).toMatchObject({ port: 8080, backplanePort: 43127, workspace: "Café Ops", viewer: "anna" });
});

test("an empty key takes its default, as a copied .env.example leaves them", () => {
  expect(loadConfig({ ...key, PORT: "", WORKSPACE: "", VIEWER: "" })).toMatchObject({
    port: 43180,
    workspace: "vector",
    viewer: "aron",
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
  // 25 characters, 50 bytes: the limit counts bytes.
  [{ WORKSPACE: "ü".repeat(25) }, "WORKSPACE must have at most 48 UTF-8 bytes"],
])("%p fails startup with %p", (overrides, message) => {
  expect(() => loadConfig({ ...key, ...overrides })).toThrow(message);
});

test("one error names every invalid key", () => {
  expect(() => loadConfig({ PORT: "x", BACKPLANE_PORT: "0" })).toThrow(
    "Invalid configuration: PORT must be an integer from 1 to 65535; BACKPLANE_PORT must be an integer from 1 to 65535; BACKPLANE_API_KEY is required",
  );
});
