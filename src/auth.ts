/** VERIFIED: tests/auth.test.ts and the packed consumer's scripts/consumer-auth.ts. User and API key authentication for apps: one defuss-auth authority per app, in `<data root>/auth/<app>`. An app
 * registers with `auth.configure` and forwards its browser's `/auth/*` routes to `/apps/<app>/auth/*` here; on every
 * API call it asks `auth.authenticate` who sent it. Why ask per call instead of checking JWTs against the JWKS: a
 * revocation or grant change then acts on the next call, and API keys are opaque, so no local check could verify them.
 * Why registration over RPC instead of operator configuration: an app joins the backplane by using its name, without a
 * daemon restart, and its auth should join the same way. Registrations persist in `apps.json`, so a proxied login
 * works right after a daemon restart; the dot keeps that name from ever being an app's. */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApiKey } from "defuss-auth";
import { createAuthHost, tenantAdmin, type HostPrincipal } from "defuss-auth/host";
import { BackplaneError } from "./errors.js";

/** The header an app's proxy sends its bot key in. */
export const PROXY_KEY_HEADER = "x-backplane-key";
/** The only credential the host accepts: the auth route sets it after checking the proxy's key, with a secret that
 * lives as long as the daemon. */
const HOST_HEADER = "x-backplane-host";

export type AuthMode = "cookie" | "token";
/** `mode` defaults to `cookie`: the refresh token in an HttpOnly cookie on the app's origin. `token` hands it to the
 * page instead, for browsers that drop Secure cookies over plain HTTP, such as WebKit. */
export type Registration = { origin: string; mode?: AuthMode };
export type Member = { subjectId: string; email: string; claims: string[]; created: boolean };
/** A tenant member as `members` lists it: no password, session or key. */
export type MemberInfo = { subjectId: string; email: string; status: string; claims: string[]; createdAt: number; updatedAt: number };
/** Whether auth is on and how the app registered; `origin` and the rest only once it is configured. */
export type AuthStatus = {
  app: string;
  enabled: boolean;
  configured: boolean;
  origin?: string;
  mode?: AuthMode;
  issuer?: string;
  audience?: string;
};
export type NewApiKey = { key: string; id: string; subjectId: string; name: string; claims: string[]; expiresAt: number };
type AppScope = { app: string };
type TenantScope = { app: string; tenant: string };

/** defuss-auth's rule for host app names: lowercase, so a case-insensitive volume cannot merge two apps. */
function appName(scope: AppScope) {
  const app = (scope as Partial<AppScope> | null)?.app;
  if (typeof app !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(app))
    throw new TypeError("Auth needs an app name of lowercase letters, digits, - and _, starting with a letter or digit");
  return app;
}
/** defuss-auth tenant IDs are `[A-Za-z0-9_-]`; the backplane's tenant names allow at most 48 bytes. Why no mapping of
 * other names: a hashed ID would hide the tenant in tokens and logs. */
function tenantId(scope: TenantScope) {
  const tenant = (scope as Partial<TenantScope> | null)?.tenant;
  if (typeof tenant !== "string" || !/^[A-Za-z0-9_-]{1,48}$/.test(tenant))
    throw new TypeError("Auth needs a tenant name of 1 to 48 letters, digits, - and _");
  return tenant;
}
function registration(input: unknown): Required<Registration> {
  const { origin, mode = "cookie" } = (input ?? {}) as Partial<Registration>;
  let url: URL | undefined;
  try {
    url = new URL(origin as string);
  } catch {
    url = undefined;
  }
  if (!url || !["http:", "https:"].includes(url.protocol) || url.origin !== origin)
    throw new TypeError("origin must be the app's public origin, such as https://tracker.example");
  if (mode !== "cookie" && mode !== "token") throw new TypeError("mode must be cookie or token");
  return { origin, mode };
}
const strings = (value: unknown, name: string) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 256 || !value.every((v) => typeof v === "string"))
    throw new TypeError(name + " must be a list of strings");
  return value as string[];
};

/** The answer of every auth and bot call while no master key is set. */
export const authOff = () =>
  new BackplaneError("UNAVAILABLE", "Auth is off: set BACKPLANE_AUTH_MASTER_KEY (make env writes one)");

/** Opens the host under `root`, the data root's real path, and every app registered before. Without a master key the
 * methods stay, so the schema is the same, and each answers UNAVAILABLE. `warn` gets a line for an app that no longer
 * opens, which then answers NOT_FOUND until it is configured again. */
