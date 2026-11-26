import { test, expect } from "bun:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectBackplane } from "../src/client.js";
import { start } from "./daemon.js";

const scope = { app: "shop", tenant: "Müller & Co", bucket: "carts" };
/** The value of the one Prometheus sample of `name` whose labels include every pair in `labels`. */
function sample(text: string, name: string, labels: Record<string, string | number>) {
  const wanted = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
  const lines = text
    .split("\n")
    .filter((line) => line.startsWith(name + "{") && wanted.every((pair) => line.includes(pair)));
  expect(lines).toHaveLength(1);
  return Number(lines[0].slice(lines[0].lastIndexOf(" ") + 1));
}

test("probes answer without the key, and /metrics reports each module's calls by app and code", async () => {
  const { daemon, headers, agent, stop } = await start({ BACKPLANE_SCHEDULER: "1" });
  try {
    const ready = await fetch(daemon.url + "/readyz");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({
      service: "defuss-backplane",
      status: "pass",
      checks: [{ name: "storage", status: "pass" }],
    });
    for (const path of ["/health", "/healthz", "/livez"])
      expect((await fetch(daemon.url + path)).status).toBe(200);
    expect((await fetch(daemon.url + "/readyz", { headers: { Origin: "http://example.org" } })).status).toBe(403);
    expect((await fetch(daemon.url + "/readyz", { headers: { Host: "untrusted.example" } })).status).toBe(403);
    expect((await fetch(daemon.url + "/metrics")).status).toBe(401);

    const tenant = (await connectBackplane({ app: scope.app })).tenant(scope.tenant);
    const cache = tenant.cache(scope.bucket);
    await cache.set("cart", { items: 2 });
    await cache.get("cart");
    await expect(cache.set("cart", 3, { ifRevision: "stale" })).rejects.toThrow();
    await tenant.scheduler("jobs").list();
    // MCP tools call the same services, so their calls count with the RPC ones.
    await agent.callTool({ name: "cache.get", arguments: { scope, key: "cart" } });

    const response = await fetch(daemon.url + "/metrics", { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; version=0.0.4; charset=utf-8");
    const text = await response.text();
    // VERIFIED by the deep suite: the README lists this counter, but it was missing until the first fault.
    expect(sample(text, "backplane_scheduler_errors_total", {})).toBe(0);
    const calls = "backplane_operation_duration_count";
    expect(sample(text, calls, { module: "cache", method: "set", app: "shop", code: "OK" })).toBe(1);
    expect(sample(text, calls, { module: "cache", method: "get", app: "shop", code: "OK" })).toBe(2);
    expect(sample(text, calls, { module: "cache", method: "set", app: "shop", code: "REVISION_CONFLICT" })).toBe(1);
    expect(sample(text, calls, { module: "scheduler", method: "list", app: "shop", code: "OK" })).toBe(1);
    const requests = "http_server_request_duration_count";
    expect(sample(text, requests, { endpoint: "metrics", http_response_status_code: 401 })).toBe(1);
    // The plugin rejects the Origin; defuss-serve itself rejects the foreign Host and reports it as `http`.
    expect(sample(text, requests, { endpoint: "probes", http_response_status_code: 403 })).toBe(1);
    expect(sample(text, requests, { endpoint: "http", http_response_status_code: 403 })).toBe(1);
    expect(sample(text, requests, { endpoint: "rpc", http_request_method: "POST", http_response_status_code: 409 })).toBe(1);
    expect(sample(text, "backplane_store_handles", { module: "cache", state: "idle" })).toBe(1);
    expect(sample(text, "backplane_store_handles", { module: "cache", state: "busy" })).toBe(0);
    expect(sample(text, "backplane_storage_free", {})).toBeGreaterThan(0);
    expect(sample(text, "backplane_http_active", { kind: "requests" })).toBeGreaterThanOrEqual(1);
    expect(sample(text, "defuss_o11y_ready", {})).toBe(1);
    // Tenant and bucket names stay out of the metrics.
    expect(text).not.toContain(scope.tenant);
    expect(text).not.toContain(scope.bucket);
  } finally {
    await stop();
  }
});

// A root user passes every write-access check, so the test needs an ordinary account.
test.skipIf(process.getuid?.() === 0)("a data root that loses write access fails readiness, not liveness", async () => {
  const { daemon, headers, root, stop } = await start();
  try {
    await chmod(root, 0o500);
    const ready = await fetch(daemon.url + "/readyz");
    expect(ready.status).toBe(503);
    expect((await ready.json()).checks).toEqual([{ name: "storage", status: "fail", reason: "error" }]);
    expect((await fetch(daemon.url + "/livez")).status).toBe(200);
    const text = await (await fetch(daemon.url + "/metrics", { headers })).text();
    expect(sample(text, "defuss_o11y_ready", {})).toBe(0);
  } finally {
    await chmod(root, 0o700);
    await stop();
  }
});

test("a data root that cannot be created stops startup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "backplane-o11y-"));
  try {
    await writeFile(join(dir, "file"), "");
    await expect(start({ BACKPLANE_DATA_DIR: join(dir, "file", "data") })).rejects.toThrow("ENOTDIR");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("with BACKPLANE_OTLP=1 the daemon pushes its metrics to the OTLP endpoint when it stops", async () => {
  const batches: { resourceMetrics: { resource: unknown; scopeMetrics: { metrics: { name: string; histogram?: { dataPoints: { attributes: { key: string; value: { stringValue?: string } }[] }[] } }[] }[] }[] }[] = [];
  const receiver = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method === "POST" && request.url === "/v1/metrics")
        batches.push(JSON.parse(Buffer.concat(chunks).toString()));
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  receiver.listen(0, "127.0.0.1");
  await once(receiver, "listening");
  const address = receiver.address() as { port: number };
  try {
    const { stop } = await start({
      BACKPLANE_OTLP: "1",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `http://127.0.0.1:${address.port}/v1/metrics`,
    });
    try {
      await (await connectBackplane({ app: scope.app })).tenant(scope.tenant).cache(scope.bucket).set("cart", 1);
    } finally {
      await stop();
    }
    expect(batches.length).toBeGreaterThanOrEqual(1);
    const last = batches.at(-1)!.resourceMetrics[0];
    expect(JSON.stringify(last.resource)).toContain('"defuss-backplane"');
    const operation = last.scopeMetrics
      .flatMap((s) => s.metrics)
      .find((m) => m.name === "backplane.operation.duration");
    const points = operation!.histogram!.dataPoints.map((p) =>
      Object.fromEntries(p.attributes.map((a) => [a.key, a.value.stringValue])),
    );
    expect(points).toContainEqual({ module: "cache", method: "set", app: "shop", code: "OK" });
  } finally {
    receiver.close();
  }
});

test("an invalid BACKPLANE_OTLP value stops startup", async () => {
  await expect(start({ BACKPLANE_OTLP: "yes" })).rejects.toThrow("BACKPLANE_OTLP must be 0 or 1");
});
