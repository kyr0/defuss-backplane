/** Signs a person in as the browser does: the account through the workspace's members, then a cookie-mode login
 * through the app's /auth proxy with the page's Origin and CSRF field. Returns the Authorization value an RPC or MCP
 * client sends, and the refresh cookie. */
import type { Server } from "../../src/server/server.ts";

export const PASSWORD = "correct horse battery staple";

export async function signIn(server: Server, input: { email: string; person: string; workspace?: string; name?: string }) {
  await server.ws.members.add({ email: input.email, password: PASSWORD, person: input.person, name: input.name });
  const origin = server.url;
  const answer = await fetch(server.url + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin, "x-defuss-csrf": "1" },
    body: JSON.stringify({ email: input.email, password: PASSWORD, tenantId: input.workspace ?? "vector" }),
  });
  if (!answer.ok) throw new Error("Sign-in failed: HTTP " + answer.status + " " + (await answer.text()));
  const { accessToken } = (await answer.json()) as { accessToken: string };
  return { authorization: "Bearer " + accessToken, cookie: (answer.headers.get("set-cookie") ?? "").split(";")[0]! };
}
