import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { listen } from "../src/server.js";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const names = [
  "PORT",
  "API_KEY",
  "BACKPLANE_DATA_DIR",
  "BACKPLANE_CALLBACK_ORIGINS",
  "BACKPLANE_OTLP",
  "BACKPLANE_AUTH_MASTER_KEY",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
];

export async function freePort() {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("Missing socket");
  await new Promise<void>((done) => probe.close(() => done()));
  return address.port;
}

/** Starts a daemon on a free port with a fresh data root and key, and restores the environment when it stops.
 * `env` sets further daemon variables such as BACKPLANE_CALLBACK_ORIGINS. */
export async function start(env: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "backplane-http-"));
  const old = names.map((k) => process.env[k]);
  const apiKey = randomBytes(24).toString("hex");
  function restore() {
    for (const [i, k] of names.entries()) {
      if (old[i] === undefined) delete process.env[k];
      else process.env[k] = old[i];
    }
  }
  // Settings from the developer's shell must not switch push on or allow callback origins.
  delete process.env.BACKPLANE_OTLP;
  delete process.env.BACKPLANE_CALLBACK_ORIGINS;
  // Auth stays off unless a test passes a master key.
  delete process.env.BACKPLANE_AUTH_MASTER_KEY;
  Object.assign(process.env, {
    PORT: String(await freePort()),
    API_KEY: apiKey,
    BACKPLANE_DATA_DIR: root,
    ...env,
  });
  let daemon;
  try {
    daemon = await listen();
  } catch (error) {
    restore();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  const headers = { Authorization: "Bearer " + apiKey };
  const agent = new Client({ name: "integration", version: "1" });
  await agent.connect(
    new StreamableHTTPClientTransport(new URL(daemon.url + "/mcp"), {
      requestInit: { headers },
    }),
  );
  return {
    daemon,
    headers,
    agent,
    root,
    async stop() {
      await agent.close();
      await daemon.close();
      restore();
      await rm(root, { recursive: true, force: true });
    },
  };
}
