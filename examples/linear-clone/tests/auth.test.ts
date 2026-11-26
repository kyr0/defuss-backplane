import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { connectBackplane } from "defuss-backplane/client";
import { createRpcContext } from "defuss-rpc/client";
import type { Seed } from "../src/core/seed.ts";
import type { Api } from "../src/server/api.ts";
import { loadConfig } from "../src/server/config.ts";
import { type Server, startServer } from "../src/server/server.ts";
import { PASSWORD, signIn } from "./helpers/auth.ts";
import { type Daemon, freePort, startDaemon } from "./helpers/daemon.ts";

const seed: Seed = await Bun.file(new URL("../input/seed.json", import.meta.url)).json();
let daemon: Daemon;
let publicDir: string;
const servers: Server[] = [];

async function start(workspace: string) {
  const config = loadConfig({
    PORT: String(await freePort()),
    BACKPLANE_PORT: String(daemon.port),
    BACKPLANE_API_KEY: daemon.apiKey,
    WORKSPACE: workspace,
  });
  const server = await startServer(config, { publicDir, seed, now: () => new Date("2026-10-03T12:00:00Z") });
  servers.push(server);
  return server;
}
const client = (server: Server, headers: Record<string, string> = {}) =>
  createRpcContext({ baseUrl: server.url, headers }).getRpcClient<Api>();
const status = (call: Promise<unknown>) => call.then(() => 200, (e: { status: number }) => e.status);

beforeAll(async () => {
  daemon = await startDaemon();
  publicDir = await mkdtemp(join(tmpdir(), "linear-clone-public-"));
  await writeFile(join(publicDir, "index.html"), "<!doctype html><title>Vector</title>");
});
afterAll(async () => {
  for (const server of servers) await server.close().catch(() => {});
  await daemon?.stop();
  await rm(publicDir, { recursive: true, force: true });
});

test("every call needs a sign-in, and a signed-in person is the author of what they write", async () => {
  const server = await start("vector");
  expect(await (await fetch(server.url + "/session.json")).json()).toEqual({ workspace: "vector", authMode: "cookie" });
  expect(await status((await client(server)).Issues.list())).toBe(401);
  // The app's bot key is a backplane credential, not a person's.
  expect(await status((await client(server, { Authorization: "ApiKey " + daemon.apiKey })).Issues.list())).toBe(401);
  const mcp = await fetch(server.url + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  expect(mcp.status).toBe(401);
  const { authorization, cookie } = await signIn(server, { email: "nina@example.com", person: "nina", name: "Nina Park" });
  const nina = await client(server, { Authorization: authorization });
  expect((await nina.Workspace.bootstrap()).viewer).toBe("nina");
  const [issue] = await nina.Issues.list();
  const comment = await nina.Issues.comment(issue!.id, "Seen.");
  expect(comment.author).toBe("nina");
  // The refresh cookie renews the session through the app's own /auth.
  const refreshed = await fetch(server.url + "/auth/refresh", {
    method: "POST",
    headers: { origin: server.url, "x-defuss-csrf": "1", cookie, "content-type": "application/json" },
    body: "{}",
  });
  expect(refreshed.status).toBe(200);
});

test("an account without a person, a token of another workspace and a removed member are refused", async () => {
  // One app has one public origin, and each start registers its own, so each server signs in right after its start.
  const vector = await start("vector");
  const backplane = await connectBackplane({ app: "linear-clone", port: daemon.port, apiKey: daemon.apiKey });
  // An account of the tenant that no person links to.
  await backplane.tenant("vector").auth.addMember({ email: "ghost@example.com", password: PASSWORD });
  const login = await fetch(vector.url + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: vector.url, "x-defuss-csrf": "1" },
    body: JSON.stringify({ email: "ghost@example.com", password: PASSWORD, tenantId: "vector" }),
  });
  const ghost = "Bearer " + ((await login.json()) as { accessToken: string }).accessToken;
  expect(await status((await client(vector, { Authorization: ghost })).Issues.list())).toBe(403);
  const other = await start("other");
  const { authorization } = await signIn(other, { email: "olaf@example.com", person: "olaf", workspace: "other" });
  expect(await status((await client(other, { Authorization: authorization })).Issues.list())).toBe(200);
  expect(await status((await client(vector, { Authorization: authorization })).Issues.list())).toBe(401);
  const { subjectId } = (await backplane.tenant("other").auth.authenticate(authorization)) as { subjectId: string };
  await backplane.tenant("other").auth.removeMember(subjectId);
  expect(await status((await client(other, { Authorization: authorization })).Issues.list())).toBe(401);
});

test("an agent's API key works over MCP as the agent's own person, until it is revoked", async () => {
  const server = await start("vector");
  const agentKey = await server.ws.members.addAgent({ name: "Triage Bot" });
  expect(agentKey.person).toBe("agent-triage-bot");
  const agent = new Client({ name: "triage", version: "1" });
  await agent.connect(
    new StreamableHTTPClientTransport(new URL(server.url + "/mcp"), { requestInit: { headers: { Authorization: "ApiKey " + agentKey.key } } }),
  );
  try {
    const boot = await agent.callTool({ name: "Workspace.bootstrap", arguments: { args: [] } });
    expect((boot.structuredContent as { value: { viewer: string } }).value.viewer).toBe("agent-triage-bot");
    const backplane = await connectBackplane({ app: "linear-clone", port: daemon.port, apiKey: daemon.apiKey });
    await backplane.tenant("vector").auth.revokeApiKey(agentKey.id);
    expect(await status((await client(server, { Authorization: "ApiKey " + agentKey.key })).Issues.list())).toBe(401);
  } finally {
    await agent.close();
  }
});
