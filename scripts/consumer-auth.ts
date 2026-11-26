/** VERIFIED: make e2e runs it on each daemon phase. The packed package's auth and bot users, as an app uses them: a defuss-serve listener that proxies `/auth` to the
 * daemon, a member who logs in through it in cookie mode, and every `auth`, `bots` and `callbacks` method once. Prints
 * one JSON line. `node consumer-auth.ts <phase>`; the phase names the app, so each daemon phase starts clean. */
import assert from "node:assert/strict";
import { createServer as listenOn } from "node:net";
import { BackplaneError, connectBackplane } from "defuss-backplane/client";
import { createServer } from "defuss-serve";

const phase = process.argv[2] ?? "e2e";
const app = ("auth-" + phase).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "OK",
    (e: unknown) => (e instanceof BackplaneError ? e.code : String(e)),
  );
async function freePort() {
  const probe = listenOn().listen(0, "127.0.0.1");
  await new Promise((done) => probe.once("listening", done));
  const { port } = probe.address() as { port: number };
  await new Promise((done) => probe.close(done));
  return port;
}

const root = await connectBackplane({ app });
// The app's own bot, which its proxy and its calls use instead of the root key.
const bot = await root.bots.create({ name: app, apps: [app] });
const own = await connectBackplane({ app, apiKey: bot.key });
const port = await freePort();
const server = createServer({ host: "127.0.0.1", port, plugins: [own.auth.proxy()] });
await server.start();
const origin = "http://127.0.0.1:" + port;
const page = { origin, "x-defuss-csrf": "1", "content-type": "application/json" };
const steps: string[] = [];
try {
  assert.equal((await own.auth.configure({ origin })).changed, true);
  steps.push("configure");
  const tenant = own.tenant("acme").auth;
  const password = "correct horse battery staple";
  const member = await tenant.addMember({ email: "ada@example.com", password, claims: ["member"] });
  assert.equal(member.created, true);
  steps.push("addMember");
  const login = await fetch(origin + "/auth/login", {
    method: "POST",
    headers: page,
    body: JSON.stringify({ email: "ada@example.com", password, tenantId: "acme" }),
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  const { accessToken } = (await login.json()) as { accessToken: string };
  // The refresh cookie works through the proxy, as a reload in a browser would use it.
  const refreshed = await fetch(origin + "/auth/refresh", { method: "POST", headers: { ...page, cookie }, body: "{}" });
  assert.equal(refreshed.status, 200);
  steps.push("login", "refresh");
  const who = await tenant.authenticate("Bearer " + accessToken);
  assert.deepEqual([who.subjectId, who.tenantId, who.claims], [member.subjectId, "acme", ["member"]]);
  steps.push("authenticate");
  await tenant.setPassword(member.subjectId, password + " again");
  steps.push("setPassword");
  const key = await tenant.createApiKey({ name: "agent", claims: ["member"] });
  assert.equal((await tenant.authenticate("ApiKey " + key.key)).subjectKind, "service");
  assert.ok((await tenant.listApiKeys()).some((k) => k.id === key.id));
  await tenant.revokeApiKey(key.id);
  assert.equal(await code(tenant.authenticate("ApiKey " + key.key)), "UNAUTHORIZED");
  steps.push("createApiKey", "listApiKeys", "revokeApiKey");
  await tenant.removeMember(member.subjectId);
  assert.notEqual(await code(tenant.authenticate("Bearer " + accessToken)), "OK");
  steps.push("removeMember");
  // The bot reaches its app only; the root key manages bots.
  assert.equal(await code(own.tenant("acme").cache("c").set("k", 1)), "OK");
  const other = await connectBackplane({ app: app + "-other", apiKey: bot.key });
  assert.equal(await code(other.tenant("acme").cache("c").get("k")), "FORBIDDEN");
  assert.ok((await root.bots.list()).some((b) => b.id === bot.id));
  const rotated = await root.bots.rotate(bot.id);
  assert.equal(await code(own.tenant("acme").cache("c").get("k")), "UNAUTHORIZED");
  await root.bots.revoke(rotated.id);
  steps.push("bots.create", "bots.list", "bots.rotate", "bots.revoke");
  assert.equal(await code(root.callbacks.verify("no-such-token")), "NOT_FOUND");
  steps.push("callbacks.verify");
} finally {
  await server.stop();
}
console.log(JSON.stringify({ auth: "passed", app, steps }));
