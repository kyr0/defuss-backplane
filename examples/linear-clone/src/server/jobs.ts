/** VERIFIED: tests/jobs.test.ts against a real daemon. The app runs no timer of its own: the backplane's scheduler calls
 * `Jobs.dueDigest` and `Jobs.cycleRollover` over RPC (handler `_rpc`), with the bot key. Why the backplane's scheduler:
 * schedules, retries and run history survive the app's restarts, and agents can inspect them over MCP. */
import { timingSafeEqual } from "node:crypto";
import { dueDigest } from "../core/digest.ts";
import type { Notification } from "../core/model.ts";
import { planRollover } from "../core/rollover.ts";
import type { Workspace } from "./workspace.ts";

/** The actor of changes the jobs make. */
export const SYSTEM = "system";
/** A team behind by many cycles catches up one cycle per plan; this bounds one call. */
const MAX_ROLLOVERS = 52;

export type JobSchedule = { id: string; cron: string; methodName: "dueDigest" | "cycleRollover" };

/** The two schedules, at the configured times. */
export const schedules = (crons: { digestCron: string; rolloverCron: string }): JobSchedule[] => [
  { id: "due-digest", cron: crons.digestCron, methodName: "dueDigest" },
  { id: "cycle-rollover", cron: crons.rolloverCron, methodName: "cycleRollover" },
];

/** Creates each schedule, or updates one whose cron, time zone or callback differ, such as the app's URL after a
 * restart on another port. Returns what happened to each. */
export async function upsertSchedules(queue: Workspace["scheduler"], rpcUrl: string, timeZone: string, list: JobSchedule[]) {
  const outcome: Record<string, "created" | "updated" | "unchanged"> = {};
  for (const { id, cron, methodName } of list) {
    const payload = { url: rpcUrl, className: "Jobs", methodName, args: [] };
    const current = await queue.get(id);
    if (!current || current.state === "removed" || current.state === "terminated") {
      await queue.create({ id, cron, timezone: timeZone, handler: "_rpc", payload }, { requestId: crypto.randomUUID() });
      outcome[id] = "created";
    } else if (
      current.cron !== cron ||
      current.timezone !== timeZone ||
      JSON.stringify(current.payload) !== JSON.stringify(payload)
    ) {
      await queue.update(
        id,
        { cron, timezone: timeZone, payload },
        { revision: current.revision, requestId: crypto.randomUUID() },
      );
      outcome[id] = "updated";
    } else outcome[id] = "unchanged";
  }
  return outcome;
}

/** A guard that admits a `Jobs` call only with the bot key, compared in constant time. */
export function jobsGuard(apiKey: string) {
  const expected = Buffer.from("Bearer " + apiKey);
  return (namespace: string, _method: string, _args: unknown[], request?: Request) => {
    if (namespace !== "Jobs") return true;
    const given = Buffer.from(request?.headers.get("authorization") ?? "");
    return given.length === expected.length && timingSafeEqual(given, expected);
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
