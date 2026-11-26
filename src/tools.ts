/** VERIFIED: MCP accepts open document objects through JSON schemas and sends their named fields to the same RPC dispatcher as the backend client. */
import { createMcpApi, ToolFault } from "defuss-mcp";
import type { InputSchema } from "defuss-mcp";
import { ajvValidator } from "defuss-mcp/validation";
import type { RpcServer } from "defuss-rpc/server";
import { DSON } from "defuss-dson";
import { LOG_LEVELS } from "defuss-logs";
import { BackplaneError } from "./errors.js";
import { capture, withFaults, toolFaultKey } from "./faults.js";
import { isDeepStrictEqual } from "node:util";

const text = { type: "string", minLength: 1 };
const object = { type: "object" };
const scope = {
  type: "object",
  properties: { app: text, tenant: text, bucket: text },
  required: ["app", "tenant", "bucket"],
  additionalProperties: false,
};
const bigintId = {
  type: "object",
  properties: { bigint: { type: "string", pattern: "^(?:0|-?[1-9][0-9]*)$" } },
  required: ["bigint"],
  additionalProperties: false,
};
const id = { anyOf: [{ type: "string" }, { type: "number" }, bigintId] };
const ifRevision = {
  anyOf: [text, { type: "null" }],
  description: "Opaque token from getVersioned, or null to require absence.",
};
/** MCP arguments are JSON, so a bigint ID arrives as `{ bigint: "<digits>" }` and becomes a native bigint here. */
function decodeId(value: unknown) {
  if (value !== null && typeof value === "object" && "bigint" in value)
    return BigInt(value.bigint as string);
  return value;
}
/** True when a JSON round trip returns an equal value without repeated references. A read that fails this check
 * returns DSON_REQUIRED instead of a JSON result that would silently lose dates, binary, bigints or shared objects. */
