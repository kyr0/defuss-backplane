# MCP client config, RPC and MCP equivalence e2e, frontend coverage

The human asked for this on 2026-11-26. `make mcp-config` in the backplane and in linear-clone writes the config an MCP client needs to reach the running service over streamable HTTP. Each package's e2e connects with exactly that file and checks that every RPC function and its MCP tool return the same data. An agent can then inspect a running app's real data. The human also chose measured frontend coverage in Chromium and a pinned oxlint on the shell PATH.

## Evidence

- VERIFIED: the backplane serves 29 MCP tools (`src/tools.ts`). `tests/http.test.ts` and the packed consumers call all 29. `scripts/consumer-scheduler.ts` compares tool results with RPC results, but only for the scheduler. No test reads a written client config.
- VERIFIED: linear-clone exposes every RPC namespace except `Jobs` as MCP tools at `/mcp`, without auth (`src/server/server.ts:92`). One test lists the tools and calls `Issues.get` (`tests/api.test.ts:130`). Its e2e drives the built app in three browsers and makes no RPC or MCP calls of its own.
- VERIFIED: oxlint 1.94.0 is a devDependency of both packages (both lockfiles), and `make lint` runs it. It is not on the shell PATH. mise's registry resolves `oxlint` to `aqua:oxc-project/oxc/oxlint`.
- VERIFIED: the frontend bundle `dist/public/main.js` ships with a linked source map (`scripts/build.ts`), so Chromium's V8 coverage can be mapped back to `src/web`.

## Decisions (human, 2026-11-26)

- Each package merges its entry into its own `.mcp.json`. linear-clone also merges into the repository root's `.mcp.json`, so a Claude Code session at the root sees both servers. The file is gitignored, written with mode 600, and keeps other servers' entries.
- Measured frontend coverage in Chromium, with a 60 % floor. The floor runs in `make e2e`, where the journey runs, so `make coverage` does not start a browser a second time.
- oxlint is pinned in `mise.toml`.

## Milestones

Tick `- [x]` when a milestone's proof passes, then run the gate for its scope.

- [x] M0 oxlint on the PATH: `mise.toml` pins `oxlint = "1.94.0"`, the same version as both lockfiles. The root devDependency moves from `^1.0.0` to the exact `1.94.0`. Proof: `mise exec -- oxlint --version` prints 1.94.0, and `make lint` passes.
- [x] M1 `make mcp-config`: `scripts/mcp-config.ts` at the root, shared like `scripts/service.ts`, takes flags (`--name`, `--url`, `--header`, `--out`). It merges one `mcpServers` entry `{type: "http", url, headers}` into the target file, which it creates with mode 600 if missing. The root verb reads `PORT` and `API_KEY` from `.env`. The linear-clone verb reads `PORT` and writes both its own and the root's file. Proof: `tests/mcp-config.test.ts` covers a fresh file, a merge that keeps other servers, a missing `.env` and file mode 600. README sections document the verb. The root `.gitignore` lists `.mcp.json`, which also covers linear-clone's.
- [x] M2 Backplane e2e: `scripts/e2e.ts` runs `make mcp-config` for its throwaway daemon and writes `mcp.json` into the consumer's temporary directory, and every consumer builds its MCP client from that file. A new `consumer-equivalence.ts` calls each of the 29 tools and the matching RPC call on the same data and asserts equal values. Writes go through one transport and are read back through the other. Proof: `make e2e`.
- [x] M3 linear-clone e2e, RPC and MCP: after the browser journey, the e2e runs `make mcp-config` for the built app and writes `mcp.json` into its temporary directory. It calls every RPC function through the defuss-rpc client and its tool through MCP from that file, and asserts equal values. For an error, it compares the HTTP status. Proof: `make e2e`.
- [x] M4 linear-clone frontend coverage: the Chromium journey records JS coverage (`page.coverage`). monocart-coverage-reports maps it through the source map to `src/web` and writes `output/coverage-web/`. `make e2e` fails below 60 % of lines. Proof: `make e2e` prints the line percentage, and the report exists.

## Results

- VERIFIED: `mise exec -- oxlint --version` prints 1.94.0.
- VERIFIED: `tests/mcp-config.test.ts` passes 4 tests. `make mcp-config` in both packages wrote the root `.mcp.json` with both servers, and the official MCP client reached the running daemon (29 tools) and app (13 tools) from it.
- VERIFIED: the backplane e2e's equivalence consumer matched all 29 tools in each of the three storage phases. With keys left unmasked, it fails at `vfs.put`.
- VERIFIED: the linear-clone e2e matched all 13 tools on the built app. With titles left unmasked, it fails at `Issues.create`. Stated outcomes exposed a 500 for a non-string cycle ID. `Cycles.stats` and `Inbox.markRead` now validate their IDs and answer 400 (tests/api.test.ts).
- VERIFIED: coverage of the Chromium journey is 89.1 % of lines, 90.1 % of functions and 65.7 % of branches in `src/web`. The coverage of each document has to be kept before a reload; without that, only the last document counted (56.2 %).
