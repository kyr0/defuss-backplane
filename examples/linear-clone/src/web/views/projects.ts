/** VERIFIED: scripts/e2e.ts drives it in Chromium, Firefox and WebKit. The projects table: health, lead and target from the project, issue count and progress from the store. */
import { clone, fillAvatar, shortDate } from "../dom.ts";
import { person, store } from "../store.ts";

const HEALTH = { on: "On track", risk: "At risk", off: "Off track", done: "Completed" } as const;

export function renderProjects(app: HTMLElement) {
  const issues = [...store.issues.values()];
  app.querySelector("#projects tbody")?.replaceChildren(
    ...store.boot.projects.map((project) => {
      const row = clone("pm-tpl-project");
      const own = issues.filter((i) => i.project === project.id);
      const pct = own.length ? Math.round((own.filter((i) => i.status === "done").length / own.length) * 100) : 0;
      const name = row.querySelector(".pm-proj")!;
      name.innerHTML = `<i data-lucide="${project.icon}"></i>`;
      name.append(project.name);
      const badge = row.querySelector<HTMLElement>(".pm-health")!;
      badge.dataset.health = project.health;
      badge.innerHTML = '<span class="pm-dot"></span>';
      badge.append(HEALTH[project.health]);
      const lead = row.querySelector(".pm-lead")!;
      fillAvatar(lead.querySelector(".avatar")!, project.lead);
      lead.lastChild!.textContent = person(project.lead)?.name ?? "—";
      const cells = row.querySelectorAll("td.pm-muted");
      cells[0]!.textContent = shortDate(project.target);
      cells[1]!.textContent = String(own.length);
      const bar = row.querySelector("progress")!;
      bar.value = pct;
      bar.setAttribute("aria-label", `${project.name}: ${pct}%`);
      row.querySelector(".pm-progress small")!.textContent = pct + "%";
      return row;
    }),
  );
}
