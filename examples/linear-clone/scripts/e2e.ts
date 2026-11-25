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
  // Wide enough that the board's five columns fit: a drag can only drop on a column inside the viewport.
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  // VERIFIED: defuss-rpc 4.3.0's client asks `HEAD /rpc/upload/<id>` before an upload with an `uploadId`, and the
  // server answers 404 when there is nothing to resume (src/client.ts, "404 => no session to resume"). The app sends
  // an uploadId on every upload, because it carries the issue ID, so that one 404 is expected; every other is not.
  const probe = (url: string) => /\/rpc\/upload\/[^/]+$/.test(new URL(url).pathname);
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (m.text().startsWith("Failed to load resource") && m.location().url && probe(m.location().url)) return;
    errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() < 400 || (r.status() === 404 && r.request().method() === "HEAD" && probe(r.url()))) return;
    errors.push(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  await page.goto(url);
  await page.waitForSelector("[data-pm][data-ready]");
  return { page, errors };
}

/** The section a route shows: a view by its ID, or the issue section with an issue's ID. */
const shown = (section: string) =>
  /^ENG-\d+$/.test(section) ? `#issue[data-issue="${section}"]:not([hidden])` : `[id="${section}"]:not([hidden])`;

const ROUTES = [
  ["#/", "issues"],
  ["#/my-issues", "my-issues"],
  ["#/inbox", "inbox"],
  ["#/cycles", "cycles"],
  ["#/projects", "projects"],
  ["#/issues/ENG-142", "ENG-142"],
  ["#/no-such-route", "issues"],
] as const;

/** Every route shows its section, and every icon placeholder became an SVG (an unknown icon logs an error). */
async function routes(page: Page) {
  for (const [hash, section] of ROUTES) {
    await page.evaluate((h) => (location.hash = h), hash);
    await page.waitForSelector(shown(section));
    const placeholders = await page.locator("i[data-lucide]").count();
    if (placeholders) throw new Error(placeholders + " icon placeholders left on " + hash);
  }
}

type Step = [string, (page: Page, base: string) => Promise<void>];

const ready = (page: Page) => page.waitForSelector("[data-pm][data-ready]");
async function reload(page: Page) {
  await page.reload();
  await ready(page);
}
async function go(page: Page, hash: string, section: string) {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.waitForSelector(shown(section));
}
const expectText = async (page: Page, selector: string, text: string) => {
  await page.locator(selector).filter({ hasText: text }).first().waitFor();
};
const value = (page: Page, selector: string) => page.locator(selector).first().inputValue();
const stat = async (page: Page, key: string) => Number(await page.locator(`[data-pm-stat="${key}"]`).first().textContent());
const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
};

/** The created issue's ID, shared by the later steps of one journey. */
let created = "";

async function createIssue(page: Page, title: string) {
  await go(page, "#/", "issues");
  await page.keyboard.press("c");
  await page.waitForSelector("#pm-create[open]");
  await page.fill("#pm-new-title", title);
  await page.selectOption('#pm-create select[name="priority"]', "high");
  await page.click('#pm-create button[type="submit"]');
  await page.waitForSelector("#pm-create[open]", { state: "detached" });
  const row = page.locator(".pm-list .pm-row").filter({ hasText: title });
  await row.waitFor();
  created = (await row.getAttribute("data-issue"))!;
  await reload(page);
  await page.locator(`.pm-list .pm-row[data-issue="${created}"][data-priority="high"]`).waitFor();
}

const smokeSteps: Step[] = [
  ["routes", (page) => routes(page)],
  ["seeded list", async (page) => {
    await go(page, "#/", "issues");
    check((await page.locator(".pm-list .pm-row").count()) >= 15, "fewer than 15 rows");
  }],
  ["create", (page) => createIssue(page, "Created in " + page.context().browser()!.browserType().name())],
];

