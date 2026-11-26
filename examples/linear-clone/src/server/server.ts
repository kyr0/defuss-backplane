/** VERIFIED: tests/api.test.ts and tests/cli.test.ts. One defuss-serve listener on 127.0.0.1 serves the built
 * frontend, the defuss-rpc API at /rpc and the same API as MCP tools at /mcp, as the backplane does. Why one listener:
 * the browser calls its own origin, so it needs no CORS, and defuss-serve's Host check covers every route. */
import { createMcpApi } from "defuss-mcp";
import { createMcpHttp } from "defuss-mcp/http";
import { exposeRpc } from "defuss-mcp/rpc";
import { createRpcServer } from "defuss-rpc/server";
import { createServer } from "defuss-serve";
import { mcpPlugin, rpcPlugin } from "defuss-serve/plugins";
import { version } from "../../package.json" with { type: "json" };
import { FAULTS, faultMessage, parseFault } from "../core/faults.ts";
import { issueOfUpload } from "../core/ids.ts";
import { validateFileName } from "../core/issue.ts";
import type { Seed } from "../core/seed.ts";
import { createApi, faultOf } from "./api.ts";
import type { Config } from "./config.ts";
import { jobsGuard, schedules, upsertSchedules } from "./jobs.ts";
import { openWorkspace } from "./workspace.ts";

/** Attachments are at most 25 MiB. The guard checks the size the client announces; the handler checks the bytes. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Gives a coded fault its HTTP status; defuss-rpc answers every thrown error with 500. */
async function withStatus(response: Promise<Response>) {
  const answer = await response;
  if (answer.status !== 500) return answer;
  const body = await answer.text();
  return new Response(body, { status: FAULTS[parseFault(body).code], headers: answer.headers });
}

export type Server = Awaited<ReturnType<typeof startServer>>;

export async function startServer(config: Config, options: { publicDir: string; seed?: Seed; now?: () => Date }) {
  const ws = await openWorkspace({
    port: config.backplanePort,
    apiKey: config.backplaneApiKey,
    workspace: config.workspace,
    timeZone: config.timeZone,
    now: options.now,
  });
  const { log } = ws;
  if (options.seed && (await ws.seed(options.seed))) log.info("workspace seeded", { workspace: config.workspace });
  const rpc = createRpcServer(
    createApi({ ws, viewer: config.viewer, workspace: config.workspace, timeZone: config.timeZone, log }),
  );
  // Refuses an attachment before its bytes arrive: too large, for a missing issue, or with a bad file name. Why in the
  // guard: it runs before the upload is stored, so a refused file is never spooled. VERIFIED: before defuss-rpc 4.3.1, a
  // streaming handler that threw without reading its stream also left the temp file handle open, and Bun failed with
  // "A FileHandle object was closed during garbage collection". A refused upload answers 403.
  rpc.addHook({ phase: "guard", fn: jobsGuard(config.backplaneApiKey) });
  rpc.addHook({
    phase: "guard",
    fn: async (namespace, method, args, request) => {
      if (namespace !== "__upload__") return true;
      if (method !== "attachment" || Number(args[0]) > MAX_ATTACHMENT_BYTES) return false;
      try {
        validateFileName(decodeURIComponent(request.headers.get("x-original-filename") ?? ""));
        await ws.issues.get(issueOfUpload(request.headers.get("x-upload-id") ?? ""));
        return true;
      } catch {
        return false;
      }
    },
  });
  /** Reads a stream to its end, which closes the temp file behind it. */
  const discard = (stream: ReadableStream<Uint8Array>) => stream.pipeTo(new WritableStream()).catch(() => {});
  rpc.addStreamingUploadHandler("attachment", async (stream, meta) => {
    // The announced size passed the guard; the stored bytes may still be more.
    if (meta.bytesReceived > MAX_ATTACHMENT_BYTES) {
      await discard(stream);
      throw new Error(faultMessage({ code: "TOO_LARGE", message: "Attachments are at most 25 MiB" }));
    }
    try {
      return await ws.attachments.upload(issueOfUpload(meta.uploadId), meta.originalFilename, stream, config.viewer);
    } catch (error) {
      if (!stream.locked) await discard(stream);
      throw new Error(faultMessage(faultOf(error)));
    }
  });
  rpc.addStreamingDownloadHandler("attachment", async ({ downloadId }) => {
    const slash = downloadId.indexOf("/");
    const name = downloadId.slice(slash + 1);
    const found = slash > 0 ? await ws.attachments.download(downloadId.slice(0, slash), name).catch(() => null) : null;
    if (!found?.found) throw new Error(faultMessage({ code: "NOT_FOUND", message: "No attachment " + downloadId }));
    return {
      stream: found.stream,
      fileMeta: { size: found.size, filename: name, contentType: "application/octet-stream" },
    };
  });
  const route = ({ request }: { request: Request }) => withStatus(rpc.fetch(request));
  const tools = createMcpApi({ name: "linear-clone", version });
  await exposeRpc(tools, route, { codec: "json", include: (namespace) => namespace !== "Jobs" });
  const mcp = createMcpHttp(tools, { mode: "json", allowedOrigins: [] });
  const server = createServer({
    host: "127.0.0.1",
    port: config.port,
    publicDir: options.publicDir,
    plugins: [rpcPlugin({ fetch: (request: Request) => route({ request }) }), mcpPlugin(mcp)],
    shutdownTimeoutMs: 3000,
    onDiagnostic: (event) => log.warn("serve " + event.code, { plugin: event.plugin }),
  });
  try {
    await server.start();
  } catch (error) {
    await Promise.all([rpc.close(), mcp.close(), ws.close()]);
    throw error;
  }
  const url = "http://127.0.0.1:" + server.port;
  try {
    // The callbacks carry the app's URL, so the schedules follow the port of this start.
    const outcome = await upsertSchedules(ws.scheduler, url + "/rpc", config.timeZone, schedules(config));
    log.info("schedules", outcome);
  } catch (error) {
    await server.stop();
    await Promise.all([rpc.close(), mcp.close(), ws.close()]);
    throw error;
  }
  log.info("listening", { url, workspace: config.workspace, viewer: config.viewer });
  return {
    url,
    port: server.port,
    ws,
    async close() {
      await server.stop();
      await Promise.all([rpc.close(), mcp.close()]);
      log.info("stopped", { url });
      await ws.close();
    },
  };
}
