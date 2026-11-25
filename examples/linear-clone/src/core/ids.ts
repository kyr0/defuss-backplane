/** VERIFIED: issue IDs are a team key and a number, as the scaffold's `ENG-142`. The number comes from the team document, so IDs stay short
 * and readable, unlike random IDs. */

/** VERIFIED: the scaffold's team key is `ENG`; a key is 2 to 10 capitals and digits, starting with a capital. */
export const TEAM_KEY = /^[A-Z][A-Z0-9]{1,9}$/;

export function issueId(team: string, number: number) {
  if (!TEAM_KEY.test(team)) throw new TypeError("A team key is 2 to 10 capitals and digits, starting with a capital");
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError("An issue number is a positive integer");
  return team + "-" + number;
}

/** The team and number of an issue ID, or null for anything else. */
export function parseIssueId(id: unknown): { team: string; number: number } | null {
  if (typeof id !== "string") return null;
  const match = /^([A-Z][A-Z0-9]{1,9})-([1-9]\d{0,15})$/.exec(id);
  if (!match) return null;
  const number = Number(match[2]);
  return Number.isSafeInteger(number) ? { team: match[1]!, number } : null;
}