const journeySteps: Step[] = [
  ...smokeSteps,
  ["layouts", async (page) => {
    await page.click('.pm-layout .toggle[value="board"]');
    await page.waitForSelector(".pm-board .pm-card", { state: "visible" });
    await page.click('.pm-layout .toggle[value="table"]');
    await page.waitForSelector("#pm-grid .data-grid-row", { state: "visible" });
    await page.click('.pm-layout .toggle[value="list"]');
    await page.waitForSelector(".pm-list .pm-row", { state: "visible" });
  }],
  ["issue page edits", async (page) => {
    await go(page, "#/issues/" + created, created);
    const select = (field: string) => `section.pm-issue select[data-field="${field}"]`;
    // Three quick edits in a row: each must be stored, none may conflict with the one before.
    await page.selectOption(select("status"), "progress");
    await page.selectOption(select("priority"), "urgent");
    await page.selectOption(select("assignee"), "anna");
    for (const text of ["moved from Todo to In Progress", "set priority to Urgent", "assigned to Anna Silva"])
      await expectText(page, "section.pm-issue .pm-event", text);
    await reload(page);
    check((await value(page, select("status"))) === "progress", "status not stored");
    check((await value(page, select("priority"))) === "urgent", "priority not stored");
    check((await value(page, select("assignee"))) === "anna", "assignee not stored");
  }],
  ["sub-issues", async (page) => {
    await page.fill("section.pm-issue [data-pm-sub-new] input", "First step");
    await page.press("section.pm-issue [data-pm-sub-new] input", "Enter");
    await page.locator("section.pm-issue [data-pm-sub]").first().waitFor();
    await page.check("section.pm-issue [data-pm-sub]");
    await expectText(page, "section.pm-issue [data-pm-sub-count]", "1/1");
    await reload(page);
    check(await page.isChecked("section.pm-issue [data-pm-sub]"), "sub-issue not stored");
  }],
  ["comment", async (page) => {
    // A draft survives a re-render of the page: morph keeps the textarea and its typed text.
    await page.fill("section.pm-issue [data-pm-comment] textarea", "Checked in the browser");
    await page.selectOption('section.pm-issue select[data-field="priority"]', "high");
    await expectText(page, "section.pm-issue .pm-event", "set priority to High");
    check((await value(page, "section.pm-issue [data-pm-comment] textarea")) === "Checked in the browser", "the draft was lost");
    await page.click('section.pm-issue [data-pm-comment] button[type="submit"]');
    await expectText(page, "section.pm-issue .pm-comment", "Checked in the browser");
    await reload(page);
    await expectText(page, "section.pm-issue .pm-comment", "Checked in the browser");
  }],
  ["attachment upload and download", async (page) => {
    const text = "attachment from the browser " + Date.now();
    await page.setInputFiles("section.pm-issue [data-pm-attach]", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from(text) });
    await page.locator('section.pm-issue [data-pm-download="notes.txt"]').waitFor();
    await reload(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.click('section.pm-issue [data-pm-download="notes.txt"]')]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    check(Buffer.concat(chunks).toString() === text, "downloaded bytes differ");
  }],
  ["board drag and drop", async (page) => {
    await go(page, "#/", "issues");
    await page.click('.pm-layout .toggle[value="board"]');
    await page.dragAndDrop(`.pm-board .pm-card[data-issue="${created}"]`, '.pm-col[data-status="done"] .pm-cards');
    await page.locator(`.pm-col[data-status="done"] .pm-card[data-issue="${created}"]`).waitFor();
    await reload(page);
    await page.locator(`.pm-col[data-status="done"] .pm-card[data-issue="${created}"]`).waitFor({ state: "attached" });
    await page.click('.pm-layout .toggle[value="list"]');
  }],
  ["context menu and cycle numbers", async (page) => {
    await go(page, "#/cycles", "cycles");
    const before = await stat(page, "done");
    await go(page, "#/", "issues");
    await page.click('.pm-list .pm-row[data-issue="ENG-141"]', { button: "right" });
    await page.click('#pm-ctx [data-set-status="done"]');
    await page.locator('.pm-list .pm-row[data-issue="ENG-141"][data-status="done"]').waitFor();
    await page.click('.pm-list .pm-row[data-issue="ENG-139"]', { button: "right" });
    await page.click('#pm-ctx [data-ctx="mine"]');
    await page.locator('.pm-list .pm-row[data-issue="ENG-139"][data-assignee="aron"]').waitFor();
    await go(page, "#/cycles", "cycles");
    check((await stat(page, "done")) === before + 1, "cycle done count did not grow by one");
    await reload(page);
    check((await stat(page, "done")) === before + 1, "cycle done count not stored");
    await go(page, "#/", "issues");
    await page.click(`.pm-list .pm-row[data-issue="${created}"]`, { button: "right" });
    await page.click('#pm-ctx [data-ctx="delete"]');
    await page.locator(`.pm-list .pm-row[data-issue="${created}"]`).waitFor({ state: "detached" });
    await reload(page);
    check((await page.locator(`.pm-row[data-issue="${created}"]`).count()) === 0, "deleted issue came back");
  }],
  ["palette and shortcuts", async (page) => {
    await go(page, "#/", "issues");
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await page.waitForSelector("#pm-cmd[open]");
    await page.click('#pm-cmd [data-go="/inbox"]');
    await page.waitForSelector('[id="inbox"]:not([hidden])');
    await go(page, "#/", "issues");
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("j");
    const first = await page.evaluate(() => (document.activeElement as HTMLElement).closest("[data-issue]")?.getAttribute("data-issue"));
    await page.keyboard.press("j");
    const second = await page.evaluate(() => (document.activeElement as HTMLElement).closest("[data-issue]")?.getAttribute("data-issue"));
    await page.keyboard.press("k");
    const back = await page.evaluate(() => (document.activeElement as HTMLElement).closest("[data-issue]")?.getAttribute("data-issue"));
    check(!!first && !!second && first !== second && back === first, `J and K moved ${first} → ${second} → ${back}`);
    await go(page, "#/issues/ENG-140", "ENG-140");
    await page.keyboard.press("Escape");
    await page.waitForSelector('[id="issues"]:not([hidden])');
  }],
  ["inbox", async (page) => {
    await go(page, "#/inbox", "inbox");
    check((await page.locator(".pm-note[data-unread]").count()) > 0, "no unread notes");
    await page.click("[data-pm-read-all]");
    await page.locator(".pm-note[data-unread]").first().waitFor({ state: "detached" });
    await reload(page);
    check((await page.locator(".pm-note[data-unread]").count()) === 0, "read state not stored");
  }],
  ["projects", async (page) => {
    await go(page, "#/projects", "projects");
    check((await page.locator("#projects tbody tr").count()) === 5, "expected 5 projects");
    await expectText(page, "#projects tbody tr", "Search 2.0");
  }],
  ["language after reload", async (page) => {
    await page.click(".pm-me");
    await page.locator("#pm-lang").getByText("Deutsch").first().click();
    await expectText(page, ".sidebar-link", "Posteingang");
    await reload(page);
    await expectText(page, ".sidebar-link", "Posteingang");
    await page.click(".pm-me");
    await page.locator("#pm-lang").getByText("English").first().click();
    await expectText(page, ".sidebar-link", "Inbox");
  }],
];

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
    const engines: [string, BrowserType, Step[]][] = [
      ["chromium", chromium, journeySteps],
      ["firefox", firefox, smokeSteps],
      ["webkit", webkit, smokeSteps],
    ];
    for (const [name, engine, steps] of engines) {
      const browser = await engine.launch();
      try {
        const { page, errors } = await openPage(browser, base);
        // A failed step ends the browser's journey: later steps build on its state.
        for (const [step, run] of steps) {
          try {
            await run(page, base);
            if (errors.length) throw new Error("Console errors: " + errors.splice(0).join(" | "));
            checks.push({ browser: name, step, ok: true });
            log("pass", { browser: name, step: JSON.stringify(step) });
          } catch (error) {
            checks.push({ browser: name, step, ok: false, error: String(error) });
            log("FAIL", { browser: name, step: JSON.stringify(step), error: JSON.stringify(String(error).slice(0, 400)) });
            break;
          }
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
