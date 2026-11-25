/** VERIFIED: calendar dates as `YYYY-MM-DD` strings. Why strings rather than `Date`: a due date or a cycle day has no time of day,
 * and a `Date` at local midnight moves to the previous day in a time zone west of UTC. */

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in `YYYY-MM-DD` form; `2026-02-30` is not one. */
export function isDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const epochDay = (date: string) => Date.parse(date + "T00:00:00Z") / DAY_MS;

export function addDays(date: string, days: number) {
  return new Date((epochDay(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** Days from `from` to `to`: 1 for consecutive days, negative when `to` comes first. */
export function daysBetween(from: string, to: string) {
  return epochDay(to) - epochDay(from);
}

/** The calendar date of an instant in an IANA time zone. An unknown zone throws a RangeError. */
export function localDate(instant: Date, timeZone: string) {
  // VERIFIED: the en-CA locale formats a date as YYYY-MM-DD (tests/core.test.ts).
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}