function jsonEquivalent(value: unknown) {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(value, (_key, child: unknown) => {
      if (child !== null && typeof child === "object") {
        if (seen.has(child)) throw new TypeError("Repeated reference");
        seen.add(child);
      }
      return child;
    });
    return isDeepStrictEqual(value, JSON.parse(json));
  } catch {
    return false;
  }
}
/** Converts MCP text fields to and from object bytes. Binary travels as base64 because MCP arguments are JSON. */
const encoding = {
  type: "string",
  enum: ["utf8", "base64"],
  description: "utf8 (default) for text, base64 for binary content.",
};
const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
function invalid(message: string): never {
  throw new ToolFault(
    toolFaultKey(new BackplaneError("INVALID_ARGUMENT", message)),
  );
}
function encodeData(args: Record<string, unknown>) {
  if (args.encoding !== "base64") return args;
  const data = args.data as string;
  if (!base64.test(data)) invalid("data is not valid base64");
  return { ...args, data: new Uint8Array(Buffer.from(data, "base64")) };
}
function decodeData(result: unknown, args: Record<string, unknown>) {
  const read = result as { found: boolean; value?: Uint8Array };
  if (!read.found) return read;
  const bytes = read.value as Uint8Array;
  if (args.encoding === "base64")
    return {
      ...read,
      value: Buffer.from(bytes).toString("base64"),
      encoding: "base64",
    };
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ...read, value, encoding: "utf8" };
  } catch {
    return invalid("The object is not valid UTF-8. Read it with encoding base64");
  }
}
interface Adapter {
  /** A scope schema other than app, tenant and bucket. */
  scope?: object;
  /** The method takes no scope, such as `bots.list`. */
  noScope?: true;
  /** Input fields the adapter consumes instead of forwarding. */
  fields?: Record<string, object>;
  input?(args: Record<string, unknown>): Record<string, unknown>;
  output?(result: unknown, args: Record<string, unknown>): unknown;
}
const query = {
  type: "object",
  properties: {
    filters: { type: "array", items: object },
    sorters: { type: "array", items: object },
    limit: { type: "integer", minimum: 0, maximum: 1000 },
    offset: { type: "integer", minimum: 0 },
    projection: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};

/** Each tool call goes to `rpc`, the daemon's own RPC server, so both protocols share one dispatcher and its faults.
 * The twelve scheduler tools manage schedules. Workers use RPC, so claim, renew, complete and fail have no tool. The
 * four auth tools only read. */
export function makeTools(rpc: Pick<RpcServer, "fetch">) {
  const compile = ajvValidator();
  const tools = createMcpApi(
    { name: "defuss-backplane", version: "0.3.0" },
    {
      compile: (schema) => {
        const validate = compile(schema);
        return (value) => {
          const issues = validate(value);
          if (issues?.length)
            capture(
              new BackplaneError("INVALID_ARGUMENT", "Invalid tool arguments"),
            );
          return issues;
        };
      },
    },
  );
  /** Registers one tool that forwards to the RPC method of the same name. `fields` must list the method's parameters
   * after `scope` in declaration order: the handler passes them positionally and folds `ifRevision` and `ttlMs` into
   * one trailing options object, a form the services also accept from the TypeScript client. */
  function tool(
    name: string,
    description: string,
    fields: Record<string, object>,
    optional: string[] = [],
    adapter: Adapter = {},
  ) {
    const [namespace, method] = name.split(".");
    const params = adapter.noScope ? { ...fields } : { scope: (adapter.scope ?? scope) as typeof scope, ...fields };
    const keys = Object.keys(params);
    const read = [
      "get",
      "getVersioned",
      "query",
      "head",
      "list",
      "getRun",
      "listRuns",
      "scheduleHistory",
      "runHistory",
      "read",
      "status",
      "members",
      "listApiKeys",
    ].includes(method);
    // Cache values, documents and log arguments can hold native values. VFS metadata and scheduler records are JSON,
    // so they need no DSON.
    const native = read && ["cache", "db", "logs"].includes(namespace);
    const input: InputSchema = {
      type: "object",
      properties: {
        ...params,
        ...adapter.fields,
        ...(native
          ? {
              resultEncoding: {
                type: "string",
                enum: ["json", "dson"],
                description:
                  "Use dson for native values such as dates or binary.",
              },
            }
          : {}),
      },
      required: keys.filter((k) => !optional.includes(k)),
      additionalProperties: false,
    };
    tools.json(
      name,
      input,
      async (input, ctx) => {
        const args = adapter.input ? adapter.input(input) : input;
        const values = keys
          .filter((k) => k !== "ifRevision" && k !== "ttlMs")
          .map((k) => {
            if (k === "id") return decodeId(args.id);
            if (k === "document") {
              const doc = args.document as Record<string, unknown>;
              if (Object.hasOwn(doc, "id"))
                return { ...doc, id: decodeId(doc.id) };
            }
            return args[k];
          });
        if (Object.hasOwn(args, "ifRevision") || Object.hasOwn(args, "ttlMs"))
          values.push({
            ...("ifRevision" in args && { ifRevision: args.ifRevision }),
            ...("ttlMs" in args && { ttlMs: args.ttlMs }),
          });
        // Omitted trailing options retain the same defaults as calls from a TypeScript backend.
        while (values.length && values.at(-1) === undefined) values.pop();
        const response = await withFaults(false, () =>
          rpc.fetch(
            new Request("http://127.0.0.1/rpc", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: ctx.request?.headers.get("authorization") ?? "",
              },
              signal: ctx.signal,
              body: DSON.stringify({
                className: namespace,
                methodName: method,
                args: values,
              }),
            }),
          ),
        );
        const body = await response.text();
        if (!response.ok) {
          const { code, error, status } = JSON.parse(body);
          throw new ToolFault(
            toolFaultKey(new BackplaneError(code, error, status)),
          );
        }
        if (args.resultEncoding === "dson") return { dson: body };
        let result = DSON.parse(body);
        if (adapter.output) result = adapter.output(result, args);
        if (native && !jsonEquivalent(result)) {
          const fault = new BackplaneError(
            "DSON_REQUIRED",
            "Read again with resultEncoding set to dson to preserve native values or shared references",
          );
          throw new ToolFault(toolFaultKey(fault));
        }
        if (name === "db.insert" && typeof result === "bigint")
          return { bigint: String(result) };
        return result;
      },
      {
        description,
        annotations: {
          readOnlyHint: read,
          destructiveHint: [
            "cache.set",
            "cache.delete",
            "db.update",
            "db.delete",
            "vfs.put",
            "vfs.delete",
            "scheduler.update",
            "scheduler.pause",
            "scheduler.remove",
            "scheduler.terminate",
          ].includes(name),
          openWorldHint: false,
        },
      },
    );
  }
  tool("cache.get", "Read a cache entry. A hit may contain null.", {
    key: text,
  });
  tool(
    "cache.getVersioned",
    "Read the value and its revision. A miss has a null revision.",
    { key: text },
  );
  tool(
    "cache.set",
    "Write a cache value. An optional TTL is measured in milliseconds.",
    {
      key: text,
      value: {},
      ttlMs: { type: "integer", minimum: 0 },
      ifRevision,
    },
    ["ttlMs", "ifRevision"],
  );
  tool(
    "cache.delete",
    "Remove a cache key. Repeated deletes succeed.",
    {
      key: text,
      ifRevision,
    },
    ["ifRevision"],
  );
  tool(
    "db.insert",
    "Insert one document and return its ID.",
    {
      document: { type: "object", properties: { id } },
      ifRevision: { type: "null" },
    },
    ["ifRevision"],
  );
  tool("db.get", "Read one document by ID. A missing document returns null.", {
    id,
  });
  tool(
    "db.getVersioned",
    "Read a document and its revision from one snapshot.",
    { id },
  );
  tool(
    "db.update",
    "Apply a field patch to a document. Its ID stays fixed.",
    {
      id,
      patch: object,
      ifRevision,
    },
    ["ifRevision"],
  );
  tool("db.delete", "Delete one document by ID.", { id, ifRevision }, [
    "ifRevision",
  ]);
  tool(
    "db.query",
    "Filter, sort, page and project documents in one collection.",
    { request: query },
    ["request"],
  );
  const key = {
    type: "string",
    minLength: 1,
    description: "Relative path such as reports/2026/q3.csv.",
  };
  tool(
    "vfs.put",
    "Write a whole object and return its metadata. The request, including the encoded data, must fit in 1 MiB.",
    { key, data: { type: "string" }, ifRevision },
    ["ifRevision"],
    { fields: { encoding }, input: encodeData },
  );
  tool(
    "vfs.get",
    "Read an object, or a byte range of it, of at most 1 MiB with its revision. A missing key has a null revision.",
    {
      key,
      range: {
        type: "object",
        properties: {
          offset: { type: "integer", minimum: 0 },
          length: { type: "integer", minimum: 0, maximum: 1048576 },
        },
        additionalProperties: false,
      },
    },
    ["range"],
    { fields: { encoding }, output: decodeData },
  );
  tool(
    "vfs.head",
    "Read an object's size, revision and modification time without its content.",
    { key },
  );
  tool(
    "vfs.list",
    "List objects in key order. Pass nextAfter from the previous page as after.",
    {
      request: {
        type: "object",
        properties: {
          prefix: { type: "string" },
          after: { anyOf: [key, { type: "null" }] },
          limit: { type: "integer", minimum: 1, maximum: 1000 },
        },
        additionalProperties: false,
      },
    },
    ["request"],
  );
  tool("vfs.delete", "Delete one object. A missing key returns false.", {
    key,
    ifRevision,
  }, ["ifRevision"]);
  logTools(tool);
  schedulerTools(tool);
  authTools(tool);
  return tools;
}

