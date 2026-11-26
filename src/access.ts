/** VERIFIED: tests/bots.test.ts. Who sent the request being served, and what it may reach. `guarded` in server.ts resolves the caller once per request
 * and runs the endpoint inside `runAs`; the RPC guard hook, the transfer routes and the callback check then ask
 * `allowApp` or `requireAdmin` here, so every entry point applies the same rule. Why an AsyncLocalStorage instead of
 * passing the caller along: defuss-rpc hands its handlers only their arguments, and MCP reaches the same handlers
 * through `rpc.fetch`. */
import { AsyncLocalStorage } from "node:async_hooks";
import { BackplaneError } from "./errors.js";

/** The `API_KEY` from `.env` reaches everything. A bot reaches the apps its claims name; `admin` reaches every app and
 * the bot users. */
export type Caller =
  | { kind: "root" }
  | { kind: "bot"; id: string; apps: ReadonlySet<string>; admin: boolean };

const current = new AsyncLocalStorage<Caller>();

export const runAs = <T>(caller: Caller, run: () => T) => current.run(caller, run);

/** The caller of the request being served. Outside a request, as in the storage tests and the callback dispatcher, the
 * daemon itself acts, with the root's reach. */
export const caller = (): Caller => current.getStore() ?? { kind: "root" };

export const isAdmin = (who: Caller = caller()) => who.kind === "root" || who.admin;

export function mayUseApp(app: unknown, who: Caller = caller()) {
  return isAdmin(who) || (who.kind === "bot" && typeof app === "string" && who.apps.has(app));
}

export function allowApp(app: unknown) {
  if (!mayUseApp(app)) throw new BackplaneError("FORBIDDEN", "This bot key may not use app " + JSON.stringify(app));
}

export function requireAdmin() {
  if (!isAdmin()) throw new BackplaneError("FORBIDDEN", "Only the root key or an admin bot may do this");
}
