import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createRpcContext } from "defuss-rpc/client";
import { parseFault } from "../src/core/faults.ts";
import type { Seed } from "../src/core/seed.ts";
import type { Api } from "../src/server/api.ts";
import { loadConfig } from "../src/server/config.ts";
import { uploadIdOf } from "../src/core/ids.ts";
import { MAX_ATTACHMENT_BYTES, type Server, startServer } from "../src/server/server.ts";
import { type Daemon, freePort, startDaemon } from "./helpers/daemon.ts";

const seed: Seed = await Bun.file(new URL("../input/seed.json", import.meta.url)).json();
let daemon: Daemon;
let server: Server;
let publicDir: string;
let rpc: Api;
let ctx: ReturnType<typeof createRpcContext>;

/** The fault a failed call carries: its HTTP status and the code in its body. */
const fault = (call: Promise<unknown>) =>
  call.then(
    () => "OK",
    (e: { status?: number; body?: string; message?: string }) => {
      const f = parseFault(e.body ?? e.message ?? "");
      return e.status + " " + f.code + (f.field ? "(" + f.field + ")" : "");
    },
  );

beforeAll(async () => {
  daemon = await startDaemon();
  publicDir = await mkdtemp(join(tmpdir(), "linear-clone-public-"));
  await writeFile(join(publicDir, "index.html"), "<!doctype html><title>Vector</title>");
  const config = loadConfig({
    PORT: String(await freePort()),
    BACKPLANE_PORT: String(daemon.port),
    BACKPLANE_API_KEY: daemon.apiKey,
    TIME_ZONE: "Europe/Berlin",
  });
  server = await startServer(config, { publicDir, seed, now: () => new Date("2026-10-03T12:00:00Z") });
  ctx = createRpcContext({ baseUrl: server.url });
  rpc = await ctx.getRpcClient<Api>();
});
afterAll(async () => {
  await server?.close();
  await daemon?.stop();
  await rm(publicDir, { recursive: true, force: true });
});

describe("RPC", () => {
  test("Workspace.bootstrap returns the directory, the viewer and today", async () => {
    const boot = await rpc.Workspace.bootstrap();
    expect(boot).toMatchObject({ workspace: "vector", viewer: "aron", timeZone: "Europe/Berlin", today: "2026-10-03" });
    expect([boot.people.length, boot.teams.length, boot.projects.length, boot.cycles.length]).toEqual([6, 1, 5, 1]);
  });

  test("Issues.list and Issues.get return the seeded issues with their page content", async () => {
    expect((await rpc.Issues.list()).map((i) => i.id).slice(0, 2)).toEqual(["ENG-142", "ENG-141"]);
    const page = await rpc.Issues.get("ENG-142");
    expect(page.issue.title).toBe("Command palette results flicker on fast typing");
    expect([page.comments.length, page.events.length, page.attachments.length]).toEqual([2, 3, 0]);
    expect(typeof page.revision).toBe("string");
    expect(await fault(rpc.Issues.get("ENG-999"))).toBe("404 NOT_FOUND");
    expect(await fault(rpc.Issues.get("eng 1"))).toBe("400 INVALID_INPUT(id)");
  });

  test("Issues.create, update with a revision, comment and remove", async () => {
    expect(await fault(rpc.Issues.create({ title: " " }))).toBe("400 INVALID_INPUT(title)");
    const created = await rpc.Issues.create({ title: "Keyboard map", priority: "high", assignee: "marco" });
    expect(created.issue).toMatchObject({ id: "ENG-143", priority: "high", assignee: "marco" });
    const moved = await rpc.Issues.update("ENG-143", { status: "progress" }, created.revision);
    expect(moved.issue.status).toBe("progress");
    expect(await fault(rpc.Issues.update("ENG-143", { status: "done" }, created.revision))).toBe("409 REVISION_CONFLICT");
    expect(await fault(rpc.Issues.update("ENG-143", { status: "closed" as never }))).toBe("400 INVALID_INPUT(status)");
    expect((await rpc.Issues.comment("ENG-143", "On it")).body).toBe("On it");
    expect(await fault(rpc.Issues.comment("ENG-143", ""))).toBe("400 INVALID_INPUT(body)");
    expect(await rpc.Issues.remove("ENG-143")).toBe(true);
    expect(await fault(rpc.Issues.remove("ENG-143"))).toBe("404 NOT_FOUND");
  });

  test("Inbox.list and Inbox.markRead serve the viewer's items", async () => {
    const items = await rpc.Inbox.list();
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.every((n) => n.person === "aron")).toBe(true);
    expect(await rpc.Inbox.markRead([items.find((n) => !n.read)!.id])).toBe(1);
    expect(await rpc.Inbox.markRead()).toBeGreaterThan(0);
    expect(await fault(rpc.Inbox.markRead("n-1" as never))).toBe("400 INVALID_INPUT(ids)");
    expect((await rpc.Inbox.list()).some((n) => !n.read)).toBe(false);
  });

  test("Cycles.current and Cycles.stats return the running cycle's numbers", async () => {
    const current = await rpc.Cycles.current();
    expect(current?.cycle.id).toBe("eng-24");
    expect(current?.stats).toMatchObject({ scope: 15, days: 14, daysLeft: 9 });
    expect((await rpc.Cycles.stats("eng-24")).scope).toBe(15);
    expect(await fault(rpc.Cycles.stats("eng-1"))).toBe("404 NOT_FOUND");
    expect(await fault(rpc.Cycles.stats(null as never))).toBe("400 INVALID_INPUT(id)");
  });
});