/** Read-only views of sign-in and keys, so an agent can debug why a login or a key fails. The writes stay RPC-only:
 * a new key or password would land in the agent's transcript, and whoever holds the root key makes them over RPC. */
function authTools(
  tool: (name: string, description: string, fields: Record<string, object>, optional?: string[], adapter?: Adapter) => void,
) {
  const app = { type: "object", properties: { app: text }, required: ["app"], additionalProperties: false };
  const tenant = {
    type: "object",
    properties: { app: text, tenant: text },
    required: ["app", "tenant"],
    additionalProperties: false,
  };
  tool(
    "auth.status",
    "Whether auth is on, and the app's sign-in registration: origin, mode, issuer and audience. It answers while auth is off.",
    {},
    [],
    { scope: app },
  );
  tool(
    "auth.members",
    "Page through a tenant's members with email, status and claims, never a password. Pass next as page.after for the next page; a page can hold fewer than limit.",
    {
      page: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 500 }, after: text },
        additionalProperties: false,
      },
    },
    ["page"],
    { scope: tenant },
  );
  tool(
    "auth.listApiKeys",
    "List the API keys of a tenant's agents: name, claims, expiry and revocation. A key's secret is never shown.",
    {},
    [],
    { scope: tenant },
  );
  tool(
    "bots.list",
    "List the backplane's bot users with the apps they reach and their key's expiry, never the key. Needs the root key or an admin bot.",
    {},
    [],
    { noScope: true },
  );
}

/** Writes and reads an app's log, or one tenant's log of that app. JSON carries no dates, so timestamps travel as
 * ISO-8601 strings and the daemon stamps entries written over MCP itself. */
