/** VERIFIED: tests/setup.test.ts. Gives an existing `.env` a BACKPLANE_AUTH_MASTER_KEY when it has none or an empty
 * one, so `make setup` switches auth on for a checkout whose `.env` predates the key. A key already set is never
 * replaced: it encrypts the auth stores, and a different one would leave them unreadable. Rewriting the file in place
 * keeps its mode 600. Prints one line. */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2] ?? ".env";
const text = readFileSync(file, "utf8");
if (/^BACKPLANE_AUTH_MASTER_KEY=\S/m.test(text)) {
  console.log(file + " exists and has BACKPLANE_AUTH_MASTER_KEY; left unchanged");
} else {
  const line = "BACKPLANE_AUTH_MASTER_KEY=" + randomBytes(32).toString("base64url");
  const empty = /^BACKPLANE_AUTH_MASTER_KEY=.*$/m;
  writeFileSync(file, empty.test(text) ? text.replace(empty, line) : text.replace(/\n?$/, "\n") + line + "\n");
  console.log("added BACKPLANE_AUTH_MASTER_KEY to " + file + "; restart the daemon (make restart) to switch auth on");
}
