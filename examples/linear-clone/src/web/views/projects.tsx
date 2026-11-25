/** VERIFIED: scripts/e2e.ts reads the projects table. The projects table as a `reactive()` region: health, lead and
 * target from the project, issue count and progress from the store's issues. */
import { reactive } from "defuss-morph";
import type { Project } from "../../core/model.ts";
import { shortDate } from "../format.ts";
import { Icon } from "../icons.tsx";
import { appStore, person, store } from "../store.ts";
import { Avatar } from "./parts.tsx";

const HEALTH = { on: "On track", risk: "At risk", off: "Off track", done: "Completed" } as const;

export function ProjectRow({ project }: { project: Project }) {
  const own = [...store.issues.values()].filter((i) => i.project === project.id);
  const pct = own.length ? Math.round((own.filter((i) => i.status === "done").length / own.length) * 100) : 0;
  return (
    <tr key={project.id} class="table-row">
      <th class="table-cell" scope="row">
        <span class="pm-proj">
          <Icon name={project.icon} />
          {project.name}
        </span>
      </th>
      <td class="table-cell">
        <span class="badge pm-health" data-variant="outline" data-health={project.health}>
          <span class="pm-dot"></span>
          {HEALTH[project.health]}
        </span>
      </td>
      <td class="table-cell">
        <span class="pm-lead">
          <Avatar who={project.lead} />
          {person(project.lead)?.name ?? "—"}
        </span>
      </td>
      <td class="table-cell pm-muted">{shortDate(project.target)}</td>
      <td class="table-cell pm-muted">{String(own.length)}</td>
      <td class="table-cell">
        <span class="pm-progress">
          <progress class="progress" max="100" value={pct} aria-label={`${project.name}: ${pct}%`}></progress>
          <small>{pct + "%"}</small>
        </span>
      </td>
    </tr>
  );
}

export function bindProjects(app: HTMLElement) {
  const body = app.querySelector("#projects tbody");
  if (body) reactive({ store: appStore, render: () => store.boot.projects.map((project) => <ProjectRow project={project} />) }, body);
}
