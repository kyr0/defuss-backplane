/** VERIFIED: scripts/e2e.ts signs in through it in Chromium, Firefox and WebKit. The browser's sign-in: defuss-auth's
 * client on the app's own `/auth`, which the server forwards to the backplane, so the page talks to its origin only.
 * Its `fetch` carries the access token for every RPC call; a call refused with 401 is refreshed and sent once more,
 * because the client replays only GET and HEAD itself. In cookie mode a reload resumes the session from the refresh
 * cookie; in token mode, for WebKit over plain HTTP, the refresh token lives in page memory and a reload signs in again. */
import { createAuthClient } from "defuss-auth/client";
import df$ from "defuss-query";
import { ui } from "./env.ts";

type SessionInfo = { workspace: string; authMode: "cookie" | "token" };
const info: SessionInfo = await (await fetch("/session.json")).json();
const auth = createAuthClient({ baseUrl: location.origin + "/auth", mode: info.authMode });
// Set after a sign-in: without it, a refresh on the first visit would answer 401, which the browser logs as an error.
const remembered = ui.store.persisted("vector:signed-in", false);

/** The RPC context's fetch: the access token on every call, and one refresh and retry after a 401. */
export async function rpcFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const url = input instanceof Request ? input.url : input;
  const first = await auth.fetch(url, init);
  if (first.status !== 401 || !(await auth.refresh().catch(() => false))) return first;
  return auth.fetch(url, init);
}

/** Resumes an earlier cookie-mode session; false when there is none. */
export async function resume() {
  if (info.authMode !== "cookie" || !remembered.value) return false;
  const ok = await auth.refresh().catch(() => false);
  if (!ok) remembered.set(false);
  return ok;
}

/** Shows the sign-in form until a sign-in succeeds. */
export function prompt() {
  const page = df$<HTMLElement>("[data-pm-signin]");
  const form = df$<HTMLFormElement>("[data-pm-signin-form]");
  const error = df$<HTMLElement>("[data-pm-signin-error]");
  df$("[data-pm]").prop("hidden", true);
  page.prop("hidden", false);
  df$<HTMLInputElement>('[name="email"]', form[0]!)[0]!.focus();
  return new Promise<void>((done) => {
    form.on("submit", async (event: Event) => {
      event.preventDefault();
      const fields = new FormData(form[0]!);
      const button = df$<HTMLButtonElement>('button[type="submit"]', form[0]!).prop("disabled", true);
      try {
        await auth.login({ email: String(fields.get("email")), password: String(fields.get("password")), tenantId: info.workspace });
        remembered.set(true);
        page.prop("hidden", true);
        df$("[data-pm]").prop("hidden", false);
        done();
      } catch (e) {
        const status = (e as { status?: number }).status;
        error
          .text(status === 429 ? "Too many attempts. Wait a few minutes." : status === 401 ? "Email or password is wrong." : "Sign-in failed.")
          .prop("hidden", false);
      } finally {
        button.prop("disabled", false);
      }
    });
  });
}

/** Ends the session here and at the backplane, then shows the sign-in form again. */
export async function signOut() {
  await auth.logout().catch(() => {});
  remembered.set(false);
  location.reload();
}