export async function openAuth(root: string, masterKey: Uint8Array | undefined, warn: (line: string) => void) {
  const directory = join(root, "auth");
  const secret = randomBytes(32).toString("base64url");
  let open: Awaited<ReturnType<typeof createAuthHost>> | undefined;
  const apps: Record<string, Required<Registration>> = {};
  const registry = join(directory, "apps.json");
  if (masterKey) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    open = await createAuthHost({ directory, masterKey, credential: { header: HOST_HEADER, secret } });
    Object.assign(
      apps,
      await readFile(registry, "utf8").then(
        (text) => JSON.parse(text),
        (error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? {} : Promise.reject(error)),
      ),
    );
  }
  const host = new Proxy({} as NonNullable<typeof open>, {
    get: (_target, name) => {
      if (!open) throw authOff();
      const value = Reflect.get(open, name);
      return typeof value === "function" ? value.bind(open) : value;
    },
  });
  // The issuer stays fixed: defuss-auth refuses to reopen an authority under another issuer, and an app's origin changes
  // with its port or domain. VERIFIED by tests/auth.test.ts. Only allowedOrigins follows the origin.
  const issuer = (app: string) => "urn:defuss-backplane:" + app;
  const options = (app: string, r: Required<Registration>) => ({
    issuer: issuer(app),
    audience: app,
    http: { mode: r.mode, allowedOrigins: [r.origin], authorizeAdmin: tenantAdmin("admin") },
  });
  for (const [app, r] of Object.entries(apps))
    await host.open(app, options(app, r)).catch((error: Error) =>
      warn(`auth app did not open app=${app} error="${error.message}"`),
    );
  // One configure at a time, so two starts of an app cannot open it twice.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>) => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };
  async function persist() {
    const temporary = registry + "." + randomBytes(6).toString("hex");
    await writeFile(temporary, JSON.stringify(apps, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, registry);
  }
  function authority(scope: AppScope) {
    const app = appName(scope);
    const found = host.get(app);
    if (!found) throw new BackplaneError("NOT_FOUND", "Auth is not configured for app " + app + ": call auth.configure");
    return found;
  }
  /** Fails unless the subject has access to the scope's tenant, so a call in one tenant cannot reach another's users. */
  async function member(scope: TenantScope, subjectId: unknown) {
    const auth = authority(scope);
    if (typeof subjectId !== "string" || (await auth.getClaims(subjectId, tenantId(scope))) === undefined)
      throw new BackplaneError("NOT_FOUND", "No member with this subject ID in this tenant");
    return auth;
  }
  return {
    enabled: () => open !== undefined,
    /** Routes a request the auth route already checked: the proxy's key replaced by the host's credential. */
    fetch(request: Request) {
      const headers = new Headers(request.headers);
      headers.delete(PROXY_KEY_HEADER);
      headers.set(HOST_HEADER, secret);
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : (request.body ?? undefined);
      return host.fetch(
        new Request(request.url, {
          method: request.method,
          headers,
          body,
          signal: request.signal,
          ...(body ? { duplex: "half" } : {}),
        } as RequestInit),
      );
    },
    api: {
      /** Registers the app, or changes its origin or mode. The origin is the only one whose pages may send writes; the
       * issuer is `urn:defuss-backplane:<app>` and the audience the app's name. There is no email, so accounts come
       * from `addMember`. */
      configure: (scope: AppScope, input: Registration) =>
        serial(async () => {
          const app = appName(scope);
          const wanted = registration(input);
          const known = apps[app];
          if (known && known.origin === wanted.origin && known.mode === wanted.mode && host.get(app))
            return { app, ...wanted, changed: false };
          await host.close(app);
          await host.open(app, options(app, wanted));
          apps[app] = wanted;
          await persist();
          return { app, ...wanted, changed: true };
        }),
      /** What an agent needs to debug sign-in: whether auth is on and the app's registration. Unlike the other
       * methods it answers while auth is off, with `enabled: false`. */
      async status(scope: AppScope): Promise<AuthStatus> {
        const app = appName(scope);
        const r = apps[app];
        if (!open) return { app, enabled: false, configured: false };
        if (!r || !open.get(app)) return { app, enabled: true, configured: false };
        return { app, enabled: true, configured: true, origin: r.origin, mode: r.mode, issuer: issuer(app), audience: app };
      },
      /** The tenant's members, one page of the app's accounts at a time, skipping accounts of other tenants, so a page
       * can hold fewer than `limit`. `next` is the `after` of the following page, null after the last one. */
      async members(scope: TenantScope, page: { limit?: number; after?: string } = {}) {
        const auth = authority(scope);
        const tenant = tenantId(scope);
        const { limit = 100, after } = (page ?? {}) as { limit?: unknown; after?: unknown };
        if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 500)
          throw new TypeError("limit must be an integer from 1 to 500");
        if (after !== undefined && typeof after !== "string") throw new TypeError("after must be a string");
        const users = await auth.listUsers({ limit, ...(after ? { after } : {}) });
        const items: MemberInfo[] = [];
        for (const u of users) {
          const claims = await auth.getClaims(u.id, tenant);
          if (claims !== undefined)
            items.push({ subjectId: u.id, email: u.email, status: u.status, claims, createdAt: u.createdAt, updatedAt: u.updatedAt });
        }
        return { items, next: users.length === limit ? users.at(-1)!.id : null };
      },
      /** Who sent a request: its `Authorization` field, checked against live state in the scope's tenant. */
      authenticate: (scope: TenantScope, authorization: string, options: { claims?: string[]; anyClaims?: string[] } = {}): Promise<HostPrincipal> =>
        host.authenticate(appName(scope), authorization, {
          tenantId: tenantId(scope),
          claims: strings(options?.claims, "claims"),
          anyClaims: strings(options?.anyClaims, "anyClaims"),
        }),
      /** Grants a person access to the tenant with `claims`, creating the account if the email is new; `password`
       * applies only to a new account. */
      async addMember(scope: TenantScope, input: { email: string; password?: string; claims?: string[] }): Promise<Member> {
        const auth = authority(scope);
        const tenant = tenantId(scope);
        const { email, password } = (input ?? {}) as { email?: unknown; password?: unknown };
        if (typeof email !== "string") throw new TypeError("email must be a string");
        if (password !== undefined && typeof password !== "string") throw new TypeError("password must be a string");
        if (!(await auth.tenantExists(tenant))) await auth.createTenant({ id: tenant });
        let user = await auth.getUserByEmail(email);
        const created = !user;
        user ??= await auth.createUser({ email, password });
        const claims = await auth.setClaims(user.id, tenant, strings(input.claims, "claims") ?? []);
        return { subjectId: user.id, email: user.email, claims, created };
      },
      async removeMember(scope: TenantScope, subjectId: string) {
        await (await member(scope, subjectId)).revokeTenantAccess(subjectId, tenantId(scope));
        return { removed: true };
      },
      async setPassword(scope: TenantScope, subjectId: string, password: string) {
        if (typeof password !== "string") throw new TypeError("password must be a string");
        await (await member(scope, subjectId)).setPassword(subjectId, password);
        return { changed: true };
      },
      /** A service account in the tenant with one key, for an agent; the key is returned once. */
      async createApiKey(scope: TenantScope, input: { name: string; claims?: string[] }): Promise<NewApiKey> {
        const auth = authority(scope);
        const tenant = tenantId(scope);
        const name = (input as Partial<{ name: unknown }> | null)?.name;
        if (typeof name !== "string") throw new TypeError("name must be a string");
        const claims = strings(input.claims, "claims") ?? [];
        if (!(await auth.tenantExists(tenant))) await auth.createTenant({ id: tenant });
        const account = await auth.createServiceAccount({ tenantId: tenant, name, claims });
        const { apiKey, record } = await auth.createApiKey({ subjectId: account.id, name, claims });
        return { key: apiKey, id: record.id, subjectId: account.id, name, claims: record.claims, expiresAt: record.expiresAt };
      },
      /** The keys of the tenant's service accounts, the ones `createApiKey` made. A user's own keys from the
       * `/auth/api-keys` route stay that user's business. */
      async listApiKeys(scope: TenantScope): Promise<ApiKey[]> {
        const auth = authority(scope);
        const tenant = tenantId(scope);
        const accounts = await auth.listServiceAccounts(tenant, { limit: 1000 });
        const keys = await Promise.all(accounts.map((a) => auth.listApiKeys({ subjectId: a.id, tenantId: tenant })));
        return keys.flat();
      },
      async revokeApiKey(scope: TenantScope, id: string) {
        const auth = authority(scope);
        const key = typeof id === "string" ? await auth.getApiKey(id) : undefined;
        if (!key || key.tenantId !== tenantId(scope)) throw new BackplaneError("NOT_FOUND", "No API key with this ID in this tenant");
        await auth.revokeApiKey(id);
        return { revoked: true };
      },
    },
    maintain: async () => (open ? open.maintain() : {}),
    close: async () => open?.closeAll(),
  };
}
export type AuthService = Awaited<ReturnType<typeof openAuth>>;
export type AuthApi = AuthService["api"];
