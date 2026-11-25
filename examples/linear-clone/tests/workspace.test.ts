import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connectBackplane } from "defuss-backplane/client";
import { InvalidInput } from "../src/core/issue.ts";
import type { Seed } from "../src/core/seed.ts";
import { isCode, NotFound, openWorkspace, type Workspace } from "../src/server/workspace.ts";
import { type Daemon, startDaemon } from "./helpers/daemon.ts";

const seed: Seed = await Bun.file(new URL("../input/seed.json", import.meta.url)).json();
// The seed's own day, so the shifted dates equal the file's.
const now = () => new Date("2026-10-03T12:00:00Z");
let daemon: Daemon;
let ws: Workspace;
let other = 0;
const open = (workspace: string) =>
  openWorkspace({ port: daemon.port, apiKey: daemon.apiKey, workspace, timeZone: "Europe/Berlin", now });
/** A workspace of its own per test, so tests do not see each other's issues. */
async function fresh() {
  const w = await open("test-" + ++other);
  await w.seed(seed);
  return w;
}

beforeAll(async () => {
  daemon = await startDaemon();
  ws = await open("vector");
});
afterAll(async () => {
  await ws?.close();
  await daemon?.stop();
});

describe("seed", () => {
  test("an empty workspace gets the demo; a second seed changes nothing", async () => {
    expect(await ws.seed(seed)).toBe(true);
    const { people, teams, projects, cycles } = await ws.directory();
    expect([people.length, teams.length, projects.length, cycles.length]).toEqual([6, 1, 5, 1]);
    expect((await ws.issues.list()).map((i) => i.id)).toEqual(seed.issues.map((i) => i.id).sort().reverse());
    await ws.issues.remove("ENG-128", "aron");
    expect(await ws.seed(seed)).toBe(false);
    await expect(ws.issues.get("ENG-128")).rejects.toBeInstanceOf(NotFound);
  });

  test("seeding on another day moves the demo's dates to that day", async () => {
    const later = await openWorkspace({
      port: daemon.port,
      apiKey: daemon.apiKey,
      workspace: "shifted",
      timeZone: "UTC",
      now: () => new Date("2026-11-25T08:00:00Z"),
    });
    await later.seed(seed);
    const [cycle] = (await later.directory()).cycles;
    // 53 days after 2026-10-03.
    expect(cycle).toMatchObject({ start: "2026-11-20", end: "2026-12-03" });
    expect((await later.issues.get("ENG-142")).issue.due).toBe("2026-11-26");
    await later.close();
  });
});

describe("issues", () => {
  test("create, read, update and delete, with the activity they leave", async () => {
    const w = await fresh();
    const created = await w.issues.create({ title: "Export as CSV", assignee: "anna", labels: ["feature"] }, "aron");
    expect(created.issue).toMatchObject({ id: "ENG-143", number: 143, status: "todo", assignee: "anna" });
    const moved = await w.issues.update("ENG-143", { status: "done" }, "aron", created.revision);
    expect(moved.issue).toMatchObject({ status: "done", completedAt: now().toISOString() });
    expect(moved.revision).not.toBe(created.revision);
    expect((await w.events.list("ENG-143")).map((e) => [e.kind, e.field ?? null, e.to ?? null])).toEqual([
      ["created", null, null],
      ["changed", "status", "done"],
    ]);
    // Anna hears of the assignment and of the move, both made by someone else.
    expect((await w.inbox.list("anna")).map((n) => n.kind).sort()).toEqual(["assigned", "status"]);
    await w.issues.remove("ENG-143", "aron");
    await expect(w.issues.get("ENG-143")).rejects.toBeInstanceOf(NotFound);
    expect(await w.events.list("ENG-143")).toEqual([]);
    await w.close();
  });

  test("a write with a stale revision fails with REVISION_CONFLICT and changes nothing", async () => {
    const w = await fresh();
    const { revision } = await w.issues.get("ENG-140");
    await w.issues.update("ENG-140", { priority: "urgent" }, "anna");
    const error = await w.issues.update("ENG-140", { title: "Stale" }, "aron", revision).catch((e) => e);
    expect(isCode(error, "REVISION_CONFLICT")).toBe(true);
    expect((await w.issues.get("ENG-140")).issue.title).toBe("Review the new onboarding checklist");
    await w.close();
  });

  test("20 concurrent creates get 20 distinct, consecutive numbers", async () => {
    const w = await fresh();
    const created = await Promise.all(Array.from({ length: 20 }, (_, i) => w.issues.create({ title: "Load " + i }, "aron")));
    const numbers = created.map((c) => c.issue.number).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => 143 + i));
    await w.close();
  });

  test("references to unknown people, projects and cycles and missing issues are refused", async () => {
    const w = await fresh();
    for (const [field, value] of [
      ["assignee", "nobody"],
      ["project", "moonshot"],
      ["cycle", "eng-99"],
    ] as const) {
      const error = await w.issues.create({ title: "x", [field]: value }, "aron").catch((e) => e);
      expect(error).toBeInstanceOf(InvalidInput);
      expect(error.field).toBe(field);
    }
    await expect(w.issues.update("ENG-999", { status: "done" }, "aron")).rejects.toBeInstanceOf(NotFound);
    await expect(w.comments.add("ENG-999", "aron", "hi")).rejects.toBeInstanceOf(NotFound);
    await w.close();
  });
});

