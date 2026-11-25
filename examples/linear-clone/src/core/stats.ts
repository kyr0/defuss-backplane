/** VERIFIED: a cycle's numbers as the scaffold's cycles view computes them. The server computes them for the cache, and the browser recomputes
 * them after a change of its own, from the same function. */
import { addDays, daysBetween, localDate } from "./dates.ts";
import { type Issue, isStarted } from "./issue.ts";

/** A team's time box. `start` and `end` are inclusive calendar dates. */
export type Cycle = { id: string; team: string; number: number; start: string; end: string; closed: boolean };

export type CycleStats = {
  scope: number;
  /** VERIFIED: the scaffold counts `progress`, `review` and `done` as started. */
  started: number;
  done: number;
  startedPct: number;
  donePct: number;
  days: number;
  daysLeft: number;
  /** Per assignee, sorted by person ID; unassigned issues count only in the totals. */
  people: { person: string; done: number; total: number }[];
  /** One point per day from the start to today or the end. An issue joins the scope on the day it was created, or on
   * the first day when it is older, and counts as started and done from the days it was started and completed. */
  burnup: { date: string; scope: number; started: number; done: number }[];
};

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

export function cycleStats(cycle: Cycle, all: readonly Issue[], today: string, timeZone: string): CycleStats {
  const issues = all.filter((issue) => issue.cycle === cycle.id);
  const done = issues.filter((issue) => issue.status === "done").length;
  const started = issues.filter((issue) => isStarted(issue.status)).length;
  const days = daysBetween(cycle.start, cycle.end) + 1;
  const daysLeft =
    today < cycle.start ? days : today > cycle.end ? 0 : daysBetween(today, cycle.end) + 1;
  const people = new Map<string, { person: string; done: number; total: number }>();
  for (const issue of issues) {
    if (!issue.assignee) continue;
    const entry = people.get(issue.assignee) ?? { person: issue.assignee, done: 0, total: 0 };
    entry.total++;
    if (issue.status === "done") entry.done++;
    people.set(issue.assignee, entry);
  }
  const day = (instant: string) => localDate(new Date(instant), timeZone);
  const created = issues.map((issue) => day(issue.createdAt));
  const completed = issues.map((issue) => (issue.status === "done" && issue.completedAt ? day(issue.completedAt) : null));
  const begun = issues.map((issue) => (isStarted(issue.status) && issue.startedAt ? day(issue.startedAt) : null));
  const upTo = (days: (string | null)[], date: string) => days.filter((d) => d !== null && d <= date).length;
  const burnup: CycleStats["burnup"] = [];
  const last = today < cycle.end ? today : cycle.end;
  for (let date = cycle.start; date <= last; date = addDays(date, 1))
    burnup.push({
      date,
      scope: created.filter((c) => c <= date).length,
      started: upTo(begun, date),
      done: upTo(completed, date),
    });
  return {
    scope: issues.length,
    started,
    done,
    startedPct: pct(started, issues.length),
    donePct: pct(done, issues.length),
    days,
    daysLeft,
    people: [...people.values()].sort((a, b) => (a.person < b.person ? -1 : a.person > b.person ? 1 : 0)),
    burnup,
  };
}

/** The cycle that contains today, else the most recent one that started. */
export function currentCycle(cycles: readonly Cycle[], today: string) {
  return (
    cycles.find((c) => c.start <= today && today <= c.end) ??
    cycles.filter((c) => c.start <= today).sort((a, b) => b.number - a.number)[0] ??
    null
  );
}
