/** VERIFIED: make e2e builds with it and serves the result. Builds the deployable app into dist/: the server as one Bun bundle, and the frontend in dist/public with the
 * defuss-shadcn issue tracker bundle and the file input styles beside it. Why a server bundle: dist/ then runs
 * without the source tree or node_modules, which is what scripts/e2e.ts tests. */
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");
const shadcn = join(root, "node_modules/defuss-shadcn/dist");

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "public/vendor"), { recursive: true });

async function bundle(options: Parameters<typeof Bun.build>[0]) {
  const result = await Bun.build(options);
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  return result.outputs;
}

await bundle({
  entrypoints: [join(root, "src/server/cli.ts")],
  outdir: dist,
  target: "bun",
  naming: "server.js",
  minify: true,
  sourcemap: "linked",
});
await bundle({
  entrypoints: [join(root, "src/web/main.ts")],
  outdir: join(dist, "public"),
  target: "browser",
  format: "esm",
  naming: "main.js",
  minify: true,
  sourcemap: "linked",
});
for (const file of ["index.html", "tracker.css"]) await cp(join(root, "src/web", file), join(dist, "public", file));
for (const file of ["apps/issue-tracker/issue-tracker.min.css", "apps/issue-tracker/issue-tracker.min.js", "components/file-input/file-input.min.css"])
  await cp(join(shadcn, file), join(dist, "public/vendor", file.split("/").pop()!));
const sizes = await Promise.all(["server.js", "public/main.js"].map(async (f) => f + "=" + (await Bun.file(join(dist, f)).size)));
console.log(new Date().toISOString() + " INFO built " + sizes.join(" "));
