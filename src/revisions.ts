/** VERIFIED: Legacy tokens include the typed address. Fresh versioned writes replace them in the same storage transaction. */
import { createHash } from "node:crypto";
import { BackplaneError } from "./errors.js";
import type { Scope } from "./scope.js";

export type Versioned<T> =
  | { found: false; revision: null }
  | { found: true; value: T; revision: string };
export interface WriteOptions {
  ifRevision?: string | null;
}
export interface CacheWriteOptions extends WriteOptions {
  ttlMs?: number;
}

export function options(value: unknown, allowTTL = false): CacheWriteOptions {
  if (value === undefined) return {};
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some(
      (k) => k !== "ifRevision" && !(allowTTL && k === "ttlMs"),
    )
  )
    throw new TypeError("Invalid write options");
  const opts = value as CacheWriteOptions;
  if (
    opts.ifRevision !== undefined &&
    opts.ifRevision !== null &&
    (typeof opts.ifRevision !== "string" || !opts.ifRevision.length)
  )
    throw new TypeError("ifRevision must be an opaque string or null");
  return opts;
}
export function conflict(): never {
  throw new BackplaneError(
    "REVISION_CONFLICT",
    "Revision changed. Read the current value before retrying",
  );
}
export function checkRevision(
  expected: WriteOptions["ifRevision"],
  current: string | null,
) {
  if (expected !== undefined && expected !== current) conflict();
}
export function legacyRevision(
  scope: Scope,
  id: string | number | bigint,
  source: string | number,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        scope.app,
        scope.tenant,
        scope.bucket,
        typeof id,
        String(id),
        source,
      ]),
    )
    .digest("base64url");
}
export function missing(): Versioned<never> {
  return { found: false, revision: null };
}
