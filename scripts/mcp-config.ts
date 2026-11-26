/** `make mcp-config`: merges one streamable-HTTP server entry into MCP client config files (`.mcp.json` format:
 * `{"mcpServers": {"<name>": {"type": "http", "url", "headers"}}}`), so Claude Code and other MCP clients reach the
 * running service. VERIFIED: tests/mcp-config.test.ts covers a fresh file, a merge, file mode 600 and a missing .env;
 * the e2e of the backplane and of linear-clone connect with the file this script writes.
 *
 * `node scripts/mcp-config.ts --name <server> --env .env --url 'http://127.0.0.1:${PORT:-43127}/mcp'
 *   [--header 'Authorization: Bearer ${API_KEY}'] --out .mcp.json [--out …]`
 *
 * Why templates over the env file instead of values in flags: the bot key stays off the command line (`ps` shows
 * flags), and the file is read with Node's parser, the one the daemon's `loadEnvFile` uses. Each file is written with
 * mode 600 because a header carries the bot key; other servers' entries are kept. Prints a JSON summary without the
 * header values. */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs, parseEnv } from "node:util";

type Config = { mcpServers?: Record<string, unknown> } & Record<string, unknown>;

/** Replaces `${KEY}` and `${KEY:-default}` with values from `env`; a key without a value or default is an error. */
export function expand(template: string, env: Record<string, string | undefined>): string {
  return template.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, key: string, fallback: string | undefined) => {
    const value = env[key] || fallback;
    if (value === undefined) throw new Error(`${key} is not set in the env file`);
    return value;
  });
}

/** The config with `name` set to the entry; other servers and keys stay. */
export function merge(config: Config, name: string, entry: Record<string, unknown>): Config {
  return { ...config, mcpServers: { ...config.mcpServers, [name]: entry } };
}

function main(): number {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      env: { type: "string", default: ".env" },
      url: { type: "string" },
      header: { type: "string", multiple: true, default: [] },
      out: { type: "string", multiple: true, default: [] },
    },
  });
  const fail = (error: string, fix?: string) => (console.log(JSON.stringify({ name: values.name, error, fix })), 1);
  if (!values.name || !values.url || !values.out.length) return fail("--name, --url and --out are required");
  const bad = values.header.find((h) => !/^[^:\s]+:/.test(h));
  if (bad !== undefined) return fail(`--header ${JSON.stringify(bad)} is not "Name: value"`);
  if (!existsSync(values.env)) return fail(`${values.env} is missing`, "make setup");
  const env = parseEnv(readFileSync(values.env, "utf8"));
  let entry: Record<string, unknown>;
  try {
    const headers = Object.fromEntries(
      values.header.map((h) => {
        const at = h.indexOf(":");
        return [h.slice(0, at).trim(), expand(h.slice(at + 1).trim(), env)];
      }),
    );
    entry = { type: "http", url: expand(values.url, env), ...(values.header.length ? { headers } : {}) };
  } catch (e) {
    return fail((e as Error).message, "make setup");
  }
  for (const out of values.out) {
    const config: Config = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
    writeFileSync(out, JSON.stringify(merge(config, values.name, entry), null, 2) + "\n", { mode: 0o600 });
    chmodSync(out, 0o600);
  }
  const headers = values.header.map((h) => h.slice(0, h.indexOf(":")).trim());
  console.log(JSON.stringify({ name: values.name, url: entry.url, headers, written: values.out }));
  return 0;
}

if (import.meta.main) process.exitCode = main();
