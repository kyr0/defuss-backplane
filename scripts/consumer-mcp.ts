/** VERIFIED: the packed consumers connect to MCP from `mcp.json`, which scripts/e2e.ts writes with `make mcp-config`
 * for the throwaway daemon, so they reach it exactly as an MCP client configured with that file does. */
import { readFile } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

interface HttpServer {
  type: string;
  url: string;
  headers?: Record<string, string>;
}

/** An MCP client connected to the `defuss-backplane` entry of `./mcp.json`. */
export async function connectMcp(name: string): Promise<Client> {
  const config = JSON.parse(await readFile("mcp.json", "utf8")) as { mcpServers: Record<string, HttpServer> };
  const server = config.mcpServers["defuss-backplane"];
  if (server?.type !== "http") throw new Error("mcp.json has no http entry for defuss-backplane");
  const agent = new Client({ name, version: "1" });
  await agent.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers ?? {} } }));
  return agent;
}
