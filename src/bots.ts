/** VERIFIED: tests/bots.test.ts. The backplane's own users: bots that call the daemon with `Authorization: ApiKey <key>` instead of the root
 * `API_KEY`. The backplane keeps them as if it were an app of its own, in tenant `_backplane` of an authority under the
 * reserved `_backplane` directory, so they never mix with any app's users. Why not an app of the auth host: host app
 * names start with a letter or digit, so `_backplane` cannot be one, and no app the host opens can claim this directory.
 * Each bot's claims name the apps it may use (`app:<name>`) or `admin`; access.ts applies them. */
import { hkdfSync } from "node:crypto";
import { join } from "node:path";
import { AuthError } from "defuss-auth";
import { createAuth } from "defuss-auth/server";
import { type Caller, requireAdmin } from "./access.js";
import { authOff } from "./auth.js";
import { BackplaneError } from "./errors.js";
import { appComponent } from "./scope.js";

const TENANT = "_backplane";
const APP = "app:";

/** A bot as `bots.list` reports it. `keyId` and `expiresAt` describe its live key; a bot whose key expired has none. */
export type Bot = {
  id: string;
  name: string;
  apps: string[];
  admin: boolean;
  keyId: string | null;
  expiresAt: number | null;
};
export type NewBot = { name: string; apps?: string[]; admin?: boolean };

function claimsOf(input: NewBot) {
  const record = (input ?? {}) as Partial<NewBot>;
  if (typeof record.name !== "string" || !/^[\x20-\x7e]{1,64}$/.test(record.name))
    throw new TypeError("A bot needs a name of 1 to 64 printable ASCII characters");
  const apps = record.apps ?? [];
  if (!Array.isArray(apps) || apps.length > 64) throw new TypeError("apps must list at most 64 app names");
  // The same rule as every scope, so a bot cannot be granted a name no app can have, or the reserved `_backplane`.
  for (const app of apps) appComponent(app);
  if (record.admin !== undefined && typeof record.admin !== "boolean") throw new TypeError("admin must be a boolean");
  const claims = [...new Set(apps)].map((app) => APP + app);
  if (record.admin) claims.push("admin");
  if (!claims.length) throw new TypeError("A bot needs at least one app or admin");
  return { name: record.name, claims };
}

function described(id: string, name: string, claims: readonly string[], key?: { id: string; expiresAt: number }): Bot {
  return {
    id,
    name,
    apps: claims.filter((c) => c.startsWith(APP)).map((c) => c.slice(APP.length)),
    admin: claims.includes("admin"),
    keyId: key?.id ?? null,
    expiresAt: key?.expiresAt ?? null,
  };
}

/** Opens the bot authority under `root`, which must be the data root's real path. Without a master key there are no
 * bots: every key but the root key is refused, and the methods answer UNAVAILABLE. */
export async function openBots(root: string, masterKey: Uint8Array | undefined) {
  let open: Awaited<ReturnType<typeof createAuth>> | undefined;
  if (masterKey) {
    // A salt of its own: the host's derivation is no public contract, so the two stay independent.
    const encryptionKey = new Uint8Array(hkdfSync("sha256", masterKey, "defuss-backplane/bot-auth/v1", TENANT, 32));
    open = await createAuth({
      issuer: "defuss-backplane",
      audience: TENANT,
      storage: { directory: join(root, TENANT, "auth") },
      encryptionKey,
    });
    try {
      if (!(await open.tenantExists(TENANT))) await open.createTenant({ id: TENANT });
    } catch (error) {
      await open.close();
      throw error;
    }
  }
  const auth = new Proxy({} as NonNullable<typeof open>, {
    get: (_target, name) => {
      if (!open) throw authOff();
      const value = Reflect.get(open, name);
      return typeof value === "function" ? value.bind(open) : value;
    },
  });
  async function account(id: unknown) {
    const found = typeof id === "string" ? await auth.getServiceAccount(id) : undefined;
    if (!found || found.tenantId !== TENANT) throw new BackplaneError("NOT_FOUND", "No bot with this ID");
    return found;
  }
  async function liveKey(id: string) {
    const now = Date.now();
    return (await auth.listApiKeys({ subjectId: id }))
      .filter((k) => k.revokedAt === null && k.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
  }
  return {
    /** The caller a bot key stands for, or null for a key that is unknown, revoked, expired or no bot's. A storage
     * fault throws, so the route answers 503 instead of 401. */
    async authenticate(authorization: string): Promise<Caller | null> {
      if (!open) return null;
      try {
        const p = await auth.requireAuth(authorization, { tenantId: TENANT });
        if (p.subjectKind !== "service") return null;
        const bot = described(p.subjectId, "", [...p.claims]);
        return { kind: "bot", id: bot.id, apps: new Set(bot.apps), admin: bot.admin };
      } catch (error) {
        if (error instanceof AuthError && ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(error.code)) return null;
        throw error;
      }
    },
    api: {
      /** Creates a bot and returns its key, which no later call shows again. */
      async create(input: NewBot): Promise<Bot & { key: string }> {
        requireAdmin();
        const { name, claims } = claimsOf(input);
        const created = await auth.createServiceAccount({ tenantId: TENANT, name, claims });
        const { apiKey, record } = await auth.createApiKey({ subjectId: created.id, name, claims });
        return { ...described(created.id, name, claims, record), key: apiKey };
      },
      async list(): Promise<Bot[]> {
        requireAdmin();
        const accounts = await auth.listServiceAccounts(TENANT, { limit: 1000 });
        return Promise.all(
          accounts.map(async (a) =>
            described(a.id, a.name, (await auth.getClaims(a.id, TENANT)) ?? [], await liveKey(a.id)),
          ),
        );
      },
      /** Replaces the bot's live key: the old one stops working, and the new one is returned once. Keys expire after
       * 90 days, so an operator rotates before then. */
      async rotate(id: string): Promise<Bot & { key: string }> {
        requireAdmin();
        const bot = await account(id);
        const key = await liveKey(bot.id);
        if (!key) throw new BackplaneError("NOT_FOUND", "This bot has no live key; create a new bot");
        const { apiKey, record } = await auth.rotateApiKey(key.id);
        return { ...described(bot.id, bot.name, record.claims, record), key: apiKey };
      },
      /** Deletes the bot, so its keys fail on their next call. */
      async revoke(id: string): Promise<{ revoked: true }> {
        requireAdmin();
        const bot = await account(id);
        await auth.deleteServiceAccount(bot.id);
        return { revoked: true };
      },
    },
    maintain: async () => (open ? open.maintain() : null),
    close: async () => open?.close(),
  };
}
export type Bots = Awaited<ReturnType<typeof openBots>>;
export type BotsApi = Bots["api"];