function logTools(
  tool: (
    name: string,
    description: string,
    fields: Record<string, object>,
    optional?: string[],
    adapter?: Adapter,
  ) => void,
) {
  const scope = {
    type: "object",
    properties: { app: text, tenant: text },
    required: ["app"],
    additionalProperties: false,
    description: "Without tenant, the app's own log. With tenant, that tenant's log of the app.",
  };
  const level = { type: "string", enum: [...LOG_LEVELS] };
  tool(
    "logs.write",
    "Append 1 to 1000 log entries in one transaction. The daemon assigns each entry its ID and the current time.",
    {
      entries: {
        type: "array",
        minItems: 1,
        maxItems: 1000,
        items: {
          type: "object",
          properties: {
            level,
            message: { type: "string" },
            args: { type: "array" },
            context: object,
          },
          required: ["level", "message"],
          additionalProperties: false,
        },
      },
    },
    [],
    { scope },
  );
  const time = { type: "string", description: "ISO-8601 time such as 2026-11-24T18:00:00Z." };
  tool(
    "logs.read",
    "Read log records in time order. from is inclusive, before exclusive. Pass nextAfter from the previous page as after.",
    {
      request: {
        type: "object",
        properties: {
          from: time,
          before: time,
          levels: { type: "array", items: level, minItems: 1 },
          limit: { type: "integer", minimum: 1, maximum: 1000 },
          after: { anyOf: [text, { type: "null" }] },
        },
        additionalProperties: false,
      },
    },
    ["request"],
    {
      scope,
      input(args) {
        const request = args.request as Record<string, unknown> | undefined;
        if (!request) return args;
        const dated = { ...request };
        for (const field of ["from", "before"])
          if (field in request) {
            const value = new Date(request[field] as string);
            if (Number.isNaN(value.getTime())) invalid(field + " must be an ISO-8601 time");
            dated[field] = value;
          }
        return { ...args, request: dated };
      },
      output(result) {
        const page = result as { records: { ts: Date }[]; nextAfter: string | null };
        return {
          ...page,
          records: page.records.map((entry) => ({ ...entry, ts: entry.ts.toISOString() })),
        };
      },
    },
  );
}

/** The management half of a defuss-scheduler queue. Edits carry `change: { revision, requestId }`; repeating a call
 * with the same requestId and arguments returns its first result, so an agent can retry after a lost response. */
function schedulerTools(
  tool: (
    name: string,
    description: string,
    fields: Record<string, object>,
    optional?: string[],
  ) => void,
) {
  const change = {
    type: "object",
    properties: { revision: text, requestId: text },
    required: ["revision", "requestId"],
    additionalProperties: false,
    description: "The schedule's current revision and a unique ID for this edit.",
  };
  const page = {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 500 },
      cursor: text,
      ref: { ...text, description: "List only what carries this ref." },
    },
    additionalProperties: false,
  };
  tool(
    "scheduler.create",
    "Create a cron schedule with an unused ID. The definition names a handler and may carry a JSON payload and a ref, a name of your own that several schedules can share. With handler _rpc the daemon itself calls an app's RPC function at each occurrence: the payload is {url, className, methodName, args}, and url must be on loopback or an allowed origin.",
    {
      definition: object,
      options: {
        type: "object",
        properties: { requestId: text },
        required: ["requestId"],
        additionalProperties: false,
      },
    },
    ["options"],
  );
  tool("scheduler.get", "Read one schedule. A missing ID returns null.", {
    id: text,
  });
  tool("scheduler.list", "Page through the schedules in key order.", { page }, [
    "page",
  ]);
  tool(
    "scheduler.update",
    "Change a schedule's cron, timezone, handler, payload, capabilities, retry or misfire settings.",
    { id: text, patch: object, change },
  );
  tool(
    "scheduler.pause",
    "Stop creating runs for a schedule. Runs already created stay eligible.",
    { id: text, change },
  );
  tool(
    "scheduler.resume",
    "Resume a paused schedule from the next occurrence after now.",
    { id: text, change },
  );
  tool(
    "scheduler.remove",
    "Stop a schedule for good. Its ID stays reserved.",
    { id: text, change },
  );
  tool("scheduler.getRun", "Read one run. A missing ID returns null.", {
    id: text,
  });
  tool("scheduler.listRuns", "Page through runs with their state and result.", {
    page,
  }, ["page"]);
  // defuss-scheduler keeps every version of a schedule, and of a run until retention removes it, so an agent can ask
  // what a job did earlier.
  const options = {
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 500 } },
    additionalProperties: false,
  };
  tool(
    "scheduler.scheduleHistory",
    "List every definition and state a schedule had, newest first. Each entry holds from, until and value.",
    { id: text, options },
    ["options"],
  );
  tool(
    "scheduler.runHistory",
    "List every status a run went through, newest first. Retention erases the history with the run.",
    { id: text, options },
    ["options"],
  );
  tool(
    "scheduler.terminate",
    "Stop work at once and record why. Unlike pause and remove it does not wait for due occurrences. Schedules and unfinished runs, running ones included, end as terminated with the cause.",
    {
      target: {
        type: "object",
        properties: {
          run: text,
          schedule: text,
          ref: text,
          all: { const: true },
        },
        minProperties: 1,
        maxProperties: 1,
        additionalProperties: false,
        description:
          "Exactly one of: run (one run ID), schedule (one schedule and its runs), ref (every schedule carrying it), all (the whole scope).",
      },
      options: {
        type: "object",
        properties: { cause: text },
        required: ["cause"],
        additionalProperties: false,
      },
    },
  );
}
