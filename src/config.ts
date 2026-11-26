/** VERIFIED: The literal IPv4 loopback address keeps credentials on the local listener even when the port is configured. */
import { resolve } from "node:path";

export function settings(options: { port?: number; apiKey?: string } = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 43127);
  const apiKey = options.apiKey ?? process.env.API_KEY;
  if (!apiKey || !/^[\x21-\x7e]+$/.test(apiKey))
    throw new Error("API_KEY must contain printable ASCII without whitespace");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be 1..65535");
  return { port, apiKey, base: "http://127.0.0.1:" + port };
}
export function dataRoot() {
  return resolve(process.env.BACKPLANE_DATA_DIR || "./var/data");
}
function flag(name: string) {
  const value = process.env[name] ?? "";
  if (!["", "0", "1"].includes(value)) throw new Error(name + " must be 0 or 1");
  return value === "1";
}
/** Origins besides loopback that scheduled RPC callbacks may call: a comma-separated list such as
 * `https://app.internal:8443`. Each entry must be exactly an origin, without path or trailing slash. */
export function callbackOrigins() {
  const origins = (process.env.BACKPLANE_CALLBACK_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const origin of origins) {
    let url: URL | undefined;
    try {
      url = new URL(origin);
    } catch {
      url = undefined;
    }
    if (!url || !["http:", "https:"].includes(url.protocol) || url.origin !== origin)
      throw new Error("BACKPLANE_CALLBACK_ORIGINS must list origins such as https://app.internal:8443");
  }
  return new Set(origins);
}
/** The master key of the auth service: base64url of 32 random bytes, as `make env` writes it. Unset, the daemon runs
 * without auth and bot users; malformed, it fails at startup, so a typo never starts a daemon with auth switched off.
 * Every app's signing keys and the bot users' keys are encrypted under keys derived from it, so it is backed up with
 * the data root. */
export function authMasterKey() {
  const value = process.env.BACKPLANE_AUTH_MASTER_KEY ?? "";
  if (value === "") return undefined;
  const key = /^[A-Za-z0-9_-]{43}$/.test(value) ? Buffer.from(value, "base64url") : undefined;
  if (key?.length !== 32 || key.toString("base64url") !== value)
    throw new Error("BACKPLANE_AUTH_MASTER_KEY must be base64url of 32 bytes: make env writes one");
  return new Uint8Array(key);
}
/** OTLP push is off unless BACKPLANE_OTLP is 1, so metrics leave the host only when the operator opts in. */
export const otlpEnabled = () => flag("BACKPLANE_OTLP");
