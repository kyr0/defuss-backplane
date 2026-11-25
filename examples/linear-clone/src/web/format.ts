/** VERIFIED: tests/format.test.ts checks initials, dates and relative times against the scaffold. Pure display helpers: names of
 * statuses, priorities and labels, initials, short dates, relative times and file sizes. Issues, statuses and times
 * stay English, as in the scaffold; defuss-i18n translates the shell. */
import type { Label, Priority, Status } from "../core/issue.ts";

export const STATUS_NAMES: Record<Status, string> = {
  backlog: "Backlog",
  todo: "Todo",
  progress: "In Progress",
  review: "In Review",
  done: "Done",
};
export const PRIORITY_NAMES: Record<Priority, string> = {
  none: "No priority",
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
};
export const LABEL_NAMES: Record<Label, string> = {
  bug: "Bug",
  feature: "Feature",
  improvement: "Improvement",
  design: "Design",
  performance: "Performance",
};

/** `Aron Homberg` → `AH`: the first letters of the first two words. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

/** `Oct 3` for 2026-10-03, without the viewer's time zone moving the day; `—` without a date. */
export const shortDate = (date: string | null) =>
  date ? new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—";

/** `12m`, `3h`, `2d`, `1w` before `now`, as the scaffold's inbox shows; `just now` under a minute. */
export function ago(instant: string, now = Date.now()) {
  const minutes = Math.floor((now - Date.parse(instant)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes + "m";
  if (minutes < 1440) return Math.floor(minutes / 60) + "h";
  if (minutes < 10_080) return Math.floor(minutes / 1440) + "d";
  return Math.floor(minutes / 10_080) + "w";
}

/** `840 kB`, `2.4 MB`: decimal units, one fraction digit. */
export const sizeOf = (bytes: number) =>
  new Intl.NumberFormat("en", { style: "unit", unit: bytes < 1e6 ? "kilobyte" : "megabyte", maximumFractionDigits: 1 }).format(
    bytes < 1e6 ? bytes / 1e3 : bytes / 1e6,
  );
