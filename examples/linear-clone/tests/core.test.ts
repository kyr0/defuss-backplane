import { describe, expect, test } from "bun:test";
import { addDays, daysBetween, isDate, localDate } from "../src/core/dates.ts";
import { dueDigest } from "../src/core/digest.ts";
import { issueId, parseIssueId } from "../src/core/ids.ts";
import {
  applyPatch,
  compareIssues,
  InvalidInput,
  type Issue,
  LIMITS,
  validateComment,
  validateDraft,
  validateFileName,
  validatePatch,
} from "../src/core/issue.ts";
import { type Seed, shiftSeed } from "../src/core/seed.ts";
import { cycleId, planRollover } from "../src/core/rollover.ts";
import { type Cycle, cycleStats } from "../src/core/stats.ts";

const issue = (over: Partial<Issue> & { number: number }): Issue => ({
  id: "ENG-" + over.number,
  team: "ENG",
  title: "Issue " + over.number,
  description: "",
  status: "todo",
  priority: "none",
  assignee: null,
  labels: [],
  project: null,
  cycle: "eng-24",
  due: null,
  subtasks: [],
  createdAt: "2026-09-20T08:00:00.000Z",
  updatedAt: "2026-09-20T08:00:00.000Z",
  startedAt: null,
  completedAt: null,
  ...over,
});
// VERIFIED: the scaffold's Cycle 24 runs from Sep 28 to Oct 11, 14 days.
const cycle24: Cycle = { id: "eng-24", team: "ENG", number: 24, start: "2026-09-28", end: "2026-10-11", closed: false };

describe("dates", () => {
  test("only real calendar dates in YYYY-MM-DD form are dates", () => {
    expect(["2026-02-28", "2028-02-29"].every(isDate)).toBe(true);
    expect(["2026-02-29", "2026-13-01", "2026-1-01", "20260101", 20260101, null].some(isDate)).toBe(false);
  });

  test("day arithmetic crosses months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-09-28", "2026-10-11")).toBe(13);
    expect(daysBetween("2026-10-11", "2026-09-28")).toBe(-13);
  });

  test("an instant falls on the date of the given time zone", () => {
    const instant = new Date("2026-10-01T23:30:00Z");
    expect(localDate(instant, "UTC")).toBe("2026-10-01");
    expect(localDate(instant, "Europe/Berlin")).toBe("2026-10-02");
    expect(localDate(instant, "America/Los_Angeles")).toBe("2026-10-01");
    expect(() => localDate(instant, "Mars/Olympus")).toThrow(RangeError);
  });
});

describe("issue IDs", () => {
  test("an ID is the team key and the number, and parses back", () => {
    expect(issueId("ENG", 142)).toBe("ENG-142");
    expect(parseIssueId("ENG-142")).toEqual({ team: "ENG", number: 142 });
  });

  test("malformed keys, numbers and IDs are refused", () => {
    expect(() => issueId("eng", 1)).toThrow(TypeError);
    expect(() => issueId("E", 1)).toThrow(TypeError);
    expect(() => issueId("ENG", 0)).toThrow(TypeError);
    expect(() => issueId("ENG", 1.5)).toThrow(TypeError);
    for (const id of ["ENG-0", "ENG-01", "eng-1", "ENG_1", "ENG-", "ENG-99999999999999999", 7]) expect(parseIssueId(id)).toBeNull();
  });
});

