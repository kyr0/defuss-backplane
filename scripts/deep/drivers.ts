/** VERIFIED: scripts/deep/run.ts runs every scenario through both drivers. One interface per subsystem, two
 * implementations: the typed RPC client, and the MCP tools from the client config `make mcp-config` writes. Each
 * scenario is written once against `Ops` and asserts the documented behavior through both. The MCP driver reads
 * with `resultEncoding: "dson"`, decodes base64 and bigint tags, and turns tool faults into the same `Fault` the RPC
 * driver throws, so the assertions need no transport branch. Both record what they call, for the coverage guard. */
import { DSON } from "defuss-dson";
import type { Client } from "@modelcontextprotocol/client";
import { BackplaneError, connectBackplane } from "defuss-backplane/client";

export type Scope = { app: string; tenant: string; bucket: string };
type Any = Record<string, unknown>;
type WriteOptions = { ifRevision?: string | null };

/** A failed call on either transport. */
export class Fault extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(code + " " + status + ": " + message);
    this.code = code;
    this.status = status;
  }
}

/** What the suite called: RPC methods as `module.method`, MCP tools with the argument paths they used. */
export const used = { rpc: new Set<string>(), mcp: new Map<string, Set<string>>() };

/** Argument paths in the form the coverage guard compares with tool schemas: `range.offset`, `entries[].level`. */
export function paths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => paths(item, prefix + "[]"));
  if (value === null || typeof value !== "object" || value instanceof Uint8Array) return [];
  return Object.entries(value).flatMap(([k, v]) => {
    const path = prefix ? (prefix.endsWith("[]") ? prefix + "." + k : prefix + "." + k) : k;
    return [path, ...paths(v, path)];
  });
}

export interface Ops {
  via: "rpc" | "mcp";
  cache(bucket: string): {
    get(key: string): Promise<unknown>;
    getVersioned(key: string): Promise<Any>;
    set(key: string, value: unknown, options?: { ttlMs?: number; ifRevision?: string | null }): Promise<boolean>;
    delete(key: string, options?: WriteOptions): Promise<boolean>;
  };
  db(bucket: string): {
    insert(document: Any, options?: { ifRevision?: null }): Promise<unknown>;
    get(id: unknown): Promise<Any | null>;
    getVersioned(id: unknown): Promise<Any>;
    update(id: unknown, patch: Any, options?: WriteOptions): Promise<boolean>;
    delete(id: unknown, options?: WriteOptions): Promise<boolean>;
    query(request?: Any): Promise<{ rows: Any[] }>;
  };
  vfs(bucket: string): {
    put(key: string, data: string | Uint8Array, options?: WriteOptions): Promise<Any>;
    get(key: string, range?: { offset?: number; length?: number }): Promise<Any>;
    head(key: string): Promise<Any>;
    list(request?: Any): Promise<{ objects: Any[]; nextAfter: string | null }>;
    delete(key: string, options?: WriteOptions): Promise<boolean>;
  };
  /** The tenant's log, or the app's own with `tenant` false. */
  logs(tenant?: boolean): {
    write(entries: Any[]): Promise<{ written: number }>;
    read(request?: Any): Promise<{ records: Any[]; nextAfter: string | null }>;
  };
  scheduler(bucket: string): {
    create(definition: Any, options?: { requestId: string }): Promise<Any>;
    get(id: string): Promise<Any | null>;
    list(page?: Any): Promise<{ items: Any[]; cursor?: string | null } & Any>;
    update(id: string, patch: Any, change: { revision: string; requestId: string }): Promise<Any>;
    pause(id: string, change: { revision: string; requestId: string }): Promise<Any>;
    resume(id: string, change: { revision: string; requestId: string }): Promise<Any>;
    remove(id: string, change: { revision: string; requestId: string }): Promise<Any>;
    getRun(id: string): Promise<Any | null>;
    listRuns(page?: Any): Promise<{ items: Any[] } & Any>;
    scheduleHistory(id: string, options?: { limit?: number }): Promise<Any[]>;
    runHistory(id: string, options?: { limit?: number }): Promise<Any[]>;
    terminate(target: Any, options: { cause: string }): Promise<Any>;
  };
}

