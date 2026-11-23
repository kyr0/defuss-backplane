/** VERIFIED: Preserve typed service exceptions across adapters that reduce thrown values to messages. */
import { AsyncLocalStorage } from "node:async_hooks";
import { SchedulerError } from "defuss-scheduler";
import { BackplaneError, type ErrorCode } from "./errors.js";

interface FaultContext {
  fault?: BackplaneError;
  tools?: Map<string, BackplaneError>;
}
const active = new AsyncLocalStorage<FaultContext>();

// ToolFault preserves only a message. Match each one to its own result, even in a legacy batch.
export function toolFaultKey(fault: BackplaneError) {
  const context = active.getStore();
  if (!context) return fault.message;
  const faults = (context.tools ??= new Map());
  const key = "backplane-fault-" + faults.size;
  faults.set(key, fault);
  return key;
}

export function capture(error: unknown) {
  const fault = normalize(error);
  const context = active.getStore();
  if (context) context.fault = fault;
  return fault;
}
function normalize(error: unknown) {
  if (error instanceof BackplaneError) return error;
  if (error instanceof SchedulerError) {
    // A stopped or foreign authority clears once its owner restarts, so the caller retries as for BUSY.
    if (error.code === "CLOSED" || error.code === "OWNER_BUSY")
      return new BackplaneError("BUSY", "Scheduler unavailable");
    if (error.code === "FORMAT")
      return new BackplaneError("STORAGE_ERROR", "Scheduler store unreadable");
    return new BackplaneError(error.code, error.message);
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "DUPLICATE_KEY")
    return new BackplaneError(
      "ALREADY_EXISTS",
      "The document ID already exists",
    );
  // defuss-vfs reports a failed ifMatch as PRECONDITION_FAILED and a failed ifAbsent as EEXIST.
  if (code === "CONFLICT" || code === "PRECONDITION_FAILED" || code === "EEXIST")
    return new BackplaneError(
      "REVISION_CONFLICT",
      "Concurrent change. Read the latest revision",
    );
  if (code === "EISDIR" || code === "ENOTDIR")
    return new BackplaneError(
      "INVALID_ARGUMENT",
      "An object key cannot also be a directory prefix of another key",
    );
  if (code === "QUEUE_FULL" || code === "BUSY" || code === "EBUSY")
    return new BackplaneError("BUSY", "Storage is busy");
  if (code === "COMMIT_UNCERTAIN")
    return new BackplaneError(
      "COMMIT_UNCERTAIN",
      "Commit outcome unknown. Read before retrying",
    );
  if (code === "LIMIT_EXCEEDED")
    return new BackplaneError(
      "PAYLOAD_TOO_LARGE",
      "Storage operation exceeds an engine limit",
    );
  if (
    error instanceof TypeError ||
    error instanceof RangeError ||
    code === "INVALID_DOCUMENT" ||
    code === "INVALID_INDEX_VALUE"
  )
    return new BackplaneError(
      "INVALID_ARGUMENT",
      error instanceof Error ? error.message : "Invalid argument",
    );
  return new BackplaneError("STORAGE_ERROR", "Storage operation failed");
}

export function observeMethods<T extends object>(methods: T) {
  return Object.fromEntries(
    Object.entries(methods).map(([name, fn]) => [
      name,
      async (...args: unknown[]) => {
        try {
          return await fn(...args);
        } catch (error) {
          throw capture(error);
        }
      },
    ]),
  ) as T;
}
export function httpCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return "INVALID_ARGUMENT";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 405:
      return "METHOD_NOT_ALLOWED";
    case 413:
      return "PAYLOAD_TOO_LARGE";
    default:
      return "INTERNAL_ERROR";
  }
}
/** Runs one network call in its own fault context, then restores the typed fault that defuss-rpc or defuss-mcp
 * reduced to a message. An RPC error body gets `{code,error,status}` from the captured fault. An MCP tool error gets
 * the fault registered under the key that `toolFaultKey` placed in its message. A schema rejection keeps the MCP
 * field corrections and only takes this package's code and status. A call without a fault returns the protocol's
 * original response. */
export async function withFaults(
  mcp: boolean,
  dispatch: () => Promise<Response>,
) {
  const context: FaultContext = {};
  const response = await active.run(context, dispatch);
  if (mcp) {
    if (!context.fault && !context.tools) return response;
    const payload = await response.json();
    for (const reply of Array.isArray(payload) ? payload : [payload]) {
      const result = reply.result;
      if (!result?.isError) continue;
      const details = result.structuredContent;
      const fault = context.tools?.get(details.message);
      if (fault) {
        Object.assign(details, {
          code: fault.code,
          status: fault.status,
          message: fault.message,
        });
        result.content = [{ type: "text", text: fault.message }];
      } else if (details.code === "INVALID_ARGUMENTS") {
        Object.assign(details, { code: "INVALID_ARGUMENT", status: 400 });
      }
    }
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return Response.json(payload, { status: response.status, headers });
  }
  if (response.ok) return response;
  const fault =
    context.fault ??
    new BackplaneError(
      httpCode(response.status),
      (await response.json()).error,
      response.status,
    );
  return Response.json(
    { code: fault.code, error: fault.message, status: fault.status },
    { status: fault.status },
  );
}
