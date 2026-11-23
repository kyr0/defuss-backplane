/** VERIFIED: The services run these checks before leasing a store handle, so a rejected scope, key or ID never reaches the filesystem. */
import { join } from "node:path";
import type { PrimaryKey } from "defuss-db";

export interface Scope {
  app: string;
  tenant: string;
  bucket: string;
}

/** Encodes one scope identifier as `x` + lowercase hex of its UTF-8 bytes.
 * VERIFIED: hex keeps distinct names distinct on case-insensitive volumes, which escaping or slugging would not.
 * defuss-db 3.1.0 names must match `[A-Za-z][A-Za-z0-9_-]{0,63}`, so the `x` supplies the leading letter. */
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
  return "x" + Buffer.from(value).toString("hex");
}

/** Rejects a scope whose fields the storage services would reject, so every service accepts the same names. */
export function checkedScope(scope: Scope) {
  record(scope, "scope");
  component(scope.app);
  component(scope.tenant);
  component(scope.bucket);
  return scope;
}

/** The tenant directory and encoded bucket name for a scope under the data root. */
export function address(root: string, scope: Scope) {
  record(scope, "scope");
  return {
    tenant: join(root, component(scope.app), component(scope.tenant)),
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