const fault = (e: unknown): never => {
  if (e instanceof BackplaneError) throw new Fault(e.code, e.status, e.message);
  throw e;
};

/** Wraps every method of a client handle so the call is recorded and a BackplaneError becomes a Fault. */
function recorded<T extends object>(module: string, handle: T): T {
  return new Proxy(handle, {
    get(target, prop, receiver) {
      const member = Reflect.get(target, prop, receiver);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        used.rpc.add(module + "." + String(prop));
        return (member as (...a: unknown[]) => Promise<unknown>).apply(target, args).catch(fault);
      };
    },
  });
}

/** The typed client; `client` is connectBackplane's result for the suite's app. */
export function rpcOps(client: Awaited<ReturnType<typeof connectBackplane>>, tenant: string): Ops {
  const t = client.tenant(tenant);
  return {
    via: "rpc",
    cache: (b) => recorded("cache", t.cache(b)) as unknown as ReturnType<Ops["cache"]>,
    db: (b) => recorded("db", t.db(b)) as unknown as ReturnType<Ops["db"]>,
    vfs: (b) => recorded("vfs", t.vfs(b)) as unknown as ReturnType<Ops["vfs"]>,
    logs: (ofTenant = true) => recorded("logs", ofTenant ? t.logs() : client.logs()) as unknown as ReturnType<Ops["logs"]>,
    scheduler: (b) => recorded("scheduler", t.scheduler(b)) as unknown as ReturnType<Ops["scheduler"]>,
  };
}

