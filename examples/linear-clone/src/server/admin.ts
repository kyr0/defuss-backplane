/** VERIFIED: tests/cli.test.ts. The operator's account commands, for `make member`, `make apikey` and `make bot`,
 * since the app sends no email and so has no self sign-up. Each reads the configuration as the service does and prints
 * one JSON line.
 * - `member <email> <person> [name]` reads the password from stdin and gives the person a sign-in.
 * - `apikey <name> [person]` prints an agent's API key once.
 * - `bot [--if-needed]` reads the daemon's root key from stdin and writes a key of this app's bot user into `.env`.
 *   It rotates the key of an existing bot of that name rather than adding a second bot. With `--if-needed`, which
 *   `make setup` passes, a `.env` that already holds a bot key stays as it is. */
import { readFileSync, writeFileSync } from "node:fs";
import { BackplaneError, connectBackplane } from "defuss-backplane/client";
import { loadConfig } from "./config.ts";
import { APP, openWorkspace } from "./workspace.ts";

const [command, ...args] = process.argv.slice(2);
const fail = (error: string, fix?: string): never => {
  console.log(JSON.stringify({ ok: false, error, ...(fix ? { fix } : {}) }));
  process.exit(1);
};
if (command !== "member" && command !== "apikey" && command !== "bot")
  fail("usage: admin.ts member <email> <person> [name] | apikey <name> [person] | bot [--if-needed]");
let config;
try {
  config = loadConfig();
} catch (error) {
  fail((error as Error).message);
}
if (command === "bot") await bot(args.includes("--if-needed"));

/** The fix for a refused bot command, by the backplane's fault code. */
function botFix(error: unknown) {
  const code = error instanceof BackplaneError ? error.code : "";
  if (code === "UNAVAILABLE")
    return "auth is off in the backplane: run make setup in the repository root, which adds BACKPLANE_AUTH_MASTER_KEY, restart the daemon there, then make bot";
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return "the repository root's .env must hold the daemon's API_KEY; then make bot";
  return "start the backplane with make start in the repository root, then make bot";
}

async function bot(ifNeeded: boolean) {
  if (ifNeeded && config!.backplaneApiKey.startsWith("dfa_")) {
    console.log(JSON.stringify({ ok: true, bot: APP, kept: true }));
    process.exit(0);
  }
  const rootKey = (await new Response(Bun.stdin.stream()).text()).trim();
  if (!rootKey) fail("the daemon's root key is read from stdin and was empty", "make bot, which reads it from the repository root's .env");
  let text = "";
  try {
    text = readFileSync(".env", "utf8");
  } catch {
    fail("there is no .env here", "make setup");
  }
  try {
    const backplane = await connectBackplane({ app: APP, port: config!.backplanePort, apiKey: rootKey });
    const existing = (await backplane.bots.list()).find((b) => b.name === APP && !b.admin && b.apps.join() === APP);
    // A bot whose key was revoked or expired has no live key to rotate, so it gets a new bot instead.
    const made = existing
      ? await backplane.bots.rotate(existing.id).catch((e: unknown) => (e instanceof BackplaneError && e.code === "NOT_FOUND" ? null : Promise.reject(e)))
      : null;
    const key = made ?? (await backplane.bots.create({ name: APP, apps: [APP] }));
    const line = "BACKPLANE_API_KEY=" + key.key;
    const current = /^BACKPLANE_API_KEY=.*$/m;
    writeFileSync(".env", current.test(text) ? text.replace(current, line) : text.replace(/\n?$/, "\n") + line + "\n");
    console.log(JSON.stringify({ ok: true, bot: APP, id: key.id, rotated: made !== null, expiresAt: key.expiresAt, wrote: ".env", next: "make restart" }));
    process.exit(0);
  } catch (error) {
    fail((error as Error).message, botFix(error));
  }
}
const ws = await openWorkspace({
  port: config!.backplanePort,
  apiKey: config!.backplaneApiKey,
  workspace: config!.workspace,
  timeZone: config!.timeZone,
});
try {
  if (command === "member") {
    const [email, person, name] = args;
    if (!email || !person) fail("EMAIL and PERSON are required", "make member EMAIL=ada@example.com PERSON=ada < password.txt");
    const password = (await new Response(Bun.stdin.stream()).text()).replace(/\r?\n$/, "");
    if (!password) fail("the password is read from stdin and was empty", "make member EMAIL=… PERSON=… < password.txt");
    console.log(JSON.stringify({ ok: true, ...(await ws.members.add({ email: email!, password, person: person!, name: name || undefined })) }));
  } else {
    const [name, person] = args;
    if (!name) fail("AGENT is required", "make apikey AGENT=triage");
    console.log(JSON.stringify({ ok: true, ...(await ws.members.addAgent({ name: name!, person: person || undefined })) }));
  }
} catch (error) {
  fail((error as Error).message);
} finally {
  await ws.close();
}
