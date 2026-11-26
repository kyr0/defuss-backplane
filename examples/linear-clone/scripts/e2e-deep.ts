/** VERIFIED: scripts/e2e.ts calls it with its throwaway backplane, scripts/deep-live.ts with the running one. Runs the
 * deep suite on an instance of the built app of its own: the workspace `_e2e_test_linear-clone`, a free port, and
 * both jobs every second, so the scheduler delivers them during the run. The workspace is wiped before the instance
 * starts and after it stops, so each run starts from the seed and leaves no documents or files; its terminated
 * schedules, run history and log lines stay, because the backplane deletes none of them. The MCP client connects
 * from what `make mcp-config` writes for that instance. */
import { execFile } from "node:child_process";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { type Backplane, DEEP_TENANT, type DeepResult, deepCheck, wipeWorkspace } from "./deep.ts";
import { admin, freePort, launch, stop } from "./e2e-proc.ts";

export async function runDeep({ root, work, backplane }: { root: string; work: string; backplane: Backplane }): Promise<DeepResult[]> {
  const app = join(work, "app");
  await mkdir(join(app, "input"), { recursive: true });
  await cp(join(root, "dist"), join(app, "dist"), { recursive: true });
  await cp(join(root, "input/seed.json"), join(app, "input/seed.json"));
  const results: DeepResult[] = [];
  const timed = async (step: string, run: () => Promise<Record<string, number>>) => {
    const started = Date.now();
    try {
      const deleted = await run();
      results.push({ via: "workspace", step: step + " " + JSON.stringify(deleted), ok: true, ms: Date.now() - started });
    } catch (error) {
      results.push({ via: "workspace", step, ok: false, ms: Date.now() - started, error: String(error) });
    }
  };
  await timed("the workspace is wiped before the run", () => wipeWorkspace(backplane, DEEP_TENANT, false));
  const port = await freePort();
  const viewer = "aron";
  const env = {
    BACKPLANE_PORT: String(backplane.port),
    BACKPLANE_API_KEY: backplane.apiKey,
    WORKSPACE: DEEP_TENANT,
    TIME_ZONE: "UTC",
    DIGEST_CRON: "* * * * * *",
    ROLLOVER_CRON: "* * * * * *",
  };
  const instance = await launch(["bun", "dist/server.js"], app, { ...env, PORT: String(port) }, / INFO listening /);
  try {
    // One agent key acting as Aron, for RPC and MCP alike, so both transports see the same viewer.
    const { key } = admin(root, env, ["apikey", "deep", viewer]);
    await writeFile(join(work, "mcp.env"), "PORT=" + port + "\nAGENT_API_KEY=" + key + "\n");
    await promisify(execFile)("make", ["-s", "mcp-config", "MCP_ENV=" + join(work, "mcp.env"), "MCP_OUT=" + join(work, "mcp.json")], { cwd: root });
    results.push(...(await deepCheck({ baseUrl: "http://127.0.0.1:" + port, mcpConfig: join(work, "mcp.json"), backplane, viewer })));
  } finally {
    await stop(instance);
  }
  await timed("the workspace is wiped after the run and its schedules terminated", () => wipeWorkspace(backplane, DEEP_TENANT, true));
  return results;
}
