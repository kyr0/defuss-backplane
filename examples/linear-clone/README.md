# linear-clone

An issue tracker in the style of Linear, built on defuss-backplane. It keeps every issue, comment, attachment, log line and schedule in the backplane under the app name `linear-clone`, so the app process itself holds no state. One listener on 127.0.0.1 serves the browser frontend, the defuss-rpc API and the same API as MCP tools. It has no user authentication yet: every request acts as the configured viewer.

## Run it

The app needs a running defuss-backplane daemon and its bot key. Start the daemon from the repository root with `make setup` and `make start`.

```sh
make setup                 # tools, the packed backplane, dependencies, the three test browsers and a missing .env
make start                 # builds dist/ quietly, runs it detached, prints {"state":"running","url":…}
make status                # running | dead | stopped, with pid and URL
make log                   # the last 50 stdout and stderr entries, merged by time
make stop
```

Each verb prints JSON, one object per line; `FORMAT=text` prints readable lines.

Open `http://127.0.0.1:43180/`. On its first start in an empty workspace, the app seeds `input/seed.json`, the scaffold's team, 15 issues, comments, activity and inbox, with dates moved to today.

VERIFIED: the service exits with code 1 and one log line when its configuration is invalid or the backplane's `/readyz` does not answer, and with 0 on SIGTERM (tests/cli.test.ts). `make start` then reports `"state":"dead"` with the last stderr lines.

`make setup` creates a missing `.env` from `.env.example` with the daemon's `API_KEY` from the repository root's `.env`, and creates that one first if it is missing. It never rewrites an existing `.env`. A root key with a character besides letters, digits and `._~+/=-` stops setup with a message, because Bun's `.env` parser changes some of them, such as `$`, `#`, quotes and spaces. You then write `BACKPLANE_API_KEY` yourself. Without `.env`, `make start` reports `"state":"unconfigured"` with `"fix":"make setup"`.

## Configuration

Bun reads `.env` for the app and for `make metrics`. The app checks every value at startup and reports all problems at once.

| Key | Default | Meaning |
| --- | --- | --- |
| `PORT` | 43180 | The app's listener on 127.0.0.1. |
| `BACKPLANE_PORT` | 43127 | The defuss-backplane daemon on 127.0.0.1. |
| `BACKPLANE_API_KEY` | required | The daemon's `API_KEY`. In `.env`, write a key with `$` or `#` in double quotes and each `$` as `\$`. |
| `WORKSPACE` | `vector` | The backplane tenant that holds the workspace. |
| `VIEWER` | `aron` | The person whom "My issues", comments and activity refer to. |
| `TIME_ZONE` | `UTC` | The IANA time zone whose calendar decides today, due dates and cycle days. |
| `DIGEST_CRON` | `0 9 * * *` | When the backplane calls the due digest, as cron in `TIME_ZONE`. |
| `ROLLOVER_CRON` | `0 0 * * 1` | When the backplane calls the cycle rollover. |

## API

The browser and agents call the same namespaces. Over RPC they live at `/rpc`, typed by `type Api` from `src/server/api.ts`. Over MCP, at `/mcp`, each method is a tool such as `Issues.update`.

| Namespace | Methods |
| --- | --- |
| `Workspace` | `bootstrap()`: people, teams, projects, cycles, the viewer and today. |
| `Issues` | `list`, `get` (with revision, comments, activity and attachments), `create`, `update(id, patch, ifRevision?)`, `remove`, `comment`, `attachments`, `removeAttachment`. |
| `Inbox` | `list`, `markRead(ids?)`. |
| `Cycles` | `current`, `stats(id)`. |
| `Jobs` | `dueDigest`, `cycleRollover`: the backplane's scheduler calls them with the bot key. MCP does not list them, and a call without the key answers 403. |

Attachments go through defuss-rpc's streaming transfers: `upload("attachment", file, { uploadId: "<issue>.<uuid>" })` stores up to 25 MiB per file, and `downloadAsBlob("attachment", …, { downloadId: "<issue>/<name>" })` reads it back.

A failed call answers with a code in its message, such as `REVISION_CONFLICT(issue): …`, and the matching HTTP status: 400 for invalid input, 404, 409 for a revision conflict, 413 for a file that is too large, 503 when the backplane is busy.

