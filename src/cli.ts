#!/usr/bin/env node
/** VERIFIED: Both runtimes use the same CLI and .env parsing boundary. The integration suite launches this built file under each runtime. */
import { loadEnvFile } from "node:process";
import { listen } from "./server.js";

async function main() {
  try {
    loadEnvFile(".env");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const daemon = await listen();
  process.stdout.write(
    new Date().toISOString() + " INFO listening " + daemon.url + "\n",
  );
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
main().catch((error) => {
  process.stderr.write(
    new Date().toISOString() + " ERROR " + error.message + "\n",
  );
  process.exitCode = 1;
});
