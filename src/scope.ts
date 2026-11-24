/** VERIFIED: The services run these checks before leasing a store handle, so a rejected scope, key or ID never reaches the filesystem. */
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { PrimaryKey } from "defuss-db";

export interface Scope {
  app: string;
  tenant: string;
  bucket: string;
}

/** A readable form of a name: NFC, lowercase, every run of characters other than letters, digits and marks of any
 * script turned into one `-`, at most 48 UTF-16 code units, starting with a letter or digit. `x` stands in for a name
 * without letters or digits. */
function slug(value: string) {
  const words = value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^[\p{M}-]+|-+$/gu, "");
  let short = "";
  // Whole code points, so a cut never splits a surrogate pair.
  for (const char of words) {
    if (short.length + char.length > 48) break;
    short += char;
  }
  return short.replace(/-+$/, "") || "x";
}

/** Encodes one scope identifier as its slug, `-` and the first 8 hex digits of the SHA-256 of its exact UTF-8 bytes,
 * so `ls` shows the name. The slug alone merges `Shop` and `shop`, `my shop` and `my-shop`, or the NFC and NFD
 * spellings of `Café`; the hash keeps them apart, also on case-insensitive and normalizing volumes, because it is
 * ASCII. 8 hex digits guard against accidental collisions, not chosen ones.
 * VERIFIED from the defuss-db 3.3.0 source: a collection name matches `^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]*$` with 1 to
 * 64 code units. An encoded name holds at most 57 and never contains `_`, which `db.ts` relies on. */
export function component(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.length ||
    !value.isWellFormed() ||
    Buffer.byteLength(value) > 48
  )
    throw new TypeError(
      "Namespace identifiers must contain 1 to 48 valid UTF-8 bytes",
    );
  return slug(value) + "-" + createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/** Encodes an app name a caller may use. Names starting with `_` belong to the defuss libraries: the daemon writes its
 * own log as `_backplane`, so a caller that could claim the prefix could forge it. */
export function appComponent(value: unknown) {
  const encoded = component(value);
  if ((value as string).startsWith("_"))
    throw new TypeError("App names starting with _ are reserved for the defuss libraries");
  return encoded;
}

/** Rejects a scope whose fields the storage services would reject, so every service accepts the same names. */
export function checkedScope(scope: Scope) {
  record(scope, "scope");
  appComponent(scope.app);
  component(scope.tenant);
  component(scope.bucket);
  return scope;
}

/** The tenant directory and encoded bucket name for a scope under the data root. */
export function address(root: string, scope: Scope) {
  record(scope, "scope");
  return {
    tenant: join(root, appComponent(scope.app), component(scope.tenant)),
    bucket: component(scope.bucket),
  };
}

export function checkedKey(value: string) {
  if (
    typeof value !== "string" ||
    !value.length ||
    !value.isWellFormed() ||
    Buffer.byteLength(value) > 1024
  )
    throw new TypeError("Cache keys must contain 1 to 1024 valid UTF-8 bytes");
  return value;
}

/** Accepts only plain objects. VERIFIED: RPC arguments are DSON, which can carry a Date or binary value where a
 * scope, document, patch or request belongs. */
export function record(
  value: unknown,
  name: string,
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError(name + " must be a plain object");
}

export function checkedId(id: PrimaryKey) {
  if (
    typeof id !== "string" &&
    typeof id !== "bigint" &&
    !(typeof id === "number" && Number.isFinite(id))
  )
    throw new TypeError("Invalid document ID");
  return id;
}
