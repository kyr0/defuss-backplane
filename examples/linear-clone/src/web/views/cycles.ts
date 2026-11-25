/** VERIFIED: scripts/e2e.ts drives it in Chromium, Firefox and WebKit. The running cycle: its numbers, the burn-up chart and progress per assignee. The browser computes them with the
 * core's `cycleStats`, the function whose results the server caches, so both show the same numbers. */
import { currentCycle, cycleStats, type CycleStats } from "../../core/stats.ts";
import { clone, fillAvatar, shortDate } from "../dom.ts";
import { person, store } from "../store.ts";

const SVG = "http://www.w3.org/2000/svg";
/** VERIFIED: the scaffold's chart geometry: a 920 by 196 view box, the plot from x 40 to 900 and y 170 to 20. */
const LEFT = 40;
const RIGHT = 900;
const BOTTOM = 170;
const TOP = 20;

function el(name: string, attrs: Record<string, string | number>, text?: string) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Draws the scaffold's burn-up: grid, scope, started and done, the target line and today. */
export function drawBurnup(svg: SVGSVGElement, stats: CycleStats, start: string) {
  const max = Math.max(4, Math.ceil(stats.scope / 4) * 4);
  const x = (day: number) => LEFT + ((RIGHT - LEFT) * day) / Math.max(1, stats.days - 1);
  const y = (value: number) => BOTTOM - ((BOTTOM - TOP) * value) / max;
  const nodes: Element[] = [];
  for (let i = 0; i <= 4; i++) {
    const value = (max / 4) * i;
    nodes.push(el("line", { x1: LEFT, x2: RIGHT, y1: y(value), y2: y(value), class: "pm-grid" }));
    nodes.push(el("text", { x: 30, y: y(value) + 4, "text-anchor": "end" }, String(value)));
  }
  const dayLabel = (day: number) => {
    const date = new Date(Date.parse(start + "T00:00:00Z") + day * 86_400_000).toISOString().slice(0, 10);
    return el("text", { x: x(day), y: 192, "text-anchor": "middle" }, shortDate(date));
  };
  for (const day of new Set([0, Math.round((stats.days - 1) / 3), Math.round(((stats.days - 1) * 2) / 3), stats.days - 1]))
    nodes.push(dayLabel(day));
  nodes.push(el("line", { x1: LEFT, y1: BOTTOM, x2: RIGHT, y2: y(stats.scope), class: "pm-target" }));
  const points = (key: "scope" | "started" | "done") => stats.burnup.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  if (stats.burnup.length) {
    const lastX = x(stats.burnup.length - 1);
    nodes.push(el("polyline", { points: points("scope"), class: "pm-scope" }));
    nodes.push(el("polygon", { points: `${LEFT},${BOTTOM} ${points("started")} ${lastX},${BOTTOM}`, class: "pm-started-area" }));
    nodes.push(el("polyline", { points: points("started"), class: "pm-started" }));
    nodes.push(el("polygon", { points: `${LEFT},${BOTTOM} ${points("done")} ${lastX},${BOTTOM}`, class: "pm-done-area" }));
    nodes.push(el("polyline", { points: points("done"), class: "pm-done" }));
    if (stats.daysLeft > 0) {
      nodes.push(el("line", { x1: lastX, x2: lastX, y1: 14, y2: BOTTOM, class: "pm-today" }));
      nodes.push(el("text", { x: lastX + 6, y: 24, class: "pm-today-label" }, "Today"));
    }
  }
  svg.replaceChildren(...nodes);
  const day = stats.days - stats.daysLeft + (stats.daysLeft > 0 ? 1 : 0);
  svg.setAttribute(
    "aria-label",
    `Burn-up: scope ${stats.scope} issues, ${stats.started} started, ${stats.done} completed on day ${day} of ${stats.days}`,
  );
}

export function renderCycles(app: HTMLElement) {
  const { boot } = store;
  const cycle = currentCycle(boot.cycles, boot.today);
  const set = (key: string, text: string) =>
    app.querySelectorAll(`[data-pm-stat="${key}"]`).forEach((e) => (e.textContent = text));
  if (!cycle) {
    set("title", "No cycle");
    return;
  }
  const stats = cycleStats(cycle, [...store.issues.values()], boot.today, boot.timeZone);
  set("title", "Cycle " + cycle.number);
  set("dates", shortDate(cycle.start) + " – " + shortDate(cycle.end));
  set("scope", String(stats.scope));
  set("started", String(stats.started));
  set("done", String(stats.done));
  set("started-pct", stats.startedPct + "%");
  set("done-pct", stats.donePct + "%");
  set("days-left", String(stats.daysLeft));
  set("days", "of " + stats.days);
  const ring = app.querySelector<HTMLElement>('[data-pm-stat="ring"]');
  if (ring) {
    ring.setAttribute("aria-valuenow", String(stats.donePct));
    ring.style.setProperty("--value", String(stats.donePct));
    ring.textContent = stats.donePct + "%";
  }
  renderOtherCycles(app, cycle.id);
  const svg = app.querySelector<SVGSVGElement>("svg.pm-burnup");
  if (svg) drawBurnup(svg, stats, cycle.start);
  app.querySelector("[data-pm-people]")?.replaceChildren(
    ...stats.people.map((entry) => {
      const li = clone("pm-tpl-person");
      const name = person(entry.person)?.name ?? entry.person;
      li.dataset.person = entry.person;
      fillAvatar(li.querySelector(".avatar")!, entry.person);
      li.querySelector("span:not(.avatar):not(.avatar-fallback)")!.textContent = name;
      const bar = li.querySelector("progress")!;
      bar.max = Math.max(entry.total, 1);
      bar.value = entry.done;
      bar.setAttribute("aria-label", `${name}: ${entry.done} of ${entry.total} done`);
      li.querySelector("small")!.textContent = entry.done + "/" + entry.total;
      return li;
    }),
  );
}

/** The team's other cycles, newest first: upcoming ones with their planned issues, past ones with their completion. */
function renderOtherCycles(app: HTMLElement, currentId: string) {
  const issues = [...store.issues.values()];
  const others = store.boot.cycles.filter((c) => c.id !== currentId).sort((a, b) => b.number - a.number);
  app.querySelector("[data-pm-cycles]")?.replaceChildren(
    ...others.map((cycle) => {
      const own = issues.filter((i) => i.cycle === cycle.id);
      const done = own.filter((i) => i.status === "done").length;
      const upcoming = cycle.start > store.boot.today;
      const li = document.createElement("li");
      li.innerHTML =
        '<span class="pm-status" aria-hidden="true"></span><span><strong></strong><small></small></span><span class="badge"></span>';
      li.querySelector<HTMLElement>(".pm-status")!.dataset.status = upcoming ? "todo" : "done";
      li.querySelector("strong")!.textContent = "Cycle " + cycle.number;
      const range = shortDate(cycle.start) + " – " + shortDate(cycle.end);
      li.querySelector("small")!.textContent = upcoming
        ? `${range} · ${own.length} issues planned`
        : `${range} · ${done} of ${own.length} completed`;
      const badge = li.querySelector<HTMLElement>(".badge")!;
      badge.dataset.variant = upcoming ? "outline" : "secondary";
      badge.textContent = upcoming ? "Upcoming" : (own.length ? Math.round((done / own.length) * 100) : 0) + "%";
      return li;
    }),
  );
}
