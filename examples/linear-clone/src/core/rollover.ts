/** VERIFIED: the weekly cycle rollover closes the oldest ended, open cycle of a team, carries its open issues into the next
 * cycle, and opens that cycle when it does not exist yet. One plan acts on one cycle ID, so a repeated delivery finds the cycle
 * closed and plans nothing; a service that was down for weeks catches up one cycle per plan. */
import { addDays, daysBetween } from "./dates.ts";
import type { Issue } from "./issue.ts";
import type { Cycle } from "./stats.ts";

/** A cycle's document ID, as `eng-25`: unique across teams, and a valid issue reference. */
export const cycleId = (team: string, number: number) => team.toLowerCase() + "-" + number;

export type Rollover = { close: string; next: Cycle; create: boolean; carry: string[] };

export function planRollover(cycles: readonly Cycle[], issues: readonly Issue[], team: string, today: string): Rollover | null {
  const own = cycles.filter((cycle) => cycle.team === team);
  const ended = own.filter((cycle) => !cycle.closed && cycle.end < today).sort((a, b) => a.number - b.number)[0];
  if (!ended) return null;
  const existing = own.find((cycle) => cycle.number === ended.number + 1);
  const start = addDays(ended.end, 1);
  const next = existing ?? {
    id: cycleId(team, ended.number + 1),
    team,
    number: ended.number + 1,
    start,
    end: addDays(start, daysBetween(ended.start, ended.end)),
    closed: false,
  };
  const carry = issues.filter((issue) => issue.cycle === ended.id && issue.status !== "done").map((issue) => issue.id);
  return { close: ended.id, next, create: !existing, carry };
}
