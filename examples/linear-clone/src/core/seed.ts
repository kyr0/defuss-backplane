/** VERIFIED: the demo workspace of `input/seed.json`, extracted from the defuss-shadcn issue tracker scaffold, whose
 * cycles view shows 9 of 14 days left in Cycle 24 (Sep 28 to Oct 11), so the seed is written for `today` 2026-10-03. Why shift it:
 * seeded on another day, the cycle would have ended and the due dates would be months old; shifted, the demo shows a
 * running cycle on every first start. */
import { addDays, isDate } from "./dates.ts";
import type { Issue } from "./issue.ts";
import type { Comment, IssueEvent, Notification, Person, Project, Team } from "./model.ts";
import type { Cycle } from "./stats.ts";

export type Seed = {
  today: string;
  people: Person[];
  teams: Team[];
  projects: Project[];
  cycles: Cycle[];
  issues: Issue[];
  comments: Comment[];
  events: IssueEvent[];
  notifications: Notification[];
};

const DAY_MS = 86_400_000;
const instant = (value: string, ms: number) => new Date(Date.parse(value) + ms).toISOString();
const date = (value: string | null, days: number) => (value === null ? null : addDays(value, days));

/** The seed with every date moved by `days` and every instant by `ms`, by default the same days. */
export function shiftSeed(seed: Seed, days: number, ms = days * DAY_MS): Seed {
  if (!isDate(seed.today)) throw new TypeError("seed.today must be a date YYYY-MM-DD");
  return {
    ...seed,
    today: addDays(seed.today, days),
    projects: seed.projects.map((p) => ({ ...p, target: date(p.target, days) })),
    cycles: seed.cycles.map((c) => ({ ...c, start: addDays(c.start, days), end: addDays(c.end, days) })),
    issues: seed.issues.map((i) => ({
      ...i,
      due: date(i.due, days),
      createdAt: instant(i.createdAt, ms),
      updatedAt: instant(i.updatedAt, ms),
      startedAt: i.startedAt === null ? null : instant(i.startedAt, ms),
      completedAt: i.completedAt === null ? null : instant(i.completedAt, ms),
    })),
    comments: seed.comments.map((c) => ({ ...c, createdAt: instant(c.createdAt, ms) })),
    events: seed.events.map((e) => ({ ...e, at: instant(e.at, ms) })),
    notifications: seed.notifications.map((n) => ({ ...n, at: instant(n.at, ms) })),
  };
}