describe("drafts and patches", () => {
  test("a draft needs a title; every other field takes the scaffold's create-dialog default", () => {
    expect(validateDraft({ title: "  Fix the filter  " })).toEqual({
      title: "Fix the filter",
      description: "",
      status: "todo",
      priority: "none",
      assignee: null,
      labels: [],
      project: null,
      cycle: null,
      due: null,
      subtasks: [],
    });
  });

  test("every field is checked and the error names it", () => {
    const cases: [unknown, string][] = [
      [{}, "title"],
      [{ title: "   " }, "title"],
      [{ title: "x".repeat(LIMITS.title + 1) }, "title"],
      [{ title: "t", description: "x".repeat(LIMITS.description + 1) }, "description"],
      [{ title: "t", status: "closed" }, "status"],
      [{ title: "t", priority: "p1" }, "priority"],
      [{ title: "t", assignee: "Aron Homberg" }, "assignee"],
      [{ title: "t", labels: ["bug", "bug"] }, "labels"],
      [{ title: "t", labels: ["chore"] }, "labels"],
      [{ title: "t", labels: "bug" }, "labels"],
      [{ title: "t", project: 5 }, "project"],
      [{ title: "t", due: "2026-02-30" }, "due"],
      [{ title: "t", subtasks: [{ title: "a" }] }, "subtasks"],
      [{ title: "t", subtasks: Array(LIMITS.subtasks + 1).fill({ title: "a", done: false }) }, "subtasks"],
      [{ title: "t", id: "ENG-1" }, "id"],
      [null, "input"],
      [["title"], "input"],
    ];
    for (const [input, field] of cases) {
      const error = (() => {
        try {
          validateDraft(input);
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(InvalidInput);
      expect((error as InvalidInput).field).toBe(field);
    }
  });

  test("a patch changes one or more fields and keeps nulls that clear a field", () => {
    expect(validatePatch({ status: "done", assignee: null, due: null })).toEqual({ status: "done", assignee: null, due: null });
    expect(() => validatePatch({})).toThrow(InvalidInput);
    expect(() => validatePatch({ number: 5 })).toThrow("number: is not an issue field");
  });

  test("applying a patch reports the changes, stamps the time and tracks completion", () => {
    const now = new Date("2026-10-02T10:00:00Z");
    const open = issue({ number: 1, status: "progress" });
    const { issue: closed, changes } = applyPatch(open, { status: "done", priority: "none" }, now);
    expect(changes).toEqual([{ field: "status", from: "progress", to: "done" }]);
    expect(closed).toMatchObject({ status: "done", completedAt: now.toISOString(), updatedAt: now.toISOString() });
    const reopened = applyPatch(closed, { status: "review" }, new Date("2026-10-03T10:00:00Z")).issue;
    expect(reopened.completedAt).toBeNull();
    // Started stays from the first start while the issue stays past todo, and clears on the way back.
    const begun = applyPatch(issue({ number: 2 }), { status: "progress" }, now).issue;
    expect(begun.startedAt).toBe(now.toISOString());
    expect(applyPatch(begun, { status: "review" }, new Date("2026-10-04T10:00:00Z")).issue.startedAt).toBe(now.toISOString());
    expect(applyPatch(begun, { status: "todo" }, now).issue.startedAt).toBeNull();
    // An unchanged value is no change and leaves the issue as it was.
    expect(applyPatch(open, { status: "progress", labels: [] }, now)).toEqual({ issue: open, changes: [] });
  });

  test("the list order is status rank, then priority rank, then newest first", () => {
    const list = [
      issue({ number: 1, status: "done", priority: "urgent" }),
      issue({ number: 2, status: "backlog", priority: "low" }),
      issue({ number: 3, status: "backlog", priority: "urgent" }),
      issue({ number: 4, status: "backlog", priority: "urgent" }),
      issue({ number: 5, status: "todo", priority: "none" }),
    ];
    expect(list.sort(compareIssues).map((i) => i.number)).toEqual([4, 3, 2, 5, 1]);
  });
});

describe("cycle statistics", () => {
  const issues = [
    issue({ number: 1, status: "done", assignee: "aron", startedAt: "2026-09-28T09:00:00Z", completedAt: "2026-09-29T09:00:00Z" }),
    issue({ number: 2, status: "review", assignee: "aron", startedAt: "2026-09-30T09:00:00Z" }),
    issue({ number: 3, status: "progress", assignee: "anna", createdAt: "2026-09-30T12:00:00Z" }),
    issue({ number: 4, status: "todo" }),
    issue({ number: 5, status: "backlog", assignee: "anna" }),
    issue({ number: 6, status: "done", cycle: "eng-23", completedAt: "2026-09-20T09:00:00Z" }),
  ];

  test("scope, started and completed count the cycle's issues as the scaffold does", () => {
    const stats = cycleStats(cycle24, issues, "2026-10-03", "UTC");
    expect(stats).toMatchObject({ scope: 5, started: 3, done: 1, startedPct: 60, donePct: 20, days: 14, daysLeft: 9 });
    expect(stats.people).toEqual([
      { person: "anna", done: 0, total: 2 },
      { person: "aron", done: 1, total: 2 },
    ]);
  });

  test("the burn-up has one point per day up to today, with scope by creation and done by completion", () => {
    const { burnup } = cycleStats(cycle24, issues, "2026-10-01", "UTC");
    expect(burnup.map((p) => p.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(burnup.map((p) => [p.scope, p.started, p.done])).toEqual([
      [4, 1, 0],
      [4, 1, 1],
      [5, 2, 1],
      [5, 2, 1],
    ]);
  });

  test("days left are all days before the start, none after the end, and the whole cycle is charted", () => {
    expect(cycleStats(cycle24, issues, "2026-09-01", "UTC")).toMatchObject({ daysLeft: 14, burnup: [] });
    const after = cycleStats(cycle24, issues, "2026-11-25", "UTC");
    expect(after.daysLeft).toBe(0);
    expect(after.burnup).toHaveLength(14);
  });

  test("an empty cycle has 0 % rather than NaN", () => {
    expect(cycleStats(cycle24, [], "2026-10-03", "UTC")).toMatchObject({ scope: 0, startedPct: 0, donePct: 0 });
  });
});

describe("due digest", () => {
  test("open, assigned issues due today or earlier get one item each, with an ID per day and issue", () => {
    const issues = [
      issue({ number: 1, assignee: "aron", due: "2026-10-02" }),
      issue({ number: 2, assignee: "anna", due: "2026-10-01" }),
      issue({ number: 3, assignee: "aron", due: "2026-10-03" }),
      issue({ number: 4, assignee: "aron", due: "2026-10-01", status: "done" }),
      issue({ number: 5, due: "2026-10-01" }),
      issue({ number: 6, assignee: "aron" }),
    ];
    expect(dueDigest(issues, "2026-10-02")).toEqual([
      { id: "digest:2026-10-02:ENG-1", issue: "ENG-1", person: "aron", due: "2026-10-02", overdue: false },
      { id: "digest:2026-10-02:ENG-2", issue: "ENG-2", person: "anna", due: "2026-10-01", overdue: true },
    ]);
  });
});

describe("cycle rollover", () => {
  const issues = [
    issue({ number: 1, status: "done" }),
    issue({ number: 2, status: "progress" }),
    issue({ number: 3, status: "backlog" }),
    issue({ number: 4, cycle: null }),
  ];

  test("nothing happens while the cycle runs, or for another team", () => {
    expect(planRollover([cycle24], issues, "ENG", "2026-10-11")).toBeNull();
    expect(planRollover([cycle24], issues, "OPS", "2026-10-12")).toBeNull();
  });

  test("an ended cycle closes, its open issues move, and a cycle of the same length opens", () => {
    expect(planRollover([cycle24], issues, "ENG", "2026-10-12")).toEqual({
      close: "eng-24",
      next: { id: "eng-25", team: "ENG", number: 25, start: "2026-10-12", end: "2026-10-25", closed: false },
      create: true,
      carry: ["ENG-2", "ENG-3"],
    });
  });

  test("an existing next cycle is reused, and after a long pause the oldest ended cycle goes first", () => {
    const cycle25: Cycle = { ...cycle24, id: cycleId("ENG", 25), number: 25, start: "2026-10-12", end: "2026-10-25" };
    const plan = planRollover([cycle25, cycle24], issues, "ENG", "2026-11-25");
    expect(plan).toMatchObject({ close: "eng-24", next: cycle25, create: false });
    // A repeated delivery finds the cycle closed.
    expect(planRollover([{ ...cycle24, closed: true }], issues, "ENG", "2026-10-12")).toBeNull();
  });
});

describe("comments, file names and the seed", () => {
  test("a comment is trimmed text of 1 to 5000 characters", () => {
    expect(validateComment("  ok  ")).toBe("ok");
    for (const bad of ["  ", "x".repeat(LIMITS.comment + 1), 5]) expect(() => validateComment(bad)).toThrow(InvalidInput);
  });

  test("a file name has no slash, backslash or control character and is not . or ..", () => {
    expect(validateFileName("Screen shot 2026.png")).toBe("Screen shot 2026.png");
    for (const bad of ["a/b", "a\\b", "line\nbreak", "ta\tb", ".", "..", "", "x".repeat(LIMITS.fileName + 1)])
      expect(() => validateFileName(bad)).toThrow(InvalidInput);
  });

  test("shifting the seed moves every date and instant by the same days", () => {
    const seed: Seed = {
      today: "2026-10-03",
      people: [],
      teams: [],
      projects: [{ id: "p", name: "P", icon: "box", health: "on", lead: null, target: "2026-10-20" }],
      cycles: [cycle24],
      issues: [issue({ number: 1, due: "2026-10-04", completedAt: "2026-10-01T10:00:00.000Z" })],
      comments: [{ id: "c", issue: "ENG-1", author: "aron", body: "b", createdAt: "2026-10-02T10:00:00.000Z" }],
      events: [{ id: "e", issue: "ENG-1", actor: "aron", kind: "created", at: "2026-09-30T10:00:00.000Z" }],
      notifications: [],
    };
    const later = shiftSeed(seed, 53);
    expect(later.today).toBe("2026-11-25");
    expect(later.cycles[0]).toMatchObject({ start: "2026-11-20", end: "2026-12-03" });
    expect(later.projects[0]!.target).toBe("2026-12-12");
    expect(later.issues[0]).toMatchObject({ due: "2026-11-26", completedAt: "2026-11-23T10:00:00.000Z" });
    expect(later.comments[0]!.createdAt).toBe("2026-11-24T10:00:00.000Z");
    expect(later.events[0]!.at).toBe("2026-11-22T10:00:00.000Z");
    expect(() => shiftSeed({ ...seed, today: "03.10.2026" }, 1)).toThrow(TypeError);
  });
});
