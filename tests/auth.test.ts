import { test, expect } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "defuss-serve";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { BackplaneError, connectBackplane } from "../src/client.js";
import { freePort, start } from "./daemon.js";

const fault = (promise: Promise<unknown>) =>
  promise.then(
    () => "OK",
    (e: unknown) => (e instanceof BackplaneError ? e.code + " " + e.status : String(e)),
  );
const masterKey = () => randomBytes(32).toString("base64url");
const password = "correct horse battery staple";

/** An app's listener with the client's auth proxy, connected with `key`, as linear-clone mounts it. */
async function appProxy(app: string, key: string) {
  const port = await freePort();
  const server = createServer({
    host: "127.0.0.1",
    port,
    plugins: [(await connectBackplane({ app, apiKey: key })).auth.proxy()],
  });
  await server.start();
  const origin = "http://127.0.0.1:" + port;
  /** A cookie-mode write, as a page sends it: its Origin and the CSRF field. */
  const post = (path: string, body: unknown) =>
    fetch(origin + "/auth" + path, {
      method: "POST",
      headers: { "content-type": "application/json", origin, "x-defuss-csrf": "1" },
      body: JSON.stringify(body),
    });
  return { origin, post, stop: () => server.stop() };
}

test("an app's proxy logs a member in, and authenticate names them live, in their tenant only", async () => {
  const { stop } = await start({ BACKPLANE_AUTH_MASTER_KEY: masterKey() });
  const backplane = await connectBackplane({ app: "shop" });
  const proxy = await appProxy("shop", process.env.API_KEY!);
  try {
    expect(await backplane.auth.configure({ origin: proxy.origin })).toMatchObject({ app: "shop", mode: "cookie", changed: true });
    expect((await backplane.auth.configure({ origin: proxy.origin })).changed).toBe(false);
    // A new origin, as after a move to another port or domain, reopens the same authority.
    expect((await backplane.auth.configure({ origin: "https://shop.example" })).changed).toBe(true);
    expect((await backplane.auth.configure({ origin: proxy.origin })).changed).toBe(true);
    const acme = backplane.tenant("acme").auth;
    const ada = await acme.addMember({ email: "ada@example.com", password, claims: ["member"] });
    expect(ada).toMatchObject({ email: "ada@example.com", claims: ["member"], created: true });
    const login = await proxy.post("/login", { email: "ada@example.com", password, tenantId: "acme" });
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toContain("Path=/auth");
    const { accessToken } = (await login.json()) as { accessToken: string };
    const bearer = "Bearer " + accessToken;
    expect(await acme.authenticate(bearer)).toMatchObject({ app: "shop", subjectId: ada.subjectId, tenantId: "acme", claims: ["member"], method: "jwt" });
    expect(await fault(backplane.tenant("other").auth.authenticate(bearer))).not.toBe("OK");
    // An agent's key in the same tenant, checked by the same call, and dead on the next call after revocation.
    const agent = await acme.createApiKey({ name: "agent", claims: ["member"] });
    expect(agent.key.startsWith("dfa_")).toBe(true);
    expect(await acme.authenticate("ApiKey " + agent.key)).toMatchObject({ subjectId: agent.subjectId, subjectKind: "service", method: "apiKey" });
    expect((await acme.listApiKeys()).map((k) => k.id)).toContain(agent.id);
    await acme.revokeApiKey(agent.id);
    expect(await fault(acme.authenticate("ApiKey " + agent.key))).toBe("UNAUTHORIZED 401");
    expect(await fault(backplane.tenant("other").auth.revokeApiKey(agent.id))).toBe("NOT_FOUND 404");
    // A removed member's token fails on its next call, before it expires.
    await acme.removeMember(ada.subjectId);
    expect(await fault(acme.authenticate(bearer))).not.toBe("OK");
    expect(await fault(acme.setPassword(ada.subjectId, password + "!"))).toBe("NOT_FOUND 404");
  } finally {
    await proxy.stop();
    await stop();
  }
}, 60000);

