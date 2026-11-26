/** VERIFIED: scripts/deep/run.ts runs it once per suite, over RPC, because MCP only reads auth and bot users. A bot
 * for the suite's app proxies a member's login through a defuss-serve listener in token mode, every `auth` and `bots`
 * method runs, the four inspection tools read the same state over MCP, and the scenario revokes what it made. Against
 * a daemon without BACKPLANE_AUTH_MASTER_KEY, such as a live one started without it, `auth.status` must say so and
 * every other method answer UNAVAILABLE instead. */
import { createServer as probe } from "node:net";
import { BackplaneError, connectBackplane } from "defuss-backplane/client";
import { createServer } from "defuss-serve";
import { Fault, recorded } from "./drivers.ts";
import { assert, type Ctx, rejects } from "./kit.ts";

type Client = Awaited<ReturnType<typeof connectBackplane>>;

async function freePort() {
  const socket = probe().listen(0, "127.0.0.1");
  await new Promise((done) => socket.once("listening", done));
  const { port } = socket.address() as { port: number };
  await new Promise((done) => socket.close(done));
  return port;
}
/** Fails unless the call is refused as unauthenticated or forbidden: defuss-auth decides which of the two. */
async function refused(call: Promise<unknown>) {
  const status = await call.then(
    () => 200,
    (e: unknown) => (e instanceof Fault || e instanceof BackplaneError ? e.status : 0),
  );
  assert.ok(status === 401 || status === 403, "refused with 401 or 403, got " + status);
}
/** The fault code of a call through a client the drivers do not wrap. */
const code = (call: Promise<unknown>) => call.then(() => "OK", (e: unknown) => (e instanceof BackplaneError ? e.code : String(e)));

