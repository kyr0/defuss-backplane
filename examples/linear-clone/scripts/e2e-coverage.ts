/** VERIFIED: scripts/e2e.ts runs it on the Chromium journey. Line coverage of the frontend as the journey executes it:
 * Chromium's V8 coverage of the built `main.js`, mapped through its source map back to `src/web`, with a floor.
 * Why Chromium only: Firefox and WebKit expose no JS coverage to Playwright. Why the built bundle and its source map
 * instead of instrumented sources: the journey then runs exactly what is deployed. The HTML report goes to
 * output/coverage-web/. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CoverageReport } from "monocart-coverage-reports";
import type { Page } from "playwright-core";

/** The gate's coverage floor, which the frontend meets too. */
export const FLOOR = 60;

type Entry = Awaited<ReturnType<Page["coverage"]["stopJSCoverage"]>>[number];
/** Coverage of documents a reload replaced, per recording page. */
const kept = new WeakMap<Page, Entry[]>();

export async function startCoverage(page: Page) {
  kept.set(page, kept.get(page) ?? []);
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
}

/** Saves the current document's coverage before a reload. VERIFIED: without it, only the scripts of the last
 * document counted, and actions.ts showed 4 % although the journey runs every action. A no-op on a page that does
 * not record (Firefox, WebKit). */
export async function keepCoverage(page: Page) {
  const entries = kept.get(page);
  if (!entries) return;
  entries.push(...(await page.coverage.stopJSCoverage()));
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
}

/** Stops recording and returns the line, function and branch percentages of `src/web`. */
export async function reportCoverage(page: Page, root: string) {
  const entries = [...(kept.get(page) ?? []), ...(await page.coverage.stopJSCoverage())];
  const sourceMap = JSON.parse(await readFile(join(root, "dist/public/main.js.map"), "utf8"));
  const main = entries.filter((e) => new URL(e.url).pathname === "/main.js").map((e) => ({ ...e, sourceMap }));
  if (!main.length) throw new Error("Chromium recorded no coverage for /main.js");
  const report = new CoverageReport({
    name: "linear-clone frontend, Chromium journey",
    outputDir: join(root, "output/coverage-web"),
    reports: ["v8", "json-summary"],
    sourceFilter: (path: string) => path.includes("src/web/"),
    cleanCache: true,
  });
  await report.add(main);
  const results = await report.generate();
  if (!results) throw new Error("monocart produced no coverage results");
  const pct = (m: { pct: number | "" }) => (m.pct === "" ? 0 : m.pct);
  const { lines, functions, branches } = results.summary;
  return { lines: pct(lines), functions: pct(functions), branches: pct(branches), files: results.files.length };
}