test("the auth routes want a proxy key for their app, count failed logins per client, and /rpc still refuses Origin", async () => {
  const { daemon, headers, stop } = await start({ BACKPLANE_AUTH_MASTER_KEY: masterKey() });
  const backplane = await connectBackplane({ app: "shop" });
  const other = await backplane.bots.create({ name: "other app", apps: ["other"] });
  const proxy = await appProxy("shop", process.env.API_KEY!);
  const foreign = await appProxy("shop", other.key);
  try {
    await backplane.auth.configure({ origin: proxy.origin });
    await backplane.tenant("acme").auth.addMember({ email: "bob@example.com", password });
    const direct = await fetch(daemon.url + "/apps/shop/auth/login", { method: "POST", body: "{}" });
    expect(direct.status).toBe(403);
    expect((await foreign.post("/login", { email: "bob@example.com", password, tenantId: "acme" })).status).toBe(403);
    // The proxy sets X-Forwarded-For from its socket peer, which the daemon trusts from loopback. defuss-auth allows a
    // client 50 failed logins per window by default (rateAttempts 10, times 5) and an account 10, so failures for 51
    // distinct emails end in 429 only if the client's address reached it.
    const statuses: number[] = [];
    for (let i = 0; i < 51; i++)
      statuses.push((await proxy.post("/login", { email: `nobody${i}@example.com`, password: "wrong", tenantId: "acme" })).status);
    expect(new Set(statuses.slice(0, 50))).toEqual(new Set([401]));
    expect(statuses[50]).toBe(429);
    const withOrigin = await fetch(daemon.url + "/rpc", {
      method: "POST",
      headers: { ...headers, origin: proxy.origin, "content-type": "application/json" },
      body: "{}",
    });
    expect(withOrigin.status).toBe(403);
  } finally {
    await proxy.stop();
    await foreign.stop();
    await stop();
  }
}, 60000);

