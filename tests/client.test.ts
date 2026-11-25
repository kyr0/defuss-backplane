import { test, expect } from "bun:test";
import { addHook, clearHooks, setHeaders } from "defuss-rpc/client";
import { BackplaneError, connectBackplane } from "../src/client.js";
import { start } from "./daemon.js";

const scope = { app: "shop", tenant: "acme", bucket: "catalog" };
const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "OK",
    (e: unknown) => (e instanceof BackplaneError ? e.code + " " + e.status : String(e)),
  );

test("the application's defuss-rpc hooks and headers do not reach backplane calls", async () => {
  const { stop } = await start();
  try {
    // The application blocks every call of its own process-wide client and sends a wrong credential with it.
    addHook({ phase: "guard", fn: () => false });
    setHeaders({ Authorization: "Bearer application" });
    const cache = (await connectBackplane({ app: scope.app })).tenant(scope.tenant).cache(scope.bucket);
    await cache.set("k", "v");
    expect(await cache.get("k")).toEqual({ hit: true, value: "v" });
  } finally {
    clearHooks();
    await stop();
  }
});

test("a wrong bot key fails the connection with UNAUTHORIZED", async () => {
  const { stop } = await start();
  try {
    expect(await code(connectBackplane({ app: scope.app, apiKey: "wrong-key" }))).toBe("UNAUTHORIZED 401");
  } finally {
    await stop();
  }
});

test("a call answered with a redirect fails, so its arguments never reach another address", async () => {
  // A listener that took the daemon's port: it answers the schema and redirects every call to a second listener.
  const seen: string[] = [];
  const elsewhere = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      seen.push(request.headers.get("authorization") ?? "-");
      return new Response("null");
    },
  });
  const impostor = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/rpc/schema")
        return Response.json([{ kind: "module", moduleName: "cache", methods: { get: {} } }]);
      return new Response(null, { status: 307, headers: { Location: `http://127.0.0.1:${elsewhere.port}/rpc` } });
    },
  });
  try {
    const client = await connectBackplane({ app: scope.app, port: impostor.port, apiKey: "bot-key" });
    expect(await code(client.tenant(scope.tenant).cache(scope.bucket).get("k"))).not.toBe("OK");
    expect(seen).toEqual([]);
  } finally {
    impostor.stop(true);
    elsewhere.stop(true);
  }
});

test("a connection sends one schema request and refuses a redirected one", async () => {
  const seen: string[] = [];
  const elsewhere = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      seen.push(new URL(request.url).pathname);
      return Response.json([{ kind: "module", moduleName: "cache", methods: { get: {} } }]);
    },
  });
  const moved = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(null, { status: 307, headers: { Location: `http://127.0.0.1:${elsewhere.port}/rpc/schema` } }),
  });
  try {
    await connectBackplane({ app: scope.app, port: elsewhere.port, apiKey: "bot-key" });
    expect(seen).toEqual(["/rpc/schema"]);
    expect(await code(connectBackplane({ app: scope.app, port: moved.port, apiKey: "bot-key" }))).not.toBe("OK");
    expect(seen).toEqual(["/rpc/schema"]);
  } finally {
    moved.stop(true);
    elsewhere.stop(true);
  }
});
