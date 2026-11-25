/** VERIFIED: the daily due digest has one inbox item per open, assigned issue that is due today
 * or overdue, and the item ID holds the date and the issue. Why: the job inserts items by ID, so a repeated delivery of
 * the same day's job finds its items already there and adds nothing. */
import type { Issue } from "./issue.ts";

export type DigestItem = { id: string; issue: string; person: string; due: string; overdue: boolean };

export function dueDigest(issues: readonly Issue[], today: string): DigestItem[] {
  return issues
    .filter((issue) => issue.due !== null && issue.due <= today && issue.status !== "done" && issue.assignee)
    .map((issue) => ({
      id: "digest:" + today + ":" + issue.id,
      issue: issue.id,
      person: issue.assignee!,
      due: issue.due!,
      overdue: issue.due! < today,
    }));
}