describe("comments and inbox", () => {
  test("a comment reaches the assignee's inbox, and marking read clears it", async () => {
    const w = await fresh();
    const comment = await w.comments.add("ENG-139", "aron", "  Looks good  ");
    expect(comment).toMatchObject({ issue: "ENG-139", author: "aron", body: "Looks good" });
    expect((await w.comments.list("ENG-139")).map((c) => c.body)).toEqual(["Looks good"]);
    const priya = await w.inbox.list("priya");
    expect(priya.map((n) => [n.kind, n.detail, n.read])).toEqual([["comment", "Looks good", false]]);
    expect(await w.inbox.markRead("priya")).toBe(1);
    expect((await w.inbox.list("priya"))[0]!.read).toBe(true);
    // The viewer's seeded inbox: 4 of 6 unread in the scaffold.
    expect((await w.inbox.list("aron")).filter((n) => !n.read)).toHaveLength(4);
    await w.close();
  });

  test("items with fixed IDs are added once", async () => {
    const w = await fresh();
    const item = {
      id: "digest:2026-10-03:ENG-142",
      person: "aron",
      kind: "due" as const,
      issue: "ENG-142",
      actor: null,
      detail: "2026-10-04",
      read: false,
      at: now().toISOString(),
    };
    expect(await w.inbox.add([item])).toBe(1);
    expect(await w.inbox.add([item])).toBe(0);
    await w.close();
  });
});

describe("cycle statistics", () => {
  test("the cycle's numbers come from the cache until an issue write clears them", async () => {
    const w = await fresh();
    const stats = await w.cycles.stats("eng-24");
    // VERIFIED: the scaffold shows a scope of 15, 3 completed and 9 of 14 days left.
    expect(stats).toMatchObject({ scope: 15, done: 3, days: 14, daysLeft: 9 });
    const cache = (await connectBackplane({ app: "linear-clone", port: daemon.port, apiKey: daemon.apiKey }))
      .tenant("test-" + other)
      .cache("stats");
    expect((await cache.get("stats:eng-24")).hit).toBe(true);
    await w.issues.update("ENG-141", { status: "done" }, "aron");
    expect((await cache.get("stats:eng-24")).hit).toBe(false);
    expect((await w.cycles.stats("eng-24")).done).toBe(4);
    await expect(w.cycles.stats("eng-1")).rejects.toBeInstanceOf(NotFound);
    await w.close();
  });
});

describe("attachments", () => {
  test("a file round-trips byte for byte, is listed, and goes with its issue", async () => {
    const w = await fresh();
    const bytes = crypto.getRandomValues(new Uint8Array(300_000));
    const stored = await w.attachments.upload("ENG-142", "trace.bin", bytes, "aron");
    expect(stored).toMatchObject({ name: "trace.bin", size: bytes.length });
    const download = await w.attachments.download("ENG-142", "trace.bin");
    if (!download.found) throw new Error("missing");
    expect(new Uint8Array(await new Response(download.stream).arrayBuffer())).toEqual(bytes);
    expect((await w.attachments.list("ENG-142")).map((a) => a.name)).toEqual(["trace.bin"]);
    await expect(w.attachments.upload("ENG-142", "../x", bytes, "aron")).rejects.toBeInstanceOf(InvalidInput);
    await expect(w.attachments.upload("ENG-999", "x.bin", bytes, "aron")).rejects.toBeInstanceOf(NotFound);
    await w.issues.remove("ENG-142", "aron");
    expect((await w.attachments.download("ENG-142", "trace.bin")).found).toBe(false);
    await w.close();
  });
});

describe("logs", () => {
  test("service lines reach the app log and audit events the tenant log", async () => {
    const w = await fresh();
    w.log.info("probe line", { marker: "m2" });
    await w.log.flush();
    await w.issues.update("ENG-138", { status: "review" }, "aron");
    const client = await connectBackplane({ app: "linear-clone", port: daemon.port, apiKey: daemon.apiKey });
    const app = await client.logs().read({ limit: 1000 });
    expect(app.records.some((r) => r.message === "probe line")).toBe(true);
    const audit = await client.tenant("test-" + other).logs().read({ limit: 1000 });
    expect(audit.records.map((r) => r.message)).toContain("issue moved");
    await w.close();
  });
});
