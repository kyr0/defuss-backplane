/** VERIFIED: The service's settings, read once at startup; Bun loads `.env` into `process.env`, and
 * `tests/config.test.ts` checks that `.env.example` lists every key read here. Why names of its own rather than the
 * backplane client's defaults `PORT` and `API_KEY`: the app has a listener of its own, and `PORT` is its port. */
export type Config = {
  /** `PORT`: the app's listener on 127.0.0.1. */
  port: number;
  /** `BACKPLANE_PORT`: the defuss-backplane daemon on 127.0.0.1. */
  backplanePort: number;
  /** `BACKPLANE_API_KEY`: the daemon's `API_KEY`, sent as the bot key. Required. */
  backplaneApiKey: string;
  /** `WORKSPACE`: the backplane tenant that holds the workspace. */
  workspace: string;
  /** `VIEWER`: the person whom "My issues", comments and the activity feed refer to, until user auth exists. */
  viewer: string;
  /** `TIME_ZONE`: the IANA zone whose calendar decides today, due dates and cycle days. */
  timeZone: string;
};

type Env = Record<string, string | undefined>;

/** An unset or empty key takes its default. */
const read = (env: Env, key: string, fallback: string) => (env[key] ? env[key] : fallback);

function port(env: Env, key: string, fallback: number, problems: string[]) {
  const text = read(env, key, String(fallback));
  const value = Number(text);
  if (!/^\d+$/.test(text) || value < 1 || value > 65535) problems.push(key + " must be an integer from 1 to 65535");
  return value;
}

/** Validates every key and reports all problems in one error, so one start shows everything to fix. */
export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];
  const config: Config = {
    port: port(env, "PORT", 43180, problems),
    backplanePort: port(env, "BACKPLANE_PORT", 43127, problems),
    backplaneApiKey: read(env, "BACKPLANE_API_KEY", ""),
    workspace: read(env, "WORKSPACE", "vector"),
    viewer: read(env, "VIEWER", "aron"),
    timeZone: read(env, "TIME_ZONE", "UTC"),
  };
  // VERIFIED: the daemon's own rule for its API_KEY (defuss-backplane src/config.ts).
  if (!config.backplaneApiKey) problems.push("BACKPLANE_API_KEY is required: the daemon's API_KEY");
  else if (!/^[\x21-\x7e]+$/.test(config.backplaneApiKey))
    problems.push("BACKPLANE_API_KEY must contain printable ASCII without whitespace");
  // VERIFIED: the daemon accepts a tenant of 1 to 48 UTF-8 bytes (defuss-backplane src/scope.ts). Checking here fails at
  // startup instead of at the first call.
  if (Buffer.byteLength(config.workspace) > 48) problems.push("WORKSPACE must have at most 48 UTF-8 bytes");
  try {
    new Intl.DateTimeFormat("en", { timeZone: config.timeZone });
  } catch {
    problems.push("TIME_ZONE must be an IANA time zone such as Europe/Berlin");
  }
  if (problems.length) throw new Error("Invalid configuration: " + problems.join("; "));
  return config;
}