type Tool = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export async function authScenario(
  { app, tenant, bucket, callbacks, step }: Ctx,
  env: { client: Client; base: string; run: string; tool: Tool },
) {
  const appAuth = recorded("auth", env.client.auth);
  const auth = recorded("auth", env.client.tenant(tenant).auth);
  const bots = recorded("bots", env.client.bots);
  const off = await code(env.client.bots.list());
  if (off === "UNAVAILABLE") {
    await step("without a master key every auth and bots method answers UNAVAILABLE", async () => {
      const calls = [
        () => appAuth.configure({ origin: "http://127.0.0.1:1" }),
        () => auth.authenticate("Bearer none"),
        () => auth.addMember({ email: "none@example.com" }),
        () => auth.removeMember("none"),
        () => auth.setPassword("none", "none"),
        () => auth.createApiKey({ name: "none" }),
        () => auth.listApiKeys(),
        () => auth.members(),
        () => auth.revokeApiKey("none"),
        () => bots.create({ name: "none", apps: [app] }),
        () => bots.list(),
        () => bots.rotate("none"),
        () => bots.revoke("none"),
      ];
      for (const call of calls) await rejects(call(), "UNAVAILABLE", 503);
    });
    await step("without a master key auth.status says so over RPC and MCP, and the other inspection tools answer UNAVAILABLE", async () => {
      const off = { app, enabled: false, configured: false };
      assert.deepEqual(await appAuth.status(), off);
      assert.deepEqual(await env.tool("auth.status", { scope: { app } }), off);
      await rejects(env.tool("auth.members", { scope: { app, tenant }, page: { limit: 1, after: "none" } }), "UNAVAILABLE", 503);
      await rejects(env.tool("auth.listApiKeys", { scope: { app, tenant } }), "UNAVAILABLE", 503);
      await rejects(env.tool("bots.list", {}), "UNAVAILABLE", 503);
    });
    return;
  }
  const email = `deep-${env.run}@example.com`;
  const password = "deep suite password " + env.run;
  let bot: { id: string; key: string } | undefined;
  let server: ReturnType<typeof createServer> | undefined;
  let origin = "";
  let member: { subjectId: string } | undefined;
  let token = "";
  const login = (secret: string) =>
    fetch(origin + "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password: secret, tenantId: tenant }),
    });
  try {
    await step("a bot for the app proxies its logins, and the app registers its auth in token mode", async () => {
      bot = await bots.create({ name: "deep " + env.run, apps: [app] });
      const port = await freePort();
      server = createServer({ host: "127.0.0.1", port, plugins: [(await connectBackplane({ app, apiKey: bot.key })).auth.proxy()] });
      await server.start();
      origin = "http://127.0.0.1:" + port;
      assert.deepEqual(await appAuth.configure({ origin, mode: "token" }), { app, origin, mode: "token", changed: true });
    });
    await step("a member logs in through the proxy, and authenticate names them in this tenant only", async () => {
      member = await auth.addMember({ email, password, claims: ["member"] });
      const answer = await login(password);
      assert.equal(answer.status, 200);
      token = ((await answer.json()) as { accessToken: string }).accessToken;
      const who = await auth.authenticate("Bearer " + token);
      assert.deepEqual([who.subjectId, who.tenantId, who.claims, who.method], [member.subjectId, tenant, ["member"], "jwt"]);
      await refused(recorded("auth", env.client.tenant(tenant + "_other").auth).authenticate("Bearer " + token));
    });
    await step("agents read the registration and the members over MCP as over RPC, a page at a time", async () => {
      const status = await appAuth.status();
      assert.deepEqual([status.enabled, status.configured, status.origin, status.mode], [true, true, origin, "token"]);
      assert.deepEqual(await env.tool("auth.status", { scope: { app } }), status);
      const listed = (await auth.members({ limit: 500 })).items as { subjectId: string; claims: string[] }[];
      assert.deepEqual(listed.find((m) => m.subjectId === member!.subjectId)?.claims, ["member"]);
      const scope = { app, tenant };
      const first = (await env.tool("auth.members", { scope, page: { limit: 1 } })) as { items: unknown[]; next: string | null };
      assert.ok(first.items.length <= 1, "a page holds at most limit members");
      assert.equal(typeof first.next, "string", "the app has an account, so a page of one names the next page");
      const rest = (await env.tool("auth.members", { scope, page: { limit: 500, after: first.next } })) as { items: { subjectId: string }[] };
      const seen = [...(first.items as { subjectId: string }[]), ...rest.items].map((m) => m.subjectId);
      assert.ok(seen.includes(member!.subjectId), "the member is on one of the pages");
    });
    await step("setPassword replaces the member's password", async () => {
      await auth.setPassword(member!.subjectId, password + " changed");
      assert.equal((await login(password)).status, 401);
      assert.equal((await login(password + " changed")).status, 200);
    });
    await step("an agent's API key authenticates until it is revoked", async () => {
      const key = await auth.createApiKey({ name: "deep agent", claims: ["member"] });
      assert.equal((await auth.authenticate("ApiKey " + key.key)).subjectKind, "service");
      assert.ok((await auth.listApiKeys()).some((k: { id: string }) => k.id === key.id));
      const viaMcp = (await env.tool("auth.listApiKeys", { scope: { app, tenant } })) as { id: string }[];
      assert.ok(viaMcp.some((k) => k.id === key.id));
      assert.ok(!JSON.stringify(viaMcp).includes(key.key), "no key secret over MCP");
      await auth.revokeApiKey(key.id);
      await rejects(auth.authenticate("ApiKey " + key.key), "UNAUTHORIZED", 401);
    });
    await step("a removed member's token fails on its next call", async () => {
      await auth.removeMember(member!.subjectId);
      await refused(auth.authenticate("Bearer " + token));
    });
    await step("a bot reaches its app only, and a rotated key replaces the old one at once", async () => {
      const asBot = await connectBackplane({ app, apiKey: bot!.key });
      assert.equal(await code(asBot.tenant(tenant).cache(bucket).set("k", 1)), "OK");
      const elsewhere = await connectBackplane({ app: app + "-other", apiKey: bot!.key });
      assert.equal(await code(elsewhere.tenant(tenant).cache(bucket).get("k")), "FORBIDDEN");
      assert.ok((await bots.list()).some((b: { id: string }) => b.id === bot!.id));
      const viaMcp = (await env.tool("bots.list", {})) as { id: string }[];
      assert.ok(viaMcp.some((b) => b.id === bot!.id) && !JSON.stringify(viaMcp).includes(bot!.key));
      const rotated = await bots.rotate(bot!.id);
      assert.equal(await code(asBot.tenant(tenant).cache(bucket).get("k")), "UNAUTHORIZED");
      bot = { id: rotated.id, key: rotated.key };
    });
    await step("callbacks.verify refuses a token of no call in flight", async () => {
      await rejects(callbacks.verify("no-such-token"), "NOT_FOUND", 404);
    });
    await step("revoking the bot ends its key", async () => {
      const id = bot!.id;
      await bots.revoke(id);
      bot = undefined;
      await rejects(bots.revoke(id), "NOT_FOUND", 404);
    });
  } finally {
    await server?.stop();
    if (bot) await env.client.bots.revoke(bot.id).catch(() => {});
  }
}
