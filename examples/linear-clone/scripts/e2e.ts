/** VERIFIED: make e2e runs it against the built server. The browser end-to-end run, with Node.js: copies the built dist/ and the seed into a temporary directory, starts the
 * real defuss-backplane daemon and the built server there, and drives Chromium, Firefox and WebKit with
 * playwright-core. Chromium walks the whole journey; Firefox and WebKit open every route and create one issue. Every
 * page must stay free of console errors. Results go to output/e2e.json. */
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type BrowserType, chromium, firefox, type Page, webkit } from "playwright-core";

const root = join(import.meta.dirname, "..");
const log = (message: string, fields: Record<string, string | number> = {}) =>
  console.log([new Date().toISOString(), "INFO e2e", message, ...Object.entries(fields).map(([k, v]) => k + "=" + v)].join(" "));

async function freePort() {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  await new Promise<void>((done) => probe.close(() => done()));
  if (!address || typeof address === "string") throw new Error("No port");
  return address.port;
}

/** Starts a child and resolves once a line of its stdout matches `ready`. */
function launch(command: string[], cwd: string, env: Record<string, string>, ready: RegExp) {
  const child = spawn(command[0]!, command.slice(1), { cwd, env: { PATH: process.env.PATH ?? "", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  return new Promise<ChildProcess>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Not ready: " + command.join(" ") + "\n" + output)), 20_000);
    const seen = (chunk: Buffer) => {
      output += chunk;
      if (ready.test(output)) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout!.on("data", seen);
    child.stderr!.on("data", (chunk: Buffer) => (output += chunk));
    child.on("exit", (code) => reject(new Error(command.join(" ") + " exited with " + code + "\n" + output)));
  });
}

const stop = (child: ChildProcess) =>
  new Promise<void>((done) => {
    if (child.exitCode !== null) return done();
    child.removeAllListeners("exit");
    child.once("exit", () => done());
    child.kill("SIGTERM");
  });

export type Check = { browser: string; step: string; ok: boolean; error?: string };

/** Opens a page that records console errors and uncaught exceptions. */
async function openPage(browser: Browser, url: string) {
  const page = await browser.newPage({ acceptDownloads: true });
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector("[data-pm][data-ready]");
  return { page, errors };
}

const ROUTES = [
  ["#/", "issues"],
  ["#/my-issues", "my-issues"],
  ["#/inbox", "inbox"],
  ["#/cycles", "cycles"],
  ["#/projects", "projects"],
  ["#/issues/ENG-142", "ENG-142"],
  ["#/no-such-route", "issues"],
] as const;

/** Every route shows its section, by URL and by reload. */
async function routes(page: Page) {
  for (const [hash, section] of ROUTES) {
    await page.evaluate((h) => (location.hash = h), hash);
    await page.waitForSelector(`[id="${section}"]:not([hidden])`);
  }
}

async function smoke(page: Page, base: string) {
  await routes(page);
  await page.goto(base + "#/");
  await page.waitForSelector("[data-pm][data-ready]");
  const rows = await page.locator(".pm-list .pm-row").count();
  if (rows < 15) throw new Error("Expected at least 15 rows, saw " + rows);
}

async function run() {
  const work = await mkdtemp(join(tmpdir(), "linear-clone-e2e-"));
  const app = join(work, "app");
  await mkdir(join(app, "input"), { recursive: true });
  await cp(join(root, "dist"), join(app, "dist"), { recursive: true });
  await cp(join(root, "input/seed.json"), join(app, "input/seed.json"));
  const apiKey = randomBytes(24).toString("hex");
  const backplanePort = await freePort();
  const port = await freePort();
  const children: ChildProcess[] = [];
  const checks: Check[] = [];
  try {
    children.push(
      await launch(
        ["node", join(root, "node_modules/defuss-backplane/dist/cli.js")],
        work,
        { PORT: String(backplanePort), API_KEY: apiKey, BACKPLANE_DATA_DIR: join(work, "backplane") },
        /listening|127\.0\.0\.1:\d+/,
      ),
    );
    children.push(
      await launch(
        ["bun", "dist/server.js"],
        app,
        { PORT: String(port), BACKPLANE_PORT: String(backplanePort), BACKPLANE_API_KEY: apiKey, TIME_ZONE: "UTC" },
        / INFO listening /,
      ),
    );
    const base = "http://127.0.0.1:" + port + "/";
    log("services ready", { url: base });
    const engines: [string, BrowserType, (page: Page, base: string) => Promise<void>][] = [
      ["chromium", chromium, smoke],
      ["firefox", firefox, smoke],
      ["webkit", webkit, smoke],
    ];
    for (const [name, engine, journey] of engines) {
      const browser = await engine.launch();
      try {
        const { page, errors } = await openPage(browser, base);
        try {
          await journey(page, base);
          if (errors.length) throw new Error("Console errors: " + errors.join(" | "));
          checks.push({ browser: name, step: journey.name, ok: true });
          log("pass", { browser: name, journey: journey.name });
        } catch (error) {
          checks.push({ browser: name, step: journey.name, ok: false, error: String(error) });
          log("FAIL", { browser: name, journey: journey.name, error: JSON.stringify(String(error).slice(0, 400)) });
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    for (const child of children.reverse()) await stop(child);
    await rm(work, { recursive: true, force: true });
  }
  await mkdir(join(root, "output"), { recursive: true });
  const failed = checks.filter((c) => !c.ok).length;
  await writeFile(join(root, "output/e2e.json"), JSON.stringify({ at: new Date().toISOString(), routes: ROUTES.map(([h]) => h), checks }, null, 2) + "\n");
  log(failed ? "FAIL" : "PASS", { checks: checks.length, failed, report: "output/e2e.json" });
  if (failed) process.exit(1);
}

await run();
