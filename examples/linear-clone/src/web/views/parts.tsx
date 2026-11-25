/** VERIFIED: scripts/e2e.ts renders them in every view. The small pieces the views share, in the scaffold's markup:
 * an avatar with initials, label badges and a project chip. */
import type { Label } from "../../core/issue.ts";
import { initials, LABEL_NAMES } from "../format.ts";
import { Icon } from "../icons.tsx";
import { person, store } from "../store.ts";

/** An avatar with the person's initials, or the scaffold's empty "Unassigned" avatar. */
export function Avatar({ who, class: cls = "pm-mini" }: { who: string | null; class?: string }) {
  const p = person(who);
  return p ? (
    <span class={"avatar " + cls} data-size="sm">
      <span class="avatar-fallback" title={p.name}>
        {initials(p.name)}
      </span>
    </span>
  ) : (
    <span class={"avatar " + cls} data-size="sm" data-none="">
      <span class="sr-only">Unassigned</span>
    </span>
  );
}

export const Labels = ({ labels }: { labels: readonly Label[] }) =>
  labels.map((label) => (
    <span key={label} class="badge pm-label" data-variant="outline" data-label={label}>
      <span class="pm-dot"></span>
      {LABEL_NAMES[label]}
    </span>
  ));

/** The project's icon and name; nothing when the issue has no project. */
export function ProjectChip({ project }: { project: string | null }) {
  const p = store.boot.projects.find((x) => x.id === project);
  return p ? [<Icon name={p.icon} />, p.name] : [];
}
