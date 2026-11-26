/** VERIFIED: tests/jobs.test.ts against a real daemon. The app runs no timer of its own: the backplane's scheduler calls
 * `Jobs.dueDigest` and `Jobs.cycleRollover` over RPC (handler `_rpc`), with a one-time token the app checks with the
 * backplane. Why the backplane's scheduler: schedules, retries and run history survive the app's restarts, and agents
 * can inspect them over MCP. */
import { rpcCalls } from "defuss-rpc/client";
import { dueDigest } from "../core/digest.ts";
import type { Notification } from "../core/model.ts";
import { planRollover } from "../core/rollover.ts";
import type { Api } from "./api.ts";
import { currentViewer } from "./identity.ts";
import { APP, type Workspace } from "./workspace.ts";

/** The actor of changes the jobs make. */
export const SYSTEM = "system";
/** A team behind by many cycles catches up one cycle per plan; this bounds one call. */
const MAX_ROLLOVERS = 52;

/** `id` names the job: it is the first schedule's ID and the `ref` of every schedule for the job. */
export type JobSchedule = { id: string; cron: string; methodName: "dueDigest" | "cycleRollover" };

/** The two schedules, at the configured times. */
export const schedules = (crons: { digestCron: string; rolloverCron: string }): JobSchedule[] => [
  { id: "due-digest", cron: crons.digestCron, methodName: "dueDigest" },
  { id: "cycle-rollover", cron: crons.rolloverCron, methodName: "cycleRollover" },
];

type Queue = Workspace["scheduler"];
type Schedule = NonNullable<Awaited<ReturnType<Queue["get"]>>>;
const admits = (s: Schedule | null): s is Schedule => !!s && (s.state === "active" || s.state === "paused");

/** The job's schedule that still admits runs: the one under the job's ID, else one that carries it as `ref`. */
async function liveSchedule(queue: Queue, job: string, first: Schedule | null) {
  if (admits(first)) return first;
  let cursor: string | null | undefined;
  do {
    const page = await queue.list({ ref: job, limit: 500, ...(cursor ? { cursor } : {}) });
    const found = page.items.find(admits);
    if (found) return found;
    cursor = page.cursor;
  } while (cursor);
  return null;
}

/** The calls the schedules carry, built from the API type: a renamed job fails to compile, and defuss-rpc owns the
 * wire format. Why a map and not `Jobs[methodName]()`: TypeScript cannot call a union of generic builders. */
const jobs = rpcCalls<Api>().Jobs;
const JOB_CALLS = { dueDigest: () => jobs.dueDigest(), cycleRollover: () => jobs.cycleRollover() };

/** Creates each job's schedule, or updates one whose cron, time zone or callback differ, such as the app's URL after
 * a restart on another port. A paused schedule stays paused. Returns what happened to each job. VERIFIED:
 * defuss-scheduler keeps the ID of a removed or terminated schedule reserved, so after an agent removed or terminated
 * one, the job gets a successor under a fresh ID; tests/jobs.test.ts covers it. Why find it by `ref` rather than
 * store the ID: the app keeps no state of its own, and an agent sees which job a schedule belongs to. */
export async function upsertSchedules(queue: Queue, rpcUrl: string, timeZone: string, list: JobSchedule[]) {
  const outcome: Record<string, "created" | "updated" | "unchanged"> = {};
  for (const { id, cron, methodName } of list) {
    const payload = { url: rpcUrl, ...JOB_CALLS[methodName]() };
    const first = await queue.get(id);
    const current = await liveSchedule(queue, id, first);
    if (!current) {
      const fresh = first ? id + "-" + crypto.randomUUID() : id;
      await queue.create({ id: fresh, ref: id, cron, timezone: timeZone, handler: "_rpc", payload }, { requestId: crypto.randomUUID() });
      outcome[id] = "created";
    } else if (
      current.cron !== cron ||
      current.timezone !== timeZone ||
      JSON.stringify(current.payload) !== JSON.stringify(payload)
    ) {
      await queue.update(
        current.id,
        { cron, timezone: timeZone, payload },
        { revision: current.revision, requestId: crypto.randomUUID() },
      );
      outcome[id] = "updated";
    } else outcome[id] = "unchanged";
  }
  return outcome;
}

/** Lets the backplane's callbacks, and only them, call `Jobs`, and everything else only a signed-in call. A callback
 * carries `X-Backplane-Callback`, a token that `callbacks.verify` accepts for this app's workspace while the call runs.
 * Why the token and not a key: the daemon sends no key to apps, and the app's own bot key stays with the app. */
export function jobsGuard(ws: Workspace, workspace: string) {
  return async (namespace: string, _method: string, _args: unknown[], request?: Request) => {
    if (namespace !== "Jobs") return currentViewer() !== undefined;
    if (currentViewer()) return false;
    try {
      const call = await ws.members.verifyCallback(request?.headers.get("x-backplane-callback") ?? "");
      return call.app === APP && call.tenant === workspace;
    } catch {
      return false;
    }
  };
}

export function createJobs(ws: Workspace) {
  return {
    /** Inbox items for open, assigned issues due today or overdue. A repeated call on the same day adds nothing. */
    async dueDigest() {
      const today = ws.today();
      const items: Notification[] = dueDigest(await ws.issues.list(), today).map((item) => ({
        id: item.id,
        person: item.person,
        kind: item.overdue ? "overdue" : "due",
        issue: item.issue,
        actor: null,
        detail: item.due,
        read: false,
        at: new Date().toISOString(),
      }));
      const added = await ws.inbox.add(items);
      ws.log.info("due digest", { date: today, items: items.length, added });
      return { date: today, items: items.length, added };
    },
    /** Closes each ended cycle of the team, carries its open issues into the next one and opens that cycle when it is
     * missing. The carry runs before the close, so a call that stops halfway is completed by the next one. */
    async cycleRollover(team = "ENG") {
      const closed: string[] = [];
      const opened: string[] = [];
      for (let round = 0; round < MAX_ROLLOVERS; round++) {
        const plan = planRollover(await ws.cycles.list(), await ws.issues.byCycle(await ended(ws, team)), team, ws.today());
        if (!plan) break;
        if (plan.create && (await ws.cycles.create(plan.next))) opened.push(plan.next.id);
        for (const issue of plan.carry) await ws.issues.update(issue, { cycle: plan.next.id }, SYSTEM);
        await ws.cycles.close(plan.close);
        closed.push(plan.close);
      }
      ws.log.info("cycle rollover", { team, closed: closed.join(",") || "-", opened: opened.join(",") || "-" });
      return { closed, opened };
    },
  };
}

/** The ID of the oldest ended, open cycle of the team, whose issues the plan needs; "" when there is none. */
async function ended(ws: Workspace, team: string) {
  const today = ws.today();
  const cycle = (await ws.cycles.list()).find((c) => c.team === team && !c.closed && c.end < today);
  return cycle?.id ?? "";
}
