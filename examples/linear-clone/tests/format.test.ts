/** The display formats the scaffold shows: initials in avatars, short due dates, relative inbox times. */
import { describe, expect, test } from "bun:test";
import { ago, initials, shortDate } from "../src/web/format.ts";

describe("format", () => {
  test("initials take the first letters of the first two words", () => {
    // VERIFIED: the scaffold's avatars read AH, PN and MR.
    expect(initials("Aron Homberg")).toBe("AH");
    expect(initials("Priya  Natarajan")).toBe("PN");
    expect(initials("marco rossi extra")).toBe("MR");
  });

  test("short dates show month and day without the time zone moving the day", () => {
    // VERIFIED: the scaffold writes Oct 3 and Nov 26, and — for an issue without a due date.
    expect(shortDate("2026-10-03")).toBe("Oct 3");
    expect(shortDate("2026-11-26")).toBe("Nov 26");
    expect(shortDate(null)).toBe("—");
  });

  test("relative times step from minutes to hours, days and weeks", () => {
    // VERIFIED: the scaffold's inbox shows 12m, 17h and 3d.
    const now = Date.parse("2026-11-25T12:00:00Z");
    const before = (ms: number) => new Date(now - ms).toISOString();
    expect(ago(before(30_000), now)).toBe("just now");
    expect(ago(before(12 * 60_000), now)).toBe("12m");
    expect(ago(before(17 * 3_600_000), now)).toBe("17h");
    expect(ago(before(3 * 86_400_000), now)).toBe("3d");
    expect(ago(before(15 * 86_400_000), now)).toBe("2w");
  });
});