describe("attachments", () => {
  test("an upload streams into the issue's attachments and downloads byte for byte", async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(200_000));
    const uploaded = await ctx.uploadComplete("attachment", bytes, {
      uploadId: uploadIdOf("ENG-141"),
      originalFilename: "trace.bin",
    });
    expect(uploaded.result).toMatchObject({ name: "trace.bin", size: bytes.length });
    expect((await rpc.Issues.attachments("ENG-141")).map((a) => a.name)).toEqual(["trace.bin"]);
    const file = await ctx.download("attachment", undefined, { downloadId: "ENG-141/trace.bin" });
    expect(new Uint8Array(file.data as unknown as ArrayBuffer)).toEqual(bytes);
    expect(file.filename).toBe("trace.bin");
    expect(await rpc.Issues.removeAttachment("ENG-141", "trace.bin")).toBe(true);
    expect(await fault(ctx.download("attachment", undefined, { downloadId: "ENG-141/trace.bin" }))).toMatch(/^404 /);
    expect(await fault(ctx.download("attachment", undefined, { downloadId: "no-slash" }))).toMatch(/^404 /);
    expect(await fault(ctx.download("attachment", undefined, { downloadId: "ENG-141/../x" }))).toMatch(/^404 /);
  });

  test("uploads to a missing issue, with a bad name or above the limit are refused before their bytes arrive", async () => {
    const small = new Uint8Array(10);
    const upload = (issue: string, name: string, data = small) =>
      ctx.uploadComplete("attachment", data, { uploadId: uploadIdOf(issue), originalFilename: name, progress: false });
    expect(await fault(upload("ENG-999", "a.txt"))).toMatch(/^403 /);
    expect(await fault(upload("ENG-141", "a/b.txt"))).toMatch(/^403 /);
    expect(await fault(upload("ENG-141", "big.bin", new Uint8Array(MAX_ATTACHMENT_BYTES + 1)))).toMatch(/^403 /);
  });
});

describe("MCP and HTTP", () => {
  test("the API is a set of MCP tools whose calls run through the same RPC functions", async () => {
    const agent = new Client({ name: "test", version: "1" });
    await agent.connect(new StreamableHTTPClientTransport(new URL(server.url + "/mcp")));
    const names = (await agent.listTools()).tools.map((t) => t.name);
    expect(names).toContain("Issues.list");
    expect(names).toContain("Workspace.bootstrap");
    const page = await agent.callTool({ name: "Issues.get", arguments: { args: ["ENG-140"] } });
    expect((page.structuredContent as { value: { issue: { id: string } } }).value.issue.id).toBe("ENG-140");
    const missing = await agent.callTool({ name: "Issues.get", arguments: { args: ["ENG-999"] } });
    expect(missing.isError).toBe(true);
    // VERIFIED: the bridge reports a failed call by its HTTP status only, which the server derives from the code.
    expect(JSON.stringify(missing.content)).toContain("HTTP 404");
    await agent.close();
  });

  test("the frontend is served from the public directory, and a foreign Host is refused", async () => {
    expect(await (await fetch(server.url + "/")).text()).toContain("<title>Vector</title>");
    expect((await fetch(server.url + "/", { headers: { Host: "evil.example" } })).status).toBe(403);
  });

  test("liveness answers while the app serves; readiness also needs the backplane and fails without it", async () => {
    for (const path of ["/livez", "/healthz"])
      expect(await (await fetch(server.url + path)).json()).toEqual({ service: "linear-clone", status: "pass" });
    for (const path of ["/readyz", "/health"]) {
      const ready = await fetch(server.url + path);
      expect([ready.status, await ready.json()]).toEqual([200, { service: "linear-clone", status: "pass", checks: [{ name: "backplane", status: "pass" }] }]);
    }
    const own = await startDaemon();
    const alone = await startServer(
      loadConfig({ PORT: String(await freePort()), BACKPLANE_PORT: String(own.port), BACKPLANE_API_KEY: own.apiKey }),
      { publicDir, seed },
    );
    try {
      await own.stop();
      const down = await fetch(alone.url + "/readyz");
      expect([down.status, await down.json()]).toEqual([503, { service: "linear-clone", status: "fail", checks: [{ name: "backplane", status: "fail" }] }]);
      expect((await fetch(alone.url + "/livez")).status).toBe(200);
    } finally {
      await alone.close().catch(() => {});
    }
  });
});
