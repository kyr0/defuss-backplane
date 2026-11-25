/** VERIFIED: scripts/e2e.ts drives it in Chromium, Firefox and WebKit. The browser's RPC client: a defuss-rpc context on the page's own origin, which needs no key. The server types the
 * calls: `type Api` comes from the server module and is erased from the bundle. */
import { createRpcContext } from "defuss-rpc/client";
import { type Fault, parseFault } from "../core/faults.ts";
import type { Api } from "../server/api.ts";

export const rpc = createRpcContext({ baseUrl: location.origin });
let client: Api | undefined;

export async function connect() {
  client = await rpc.getRpcClient<Api>();
  return client;
}

/** The connected client; `connect()` runs before any view renders. */
export function api() {
  if (!client) throw new Error("connect() first");
  return client;
}

/** The fault of a failed call: its code from the body the server sent. */
export function faultOf(error: unknown): Fault {
  const e = error as { body?: unknown; message?: unknown } | null;
  return parseFault(typeof e?.body === "string" ? e.body : String(e?.message ?? error));
}
