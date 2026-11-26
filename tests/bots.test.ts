import { test, expect } from "bun:test";
import { randomBytes } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createRpcServer } from "defuss-rpc/server";
import { BackplaneError, connectBackplane } from "../src/client.js";
import { start } from "./daemon.js";

const fault = (promise: Promise<unknown>) =>
  promise.then(
    () => "OK",
    (e: unknown) => (e instanceof BackplaneError ? e.code + " " + e.status : String(e)),
  );
const scope = (app: string) => ({ app, tenant: "acme", bucket: "b" });

test("a bot key reaches only its apps, over RPC, MCP and both object routes", async () => {
  const { daemon, stop } = await start({ BACKPLANE_AUTH_MASTER_KEY: randomBytes(32).toString("base64url") });
  const root = await connectBackplane({ app: "shop" });
  const bot = await root.bots.create({ name: "shop service", apps: ["shop"] });
  expect(bot).toMatchObject({ name: "shop service", apps: ["shop"], admin: false });
  const agent = new Client({ name: "bot", version: "1" });
  await agent.connect(
    new StreamableHTTPClientTransport(new URL(daemon.url + "/mcp"), {
      requestInit: { headers: { Authorization: "ApiKey " + bot.key } },
    }),
  );
  try {
    const shop = await connectBackplane({ app: "shop", apiKey: bot.key });
    await shop.tenant("acme").cache("b").set("k", 1);
    expect(await shop.tenant("acme").cache("b").get("k")).toEqual({ hit: true, value: 1 });
    const other = await connectBackplane({ app: "other", apiKey: bot.key });
    expect(await fault(other.tenant("acme").cache("b").get("k"))).toBe("FORBIDDEN 403");
    expect(await fault(other.tenant("acme").scheduler("q").list())).toBe("FORBIDDEN 403");
    // The daemon's own log and the bot users are for the root key and admin bots only.
    expect(await fault(connectBackplane({ app: "_backplane", apiKey: bot.key }).then((b) => b.logs().read()))).not.toBe("OK");
    expect(await fault(shop.bots.list())).toBe("FORBIDDEN 403");
    const tool = (app: string) =>
      agent.callTool({ name: "cache.get", arguments: { scope: scope(app), key: "k" } }) as Promise<{
        isError?: boolean;
        structuredContent?: { code?: string };
      }>;
    expect((await tool("shop")).isError).toBeFalsy();
    expect((await tool("other")).structuredContent?.code).toBe("FORBIDDEN");
    const auth = { Authorization: "ApiKey " + bot.key };
    const object = (app: string) => fetch(`${daemon.url}/vfs/object?app=${app}&tenant=acme&bucket=b&key=f`, { method: "PUT", headers: auth, body: "x" });
    expect((await object("shop")).status).toBe(200);
    expect((await object("other")).status).toBe(403);
    expect((await fetch(daemon.url + "/files/shop/acme/b/f", { headers: auth })).status).toBe(200);
    expect((await fetch(daemon.url + "/files/other/acme/b/f", { headers: auth })).status).toBe(403);
    // The metrics show the bot's app and the lines that name no app, never another app.
    await other.tenant("acme").cache("b").get("k").catch(() => {});
    await connectBackplane({ app: "elsewhere" }).then((b) => b.tenant("acme").cache("b").get("k"));
    const metrics = await (await fetch(daemon.url + "/metrics", { headers: auth })).text();
    expect(metrics).toContain('app="shop"');
    expect(metrics).not.toContain('app="elsewhere"');
    expect(metrics).toContain("backplane_");
  } finally {
    await agent.close();
    await stop();
  }
}, 60000);

test("bots are created by admins only, rotated and revoked, and a revoked or replaced key fails on its next call", async () => {
  const { stop } = await start({ BACKPLANE_AUTH_MASTER_KEY: randomBytes(32).toString("base64url") });
  const root = await connectBackplane({ app: "shop" });
  try {
    const admin = await root.bots.create({ name: "operator", admin: true });
    const asAdmin = await connectBackplane({ app: "anything", apiKey: admin.key });
    const shopBot = await asAdmin.bots.create({ name: "shop", apps: ["shop"] });
    expect(await fault(asAdmin.tenant("t").cache("b").get("k"))).toBe("OK");
    expect((await root.bots.list()).map((b) => b.name).sort()).toEqual(["operator", "shop"]);
    const asShop = await connectBackplane({ app: "shop", apiKey: shopBot.key });
    expect(await fault(asShop.bots.create({ name: "sneaky", apps: ["other"] }))).toBe("FORBIDDEN 403");
    expect(await fault(root.bots.create({ name: "reserved", apps: ["_backplane"] }))).toBe("INVALID_ARGUMENT 400");
    expect(await fault(root.bots.create({ name: "nothing" }))).toBe("INVALID_ARGUMENT 400");
    const rotated = await root.bots.rotate(shopBot.id);
    expect(rotated.key).not.toBe(shopBot.key);
    expect(await fault(asShop.tenant("t").cache("b").get("k"))).toBe("UNAUTHORIZED 401");
    const fresh = await connectBackplane({ app: "shop", apiKey: rotated.key });
    expect(await fault(fresh.tenant("t").cache("b").get("k"))).toBe("OK");
    await root.bots.revoke(shopBot.id);
    expect(await fault(fresh.tenant("t").cache("b").get("k"))).toBe("UNAUTHORIZED 401");
    expect(await fault(root.bots.revoke(shopBot.id))).toBe("NOT_FOUND 404");
  } finally {
    await stop();
  }
}, 60000);

test("an app checks its callback token with its own bot key, and another app's bot cannot", async () => {
  const { stop } = await start({ BACKPLANE_AUTH_MASTER_KEY: randomBytes(32).toString("base64url") });
  const root = await connectBackplane({ app: "shop" });
  const shopBot = await root.bots.create({ name: "shop", apps: ["shop"] });
  const otherBot = await root.bots.create({ name: "other", apps: ["other"] });
  const asShop = await connectBackplane({ app: "shop", apiKey: shopBot.key });
  const asOther = await connectBackplane({ app: "other", apiKey: otherBot.key });
  const checks: string[] = [];
  let last: Headers | undefined;
  const rpc = createRpcServer({
    Jobs: {
      async run() {
        const token = last!.get("x-backplane-callback") ?? "";
        checks.push(await fault(asOther.callbacks.verify(token)), await fault(asShop.callbacks.verify(token)));
        return null;
      },
    },
  });
  const app = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      last = request.headers;
      return rpc.fetch(request);
    },
  });
  try {
    const queue = asShop.tenant("acme").scheduler("jobs");
    const created = await queue.create({
      id: "tick",
      cron: "* * * * * *",
      handler: "_rpc",
      payload: { url: `http://127.0.0.1:${app.port}/rpc`, className: "Jobs", methodName: "run", args: [] },
    });
    const end = Date.now() + 8000;
    while (checks.length === 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    await queue.pause("tick", { revision: created.revision, requestId: "pause" });
    expect(checks.slice(0, 2)).toEqual(["NOT_FOUND 404", "OK"]);
  } finally {
    app.stop(true);
    await stop();
  }
}, 20000);
