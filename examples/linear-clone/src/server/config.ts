/** VERIFIED: The service's settings, read once at startup; Bun loads `.env` into `process.env`, and
 * `tests/config.test.ts` checks that `.env.example` lists every key read here. Why names of its own rather than the
 * backplane client's defaults `PORT` and `API_KEY`: the app has a listener of its own, and `PORT` is its port. */
export type Config = {
  /** `PORT`: the app's listener on 127.0.0.1. */
  port: number;
  /** `BACKPLANE_PORT`: the defuss-backplane daemon on 127.0.0.1. */
  backplanePort: number;
  /** `BACKPLANE_API_KEY`: the app's bot key from the backplane's `make bot APP=linear-clone`. The daemon's root
   * `API_KEY` works too, but reaches every app. Required. */
  backplaneApiKey: string;
  /** `WORKSPACE`: the backplane tenant that holds the workspace, and the auth tenant its people sign in to. */
  workspace: string;
  /** `PUBLIC_ORIGIN`: the origin the browser loads the app from, such as `https://tracker.example`; the default is the
   * listener's `http://127.0.0.1:<PORT>`. Sign-in accepts writes from this origin only. */
  publicOrigin: string;
  /** `AUTH_MODE`: `cookie` keeps the refresh token in an HttpOnly cookie, `token` gives it to the page, for browsers
   * that drop Secure cookies over plain HTTP, such as WebKit. */
  authMode: "cookie" | "token";
  /** `TIME_ZONE`: the IANA zone whose calendar decides today, due dates and cycle days. */
  timeZone: string;
  /** `DIGEST_CRON` and `ROLLOVER_CRON`: when the backplane runs the due digest and the cycle rollover, in `timeZone`. */
  digestCron: string;
  rolloverCron: string;
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
    publicOrigin: "",
    authMode: read(env, "AUTH_MODE", "cookie") as Config["authMode"],
    timeZone: read(env, "TIME_ZONE", "UTC"),
    digestCron: read(env, "DIGEST_CRON", "0 9 * * *"),
    rolloverCron: read(env, "ROLLOVER_CRON", "0 0 * * 1"),
  };
  // The scheduler checks the fields when the schedule is created; this catches a value that is no cron at all.
  for (const [key, cron] of [["DIGEST_CRON", config.digestCron], ["ROLLOVER_CRON", config.rolloverCron]] as const)
    if (!/^\S+( \S+){4,5}$/.test(cron)) problems.push(key + " must be a cron expression of 5 or 6 fields");
  // VERIFIED: the daemon's own rule for its API_KEY (defuss-backplane src/config.ts).
  if (!config.backplaneApiKey) problems.push("BACKPLANE_API_KEY is required: the daemon's API_KEY");
  else if (!/^[\x21-\x7e]+$/.test(config.backplaneApiKey))
    problems.push("BACKPLANE_API_KEY must contain printable ASCII without whitespace");
  // VERIFIED: the backplane's auth takes tenant names of 1 to 48 letters, digits, - and _ (defuss-backplane
  // src/auth.ts). Checking here fails at startup instead of at the first sign-in.
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(config.workspace))
    problems.push("WORKSPACE must have 1 to 48 letters, digits, - and _");
  // The default follows PORT, which is checked above; only an origin the operator set needs checking.
  config.publicOrigin = read(env, "PUBLIC_ORIGIN", "http://127.0.0.1:" + config.port);
  if (env.PUBLIC_ORIGIN) {
    let origin: URL | undefined;
    try {
      origin = new URL(config.publicOrigin);
    } catch {
      origin = undefined;
    }
    if (!origin || !["http:", "https:"].includes(origin.protocol) || origin.origin !== config.publicOrigin)
      problems.push("PUBLIC_ORIGIN must be an origin such as https://tracker.example, without a path");
  }
  if (config.authMode !== "cookie" && config.authMode !== "token") problems.push("AUTH_MODE must be cookie or token");
  try {
    new Intl.DateTimeFormat("en", { timeZone: config.timeZone });
  } catch {
    problems.push("TIME_ZONE must be an IANA time zone such as Europe/Berlin");
  }
  if (problems.length) throw new Error("Invalid configuration: " + problems.join("; "));
  return config;
}