const bigTag = (id: unknown) => (typeof id === "bigint" ? { bigint: String(id) } : id);
const untag = (id: unknown) => (id !== null && typeof id === "object" && "bigint" in id ? BigInt((id as { bigint: string }).bigint) : id);
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** The MCP tools; `agent` is connected from the client config file. */
export function mcpOps(agent: Client, app: string, tenant: string): Ops {
  async function tool(name: string, args: Any): Promise<unknown> {
    const set = used.mcp.get(name) ?? new Set<string>();
    for (const p of paths(args)) set.add(p);
    used.mcp.set(name, set);
    // VERIFIED by probe: a request over 1 MiB fails at the HTTP layer, as an SDK error whose message ends in the
    // daemon's JSON error body, not as a tool result.
    const r = await agent.callTool({ name, arguments: args }).catch((e: unknown) => {
      const body = /\{.*\}$/.exec(String((e as Error).message))?.[0];
      const parsed = body ? (JSON.parse(body) as { code?: string; status?: number; error?: string }) : null;
      if (parsed?.code) throw new Fault(parsed.code, Number(parsed.status), String(parsed.error));
      throw e;
    });
    const content = r.structuredContent as { value?: unknown; code?: string; status?: number; message?: string };
    if (r.isError) throw new Fault(String(content?.code), Number(content?.status), String(content?.message ?? JSON.stringify(r.content)));
    return content.value;
  }
  const dson = async (name: string, args: Any) => DSON.parse(((await tool(name, { ...args, resultEncoding: "dson" })) as { dson: string }).dson);
  const opts = (o?: Any) => (o ? Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) : {});
  return {
    via: "mcp",
    cache(bucket) {
      const scope = { app, tenant, bucket };
      return {
        get: (key) => dson("cache.get", { scope, key }),
        getVersioned: async (key) => (await dson("cache.getVersioned", { scope, key })) as Any,
        set: async (key, value, o) => (await tool("cache.set", { scope, key, value, ...opts(o) })) as boolean,
        delete: async (key, o) => (await tool("cache.delete", { scope, key, ...opts(o) })) as boolean,
      };
    },
    db(bucket) {
      const scope = { app, tenant, bucket };
      return {
        insert: async (document, o) =>
          untag(await tool("db.insert", { scope, document: { ...document, ...("id" in document ? { id: bigTag(document.id) } : {}) }, ...opts(o) })),
        get: async (id) => (await dson("db.get", { scope, id: bigTag(id) })) as Any | null,
        getVersioned: async (id) => (await dson("db.getVersioned", { scope, id: bigTag(id) })) as Any,
        update: async (id, patch, o) => (await tool("db.update", { scope, id: bigTag(id), patch, ...opts(o) })) as boolean,
        delete: async (id, o) => (await tool("db.delete", { scope, id: bigTag(id), ...opts(o) })) as boolean,
        query: async (request) => (await dson("db.query", { scope, ...(request ? { request } : {}) })) as { rows: Any[] },
      };
    },
    vfs(bucket) {
      const scope = { app, tenant, bucket };
      return {
        put: async (key, data, o) =>
          (await tool("vfs.put", {
            scope,
            key,
            ...(typeof data === "string" ? { data } : { data: base64(data), encoding: "base64" }),
            ...opts(o),
          })) as Any,
        async get(key, range) {
          const read = (await tool("vfs.get", { scope, key, encoding: "base64", ...(range ? { range } : {}) })) as Any;
          if (!read.found) return read;
          const { encoding: _encoding, ...rest } = read;
          return { ...rest, value: new Uint8Array(Buffer.from(read.value as string, "base64")) };
        },
        head: async (key) => (await tool("vfs.head", { scope, key })) as Any,
        list: async (request) => (await tool("vfs.list", { scope, ...(request ? { request } : {}) })) as { objects: Any[]; nextAfter: string | null },
        delete: async (key, o) => (await tool("vfs.delete", { scope, key, ...opts(o) })) as boolean,
      };
    },
    logs(ofTenant = true) {
      const scope = ofTenant ? { app, tenant } : { app };
      return {
        write: async (entries) => (await tool("logs.write", { scope, entries })) as { written: number },
        async read(request) {
          const iso = request && Object.fromEntries(Object.entries(request).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
          return (await dson("logs.read", { scope, ...(iso ? { request: iso } : {}) })) as { records: Any[]; nextAfter: string | null };
        },
      };
    },
    scheduler(bucket) {
      const scope = { app, tenant, bucket };
      const t = async (name: string, args: Any) => (await tool("scheduler." + name, { scope, ...args })) as Any;
      return {
        create: (definition, options) => t("create", { definition, ...(options ? { options } : {}) }),
        get: async (id) => (await t("get", { id })) as Any | null,
        list: async (page) => (await t("list", page ? { page } : {})) as { items: Any[] } & Any,
        update: (id, patch, change) => t("update", { id, patch, change }),
        pause: (id, change) => t("pause", { id, change }),
        resume: (id, change) => t("resume", { id, change }),
        remove: (id, change) => t("remove", { id, change }),
        getRun: async (id) => (await t("getRun", { id })) as Any | null,
        listRuns: async (page) => (await t("listRuns", page ? { page } : {})) as { items: Any[] } & Any,
        scheduleHistory: async (id, options) => (await t("scheduleHistory", { id, ...(options ? { options } : {}) })) as unknown as Any[],
        runHistory: async (id, options) => (await t("runHistory", { id, ...(options ? { options } : {}) })) as unknown as Any[],
        terminate: (target, options) => t("terminate", { target, options }),
      };
    },
  };
}

/** Every property path of a tool's input schema, through objects, `anyOf` alternatives and array items. */
export function schemaPaths(schema: Any, prefix = ""): string[] {
  const out: string[] = [];
  const props = (schema.properties ?? {}) as Record<string, Any>;
  for (const [k, child] of Object.entries(props)) {
    const path = prefix ? prefix + "." + k : k;
    out.push(path, ...nested(child, path));
  }
  return out;
}
function nested(schema: Any, path: string): string[] {
  const alternatives = (schema.anyOf as Any[] | undefined) ?? [schema];
  return alternatives.flatMap((alt) => [
    ...(alt.properties ? schemaPaths(alt, path) : []),
    ...((alt.items as Any | undefined)?.properties ? schemaPaths(alt.items as Any, path + "[]") : []),
  ]);
}
