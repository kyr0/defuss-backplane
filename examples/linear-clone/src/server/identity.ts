/** VERIFIED: tests/auth.test.ts. Who sent an API call: the RPC route asks the backplane's auth on every call, maps the
 * signed-in subject to the workspace person it acts as, and runs the call inside an AsyncLocalStorage holding that
 * person, so `viewer()` names the actor of every write. Why ask per call instead of checking the JWT locally: a removed
 * member or a revoked agent key then fails on the next call, and an agent's API key is opaque. Why AsyncLocalStorage:
 * defuss-rpc hands its functions only their arguments, and MCP reaches them through the same route. */
import { AsyncLocalStorage } from "node:async_hooks";
import { BackplaneError } from "defuss-backplane/client";
import { type Fault, faultMessage } from "../core/faults.ts";
import type { Workspace } from "./workspace.ts";

/** The person a call acts as, and the auth subject behind it: a signed-in user or an agent's service account. */
export type Viewer = { person: string; subject: string; kind: "user" | "service" };

const current = new AsyncLocalStorage<Viewer>();

export const runAs = <T>(who: Viewer, run: () => T) => current.run(who, run);
export const currentViewer = () => current.getStore();

/** The person of the call being served. A function outside a signed-in call throws UNAUTHENTICATED. */
export function viewer() {
  const who = current.getStore();
  if (!who) throw new Error(faultMessage({ code: "UNAUTHENTICATED", message: "Sign in first" }));
  return who.person;
}

/** The viewer an `Authorization` field stands for, or the fault to answer. A backplane that cannot answer throws. */
export async function identify(ws: Workspace, authorization: string): Promise<Viewer | Fault> {
  if (!authorization) return { code: "UNAUTHENTICATED", message: "Sign in, or send an agent's API key" };
  let subject: string, kind: "user" | "service";
  try {
    ({ subjectId: subject, subjectKind: kind } = await ws.members.authenticate(authorization));
  } catch (error) {
    // 401 for an unknown, expired or revoked credential; 403 for one of another tenant.
    if (error instanceof BackplaneError && (error.status === 401 || error.status === 403))
      return { code: "UNAUTHENTICATED", message: "This credential is not valid in this workspace" };
    throw error;
  }
  const person = await ws.members.personOf(subject);
  if (!person) return { code: "FORBIDDEN", message: "This account is no person of the workspace" };
  return { person: person.id, subject, kind };
}