test("a restart reopens every registered app, so a proxied login works without configure", async () => {
  const root = await mkdtemp(join(tmpdir(), "backplane-auth-"));
  const env = { BACKPLANE_AUTH_MASTER_KEY: masterKey(), BACKPLANE_DATA_DIR: root };
  try {
    const first = await start(env);
    let origin: string;
    try {
      const backplane = await connectBackplane({ app: "shop" });
      origin = "http://127.0.0.1:" + (await freePort());
      await backplane.auth.configure({ origin, mode: "token" });
      await backplane.tenant("acme").auth.addMember({ email: "eve@example.com", password });
    } finally {
      await first.stop();
    }
    const second = await start(env);
    const proxy = await appProxy("shop", process.env.API_KEY!);
    try {
      // Token mode takes the registered origin too, so the page's Origin must be that one; this proxy runs elsewhere.
      const login = await fetch(proxy.origin + "/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ email: "eve@example.com", password, tenantId: "acme" }),
      });
      expect(login.status).toBe(200);
      expect(typeof ((await login.json()) as { refreshToken?: unknown }).refreshToken).toBe("string");
    } finally {
      await proxy.stop();
      await second.stop();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

test("without a master key auth is off, a malformed key stops startup, and names outside the rules are refused", async () => {
  const off = await start();
  try {
    const backplane = await connectBackplane({ app: "shop" });
    expect(await fault(backplane.auth.configure({ origin: "http://127.0.0.1:1" }))).toBe("UNAVAILABLE 503");
    expect(await fault(backplane.bots.list())).toBe("UNAVAILABLE 503");
    expect(await fault(backplane.tenant("acme").auth.members())).toBe("UNAVAILABLE 503");
    // status answers while auth is off, so an agent sees why every other auth call fails.
    expect(await backplane.auth.status()).toEqual({ app: "shop", enabled: false, configured: false });
    expect((await fetch(off.daemon.url + "/apps/shop/auth/me")).status).toBe(404);
  } finally {
    await off.stop();
  }
  expect(await fault(start({ BACKPLANE_AUTH_MASTER_KEY: "too-short" }))).toContain("BACKPLANE_AUTH_MASTER_KEY must be base64url of 32 bytes");
  const on = await start({ BACKPLANE_AUTH_MASTER_KEY: masterKey() });
  try {
    const upper = await connectBackplane({ app: "Shop" });
    expect(await fault(upper.auth.configure({ origin: "http://127.0.0.1:1" }))).toBe("INVALID_ARGUMENT 400");
    const backplane = await connectBackplane({ app: "shop" });
    expect(await fault(backplane.auth.configure({ origin: "http://127.0.0.1:1/path" }))).toBe("INVALID_ARGUMENT 400");
    await backplane.auth.configure({ origin: "http://127.0.0.1:1" });
    expect(await fault(backplane.tenant("Acme GmbH").auth.authenticate("Bearer x"))).toBe("INVALID_ARGUMENT 400");
    expect(await fault(connectBackplane({ app: "unknown" }).then((b) => b.tenant("acme").auth.authenticate("Bearer x")))).toBe("NOT_FOUND 404");
  } finally {
    await on.stop();
  }
}, 60000);

test("agents inspect auth over MCP: status, members page by page and key metadata, with no secret, and a bot sees its app only", async () => {
  const { daemon, agent, stop } = await start({ BACKPLANE_AUTH_MASTER_KEY: randomBytes(32).toString("base64url") });
  const root = await connectBackplane({ app: "shop" });
  const tool = async (name: string, args: Record<string, unknown>) => {
    const r = (await agent.callTool({ name, arguments: args })) as { isError?: boolean; structuredContent: { value?: unknown; code?: string } };
    return r.isError ? r.structuredContent.code : r.structuredContent.value;
  };
  try {
    expect(await tool("auth.status", { scope: { app: "shop" } })).toEqual({ app: "shop", enabled: true, configured: false });
    await root.auth.configure({ origin: "http://127.0.0.1:1", mode: "token" });
    expect(await tool("auth.status", { scope: { app: "shop" } })).toEqual({
      app: "shop",
      enabled: true,
      configured: true,
      origin: "http://127.0.0.1:1",
      mode: "token",
      issuer: "urn:defuss-backplane:shop",
      audience: "shop",
    });
    const acme = root.tenant("acme").auth;
    for (const name of ["ada", "bob", "cy"]) await acme.addMember({ email: name + "@example.com", password, claims: ["member"] });
    await root.tenant("other").auth.addMember({ email: "eve@example.com", password });
    const scope = { app: "shop", tenant: "acme" };
    // Pages of two accounts: the other tenant's account is skipped, and the last page ends with next null.
    const emails: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < 3; page++) {
      const r = (await tool("auth.members", { scope, page: { limit: 2, ...(after ? { after } : {}) } })) as {
        items: { email: string; claims: string[] }[];
        next: string | null;
      };
      emails.push(...r.items.map((m) => m.email));
      expect(r.items.every((m) => m.claims.join() === "member")).toBe(true);
      if (!r.next) break;
      after = r.next;
    }
    expect(emails.sort()).toEqual(["ada@example.com", "bob@example.com", "cy@example.com"]);
    const listed = (await acme.members()).items;
    expect(Object.keys(listed[0]!).sort()).toEqual(["claims", "createdAt", "email", "status", "subjectId", "updatedAt"]);
    const key = await acme.createApiKey({ name: "triage" });
    const keys = (await tool("auth.listApiKeys", { scope })) as Record<string, unknown>[];
    expect(keys.map((k) => k.id)).toEqual([key.id]);
    expect(JSON.stringify(keys)).not.toContain(key.key);
    const bot = await root.bots.create({ name: "shop service", apps: ["shop"] });
    expect(((await tool("bots.list", {})) as { id: string }[]).map((b) => b.id)).toContain(bot.id);
    expect(JSON.stringify(await tool("bots.list", {}))).not.toContain(bot.key);
    // The app's bot inspects its own app and nothing else, and the bot list stays the root key's.
    const asBot = new Client({ name: "bot", version: "1" });
    await asBot.connect(
      new StreamableHTTPClientTransport(new URL(daemon.url + "/mcp"), { requestInit: { headers: { Authorization: "ApiKey " + bot.key } } }),
    );
    try {
      const call = async (name: string, args: Record<string, unknown>) =>
        ((await asBot.callTool({ name, arguments: args })) as { structuredContent: { code?: string } }).structuredContent.code;
      expect(await call("auth.members", { scope })).toBeUndefined();
      expect(await call("auth.members", { scope: { app: "elsewhere", tenant: "acme" } })).toBe("FORBIDDEN");
      expect(await call("auth.status", { scope: { app: "elsewhere" } })).toBe("FORBIDDEN");
      expect(await call("bots.list", {})).toBe("FORBIDDEN");
    } finally {
      await asBot.close();
    }
    expect(await fault(acme.members({ limit: 0 }))).toBe("INVALID_ARGUMENT 400");
  } finally {
    await stop();
  }
}, 60000);
