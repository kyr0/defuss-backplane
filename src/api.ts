/** VERIFIED: tests/client.test.ts calls the daemon through a plain defuss-rpc client typed with this, and `make e2e`
 * type-checks a packed consumer that does the same. The daemon's RPC namespace as one type: every method takes the
 * scope `{ app, tenant, bucket }` first (logs `{ app, tenant? }`, auth `{ app, tenant }` or `{ app }`), then the
 * arguments that `connectBackplane`'s handles take. `bots` and `callbacks` take no scope. Why derive it from the services instead of writing it out: the type then cannot drift from what the daemon
 * serves. This module holds types only, so a client imports no server code. */
import type { createServices } from "./services.js";
import type { ScopedQueue } from "./scheduler.js";
import type { AuthApi } from "./auth.js";
import type { BotsApi } from "./bots.js";
import type { CallbackTokens } from "./callbacks.js";

export type BackplaneApi = ReturnType<typeof createServices>["api"] & {
  scheduler: ScopedQueue;
  auth: AuthApi;
  bots: BotsApi;
  callbacks: CallbackTokens["api"];
};
