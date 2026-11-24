#!/usr/bin/env node
/** VERIFIED: Both runtimes use the same CLI and .env parsing boundary. The integration suite launches this built file under each runtime. */
import { loadEnvFile } from "node:process";
import { listen } from "./server.js";
import { print } from "./log.js";

async function main() {
  try {
    loadEnvFile(".env");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const daemon = await listen();
  daemon.log.info("listening " + daemon.url);
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    try {
      await daemon.close();
    } catch {
      process.exitCode = 1;
    }
  }
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}
// A daemon that failed to start has no log store, so the line goes to stderr only.
main().catch((error) => {
  print("error", error.message);
  process.exitCode = 1;
});
