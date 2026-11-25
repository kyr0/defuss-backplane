/** VERIFIED: scripts/e2e.ts checks the cycle's done count after edits. The running cycle: its numbers, the burn-up
 * chart, progress per assignee and the other cycles, each a `reactive()` region. The browser computes the numbers
 * with the core's `cycleStats`, the function whose results the server caches, so both show the same. */
import { reactive } from "defuss-morph";
import df$ from "defuss-query";
import { type Cycle, currentCycle, cycleStats, type CycleStats } from "../../core/stats.ts";
import { shortDate } from "../format.ts";
import { appStore, person, store } from "../store.ts";
import { Avatar } from "./parts.tsx";

/** VERIFIED: the scaffold's chart geometry: a 920 by 196 view box, the plot from x 40 to 900 and y 170 to 20. */
const LEFT = 40;
const RIGHT = 900;
const BOTTOM = 170;
const TOP = 20;

/** The scaffold's burn-up: grid, scope, started and done, the target line and today. */
export function Burnup({ stats, start }: { stats: CycleStats; start: string }) {
  const max = Math.max(4, Math.ceil(stats.scope / 4) * 4);
  const x = (day: number) => LEFT + ((RIGHT - LEFT) * day) / Math.max(1, stats.days - 1);
  const y = (value: number) => BOTTOM - ((BOTTOM - TOP) * value) / max;
  const points = (key: "scope" | "started" | "done") => stats.burnup.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const lastX = x(stats.burnup.length - 1);
  const dayLabel = (day: number) => shortDate(new Date(Date.parse(start + "T00:00:00Z") + day * 86_400_000).toISOString().slice(0, 10));
  const ticks = [...new Set([0, Math.round((stats.days - 1) / 3), Math.round(((stats.days - 1) * 2) / 3), stats.days - 1])];
  return [
    ...[0, 1, 2, 3, 4].map((i) => {
      const value = (max / 4) * i;
      return [
        <line key={"g" + i} x1={LEFT} x2={RIGHT} y1={y(value)} y2={y(value)} class="pm-grid" />,
        <text key={"v" + i} x="30" y={y(value) + 4} text-anchor="end">
          {String(value)}
        </text>,
      ];
    }),
    ...ticks.map((day) => (
      <text key={"d" + day} x={x(day)} y="192" text-anchor="middle">
        {dayLabel(day)}
      </text>
    )),
    <line key="target" x1={LEFT} y1={BOTTOM} x2={RIGHT} y2={y(stats.scope)} class="pm-target" />,
    ...(stats.burnup.length
      ? [
          <polyline key="scope" points={points("scope")} class="pm-scope" />,
          <polygon key="started-area" points={`${LEFT},${BOTTOM} ${points("started")} ${lastX},${BOTTOM}`} class="pm-started-area" />,
          <polyline key="started" points={points("started")} class="pm-started" />,
          <polygon key="done-area" points={`${LEFT},${BOTTOM} ${points("done")} ${lastX},${BOTTOM}`} class="pm-done-area" />,
          <polyline key="done" points={points("done")} class="pm-done" />,
          ...(stats.daysLeft > 0
            ? [
                <line key="today" x1={lastX} x2={lastX} y1="14" y2={BOTTOM} class="pm-today" />,
                <text key="today-label" x={lastX + 6} y="24" class="pm-today-label">
                  Today
                </text>,
              ]
            : []),
        ]
      : []),
  ];
}

/** The team's other cycles, newest first: upcoming ones with their planned issues, past ones with their completion. */
function OtherCycle({ cycle }: { cycle: Cycle }) {
  const own = [...store.issues.values()].filter((i) => i.cycle === cycle.id);
  const done = own.filter((i) => i.status === "done").length;
  const upcoming = cycle.start > store.boot.today;
  const range = shortDate(cycle.start) + " – " + shortDate(cycle.end);
  return (
    <li key={cycle.id}>
      <span class="pm-status" data-status={upcoming ? "todo" : "done"} aria-hidden="true"></span>
      <span>
        <strong>{"Cycle " + cycle.number}</strong>
        <small>{upcoming ? `${range} · ${own.length} issues planned` : `${range} · ${done} of ${own.length} completed`}</small>
      </span>
      <span class="badge" data-variant={upcoming ? "outline" : "secondary"}>
        {upcoming ? "Upcoming" : (own.length ? Math.round((done / own.length) * 100) : 0) + "%"}
      </span>
    </li>
  );
}

const current = () => currentCycle(store.boot.cycles, store.boot.today);
const statsOf = (cycle: Cycle) => cycleStats(cycle, [...store.issues.values()], store.boot.today, store.boot.timeZone);

export function bindCycles(app: HTMLElement) {
  const text: Record<string, (cycle: Cycle, stats: CycleStats) => string> = {
    title: (c) => "Cycle " + c.number,
    dates: (c) => shortDate(c.start) + " – " + shortDate(c.end),
    scope: (_c, s) => String(s.scope),
    started: (_c, s) => String(s.started),
    done: (_c, s) => String(s.done),
    "started-pct": (_c, s) => s.startedPct + "%",
    "done-pct": (_c, s) => s.donePct + "%",
    "days-left": (_c, s) => String(s.daysLeft),
    days: (_c, s) => "of " + s.days,
  };
  for (const [key, of] of Object.entries(text)) {
    const render = () => {
      const cycle = current();
      return cycle ? of(cycle, statsOf(cycle)) : key === "title" ? "No cycle" : "—";
    };
    reactive({ store: appStore, render }, app.querySelectorAll(`[data-pm-stat="${key}"]`));
  }
  const ring = app.querySelector<HTMLElement>('[data-pm-stat="ring"]');
  if (ring)
    reactive(
      {
        store: appStore,
        render: () => {
          const cycle = current();
          const pct = cycle ? statsOf(cycle).donePct : 0;
          df$(ring).attr("aria-valuenow", String(pct)).css("--value", String(pct));
          return pct + "%";
        },
      },
      ring,
    );
  const svg = app.querySelector<SVGSVGElement>("svg.pm-burnup");
  if (svg)
    reactive(
      {
        store: appStore,
        render: () => {
          const cycle = current();
          if (!cycle) return [];
          const stats = statsOf(cycle);
          const day = stats.days - stats.daysLeft + (stats.daysLeft > 0 ? 1 : 0);
          df$(svg).attr("aria-label", `Burn-up: scope ${stats.scope} issues, ${stats.started} started, ${stats.done} completed on day ${day} of ${stats.days}`);
          return <Burnup stats={stats} start={cycle.start} />;
        },
      },
      svg,
    );
  const people = app.querySelector("[data-pm-people]");
  if (people)
    reactive(
      {
        store: appStore,
        render: () => {
          const cycle = current();
          return (cycle ? statsOf(cycle).people : []).map((entry) => {
            const name = person(entry.person)?.name ?? entry.person;
            return (
              <li key={entry.person} data-person={entry.person}>
                <Avatar who={entry.person} />
                <span>{name}</span>
                <progress class="progress" max={Math.max(entry.total, 1)} value={entry.done} aria-label={`${name}: ${entry.done} of ${entry.total} done`}></progress>
                <small>{entry.done + "/" + entry.total}</small>
              </li>
            );
          });
        },
      },
      people,
    );
  const others = app.querySelector("[data-pm-cycles]");
  if (others)
    reactive(
      {
        store: appStore,
        render: () =>
          store.boot.cycles
            .filter((c) => c.id !== current()?.id)
            .sort((a, b) => b.number - a.number)
            .map((cycle) => <OtherCycle cycle={cycle} />),
      },
      others,
    );
}
