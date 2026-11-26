/** VERIFIED: tests/api.test.ts calls every method once through the defuss-rpc client and the MCP bridge. The public RPC
 * API of the tracker: the browser imports `type Api` only, so the compiler checks both sides of every call. Without
 * user auth every write acts as the configured viewer. */
import { BackplaneError } from "defuss-backplane/client";
import { type Fault, faultMessage } from "../core/faults.ts";
import { parseIssueId } from "../core/ids.ts";
import { type Fields, InvalidInput } from "../core/issue.ts";
import { currentCycle } from "../core/stats.ts";
import { createJobs } from "./jobs.ts";
import type { Log } from "./log.ts";
import { NotFound, type Workspace } from "./workspace.ts";

export type ApiContext = { ws: Workspace; viewer: string; workspace: string; timeZone: string; log: Log };

/** The fault of an error a method threw; a backplane that cannot be reached is UNAVAILABLE. */
export function faultOf(error: unknown): Fault {
  if (error instanceof InvalidInput) return { code: "INVALID_INPUT", field: error.field, message: error.detail };
  if (error instanceof NotFound) return { code: "NOT_FOUND", message: error.message };
  if (error instanceof BackplaneError) {
    if (error.code === "REVISION_CONFLICT") return { code: "REVISION_CONFLICT", message: error.message };
    // VERIFIED: BUSY is the backplane's only 503 code (defuss-backplane src/errors.ts).
    if (error.code === "BUSY") return { code: "UNAVAILABLE", message: error.message };
  }
  if (error instanceof TypeError && /fetch|connect/i.test(error.message))
    return { code: "UNAVAILABLE", message: "The backplane cannot be reached" };
  return { code: "INTERNAL", message: "Internal error" };
}

/** Each method rethrows a coded message, and an INTERNAL fault leaves one log line with the real error. */
function withFaults<T extends Record<string, Record<string, (...args: never[]) => Promise<unknown>>>>(api: T, log: Log): T {
  const wrapped: Record<string, Record<string, unknown>> = {};
  for (const [namespace, methods] of Object.entries(api)) {
    wrapped[namespace] = {};
    for (const [name, method] of Object.entries(methods))
      wrapped[namespace][name] = async (...args: never[]) => {
        try {
          return await method(...args);
        } catch (error) {
          const fault = faultOf(error);
          if (fault.code === "INTERNAL" || fault.code === "UNAVAILABLE")
            log.error("call failed", { method: namespace + "." + name, error: String(error) });
          throw new Error(faultMessage(fault));
        }
      };
  }
  return wrapped as T;
}

function issueRef(id: unknown) {
  if (!parseIssueId(id)) throw new InvalidInput("id", "must be an issue ID such as ENG-142");
  return id as string;
}
/** VERIFIED: without the check, a non-string cycle ID reached the backplane, whose TypeError became a 500
 * (scripts/e2e-api.ts found it). */
function cycleRef(id: unknown) {
  if (typeof id !== "string" || !id) throw new InvalidInput("id", "must be a cycle ID such as eng-24");
  return id;
}
/** Without the check, a string would match by substring through `includes`. */
function itemIds(ids: unknown) {
  if (ids !== undefined && !(Array.isArray(ids) && ids.every((id) => typeof id === "string")))
    throw new InvalidInput("ids", "must be a list of inbox item IDs");
  return ids as string[] | undefined;
}

export function createApi({ ws, viewer, workspace, timeZone, log }: ApiContext) {
  const api = {
    Workspace: {
      /** People, teams, projects and cycles, the viewer and today's date: everything the first render needs. */
      async bootstrap() {
        return { workspace, viewer, timeZone, today: ws.today(), ...(await ws.directory()) };
      },
    },
    Issues: {
      /** Every issue, newest first. */
      list: () => ws.issues.list(),
      /** One issue with its revision, comments, activity and attachments: the issue page. */
      async get(id: string) {
        const ref = issueRef(id);
        const [current, comments, events, attachments] = await Promise.all([
          ws.issues.get(ref),
          ws.comments.list(ref),
          ws.events.list(ref),
          ws.attachments.list(ref),
        ]);
        return { ...current, comments, events, attachments };
      },
      create: (draft: Partial<Fields>) => ws.issues.create(draft, viewer),
      /** With `ifRevision`, fails with REVISION_CONFLICT when someone changed the issue since that revision. */
      update: (id: string, patch: Partial<Fields>, ifRevision?: string) =>
        ws.issues.update(issueRef(id), patch, viewer, ifRevision),
      async remove(id: string, ifRevision?: string) {
        await ws.issues.remove(issueRef(id), viewer, ifRevision);
        return true;
      },
      comment: (id: string, body: string) => ws.comments.add(issueRef(id), viewer, body),
      attachments: (id: string) => ws.attachments.list(issueRef(id)),
      removeAttachment: (id: string, name: string) => ws.attachments.remove(issueRef(id), name),
    },
    Inbox: {
      /** The viewer's items, newest first. */
      list: () => ws.inbox.list(viewer),
      /** Marks the viewer's items read, or only `ids`; returns how many changed. */
      markRead: (ids?: string[]) => ws.inbox.markRead(viewer, itemIds(ids)),
    },
    Cycles: {
      /** The running cycle with its statistics, or null when the team has none. */
      async current() {
        const cycle = currentCycle(await ws.cycles.list(), ws.today());
        return cycle ? { cycle, stats: await ws.cycles.stats(cycle.id) } : null;
      },
      stats: (id: string) => ws.cycles.stats(cycleRef(id)),
    },
    /** Called by the backplane's scheduler with the bot key; a guard refuses every other caller, and MCP leaves them out. */
    Jobs: createJobs(ws),
  };
  return withFaults(api, log);
}

export type Api = ReturnType<typeof createApi>;
