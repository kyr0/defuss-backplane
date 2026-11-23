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
/** Scheduling is off unless BACKPLANE_SCHEDULER is 1, so a daemon without schedules runs no maintenance loop. */
export function schedulerEnabled() {
  const value = process.env.BACKPLANE_SCHEDULER ?? "";
  if (!["", "0", "1"].includes(value))
    throw new Error("BACKPLANE_SCHEDULER must be 0 or 1");
  return value === "1";
}
