/** VERIFIED: `make metrics` prints these lines against a running backplane. Prints the backplane's Prometheus lines
 * that carry `app="linear-clone"`: this app's calls per module, method and code, and its RPC callbacks. Why the
 * backplane's scrape and not counters of our own: the backplane already measures every call it serves per app, and
 * the scrape needs the same key this app holds. Reads the app's own validated config, so it fails like the app. */
import { loadConfig } from "../src/server/config.ts";
import { APP } from "../src/server/workspace.ts";

const config = loadConfig(process.env);
const response = await fetch(`http://127.0.0.1:${config.backplanePort}/metrics`, {
  headers: { Authorization: "Bearer " + config.backplaneApiKey },
});
if (!response.ok) {
  console.error(`${new Date().toISOString()} ERROR metrics unavailable status=${response.status}`);
  process.exit(1);
}
const lines = (await response.text()).split("\n").filter((line) => line.includes(`app="${APP}"`));
console.log(lines.length ? lines.join("\n") : `∅ no metrics for app=${APP} yet`);