## Backplane services

| Service | What the app keeps there |
| --- | --- |
| db | People, teams, projects, cycles, issues, comments, activity events and notifications, one bucket each, in the workspace's tenant. |
| cache | Cycle statistics for 5 minutes, dropped on every change to an issue of that cycle. |
| vfs | Attachments under `<issue>/<file name>`. |
| logs | The app's own log lines in the app log, and workspace audit events (issue created, changed, moved, deleted) in the tenant's log. |
| scheduler | The schedules `due-digest` and `cycle-rollover`, whose RPC callbacks call `Jobs`. After someone removes or terminates one, the next start creates a successor under a fresh ID with the job's name as its `ref`, because the backplane keeps a retired schedule's ID reserved. |

## Verbs

| Verb | Does |
| --- | --- |
| `make test`, `make coverage` | Unit and integration tests against a real backplane daemon in a temporary directory. |
| `make lint` | oxlint and the strict TypeScript check. |
| `make e2e` | Builds `dist/`, runs it with a real backplane and drives Chromium, Firefox and WebKit. Then it calls every RPC function and its MCP tool on the built app and compares the results, and it measures the frontend's line coverage in Chromium against a 60 % floor. Last comes the deep suite on a second instance of the built app. Writes `output/e2e.json` and the coverage report `output/coverage-web/`. |
| `make e2e-live` | Runs the deep suite against the backplane that `.env` names, on a second instance of the built app, and writes `output/deep-live.json`. The app `make start` runs and its workspace stay untouched. |
| `make mcp-config` | Writes the app's MCP entry, `{"type":"http","url":"http://127.0.0.1:<PORT>/mcp"}` under `linear-clone`, into `.mcp.json` here and at the repository root, where the backplane's entry is. Other entries stay. |
| `make bench` | Times `Issues.list` over 1,000 issues and writes `output/bench.json`. |
| `make metrics` | Prints the running backplane's metric lines for `app="linear-clone"`. |
| `make verify` | lint, test, coverage and e2e. |

### Deep suite

`scripts/deep.ts` runs every documented behavior once through defuss-rpc and once through MCP. It works in the workspace `_e2e_test_linear-clone`, on an app instance of its own whose two jobs run every second, and it wipes that workspace before and after the run. The wipe refuses any workspace whose name does not start with `_e2e_test_`. The terminated schedules, their run history and the log lines stay, because the backplane deletes none of them.

| Part | What it checks |
| --- | --- |
| Issues | Each invalid field fails with `INVALID_INPUT` and that field's name, and so do an unknown field and a non-object. It also checks defaults, trimming, numbering, the start and completion times, subtasks, an unchanged revision for an empty change, `REVISION_CONFLICT` for a stale one, comments and the activity feed. |
| Inbox | An assignment, a status or priority change and a comment notify the assignee, read from the backplane as an agent would. The viewer's changes to their own issues notify nobody. The scheduler's due digest adds due and overdue items. `markRead` with IDs, with an empty list and without arguments. |
| Cycles | Statistics change with every issue change, although the cache holds them. They cover scope, started, done, percentages, days left and the burn-up's last day. |
| Attachments | Upload, list, download byte for byte, and remove. Exactly 25 MiB round-trips by SHA-256. One byte more, a missing issue and a bad name are refused before the upload. |
| Removal | An issue goes with its comments, activity and files. A stale revision fails. |
| Jobs | MCP lists no `Jobs` tool, and a call without the bot key answers 403. The scheduler calls both jobs at the instance's URL and records their results. With the rollover paused, an ended cycle gets open issues. Resumed, the scheduler closes that cycle and carries the open issues into the next one. |

MCP reports a failed call by its HTTP status only, so the code and field of a refusal are checked over RPC, and the status over both. A full run fails when an MCP tool or RPC function went uncalled.

VERIFIED: one `make e2e` run covered 89.1 % of the lines in `src/web`, 90.1 % of the functions and 65.7 % of the branches.

VERIFIED: one `make bench` run on an Apple Silicon Mac measured `Issues.list` over 1,000 issues at 15.3 ms median and 18.6 ms at the 95th percentile, over 50 calls.

How it is built, and why: [ARCH.md](ARCH.md).
