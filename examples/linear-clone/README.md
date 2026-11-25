# linear-clone

An issue tracker in the style of Linear, built on defuss-backplane. It keeps every issue, comment, attachment, log line and schedule in the backplane under the app name `linear-clone`, so the app process itself holds no state. One listener on 127.0.0.1 serves the browser frontend, the defuss-rpc API and the same API as MCP tools. It has no user authentication yet: every request acts as the configured viewer.

## Run it

The app needs a running defuss-backplane daemon and its bot key.

```sh
make setup                 # tools, the packed backplane, dependencies and the three test browsers
cp .env.example .env       # then set BACKPLANE_API_KEY to the daemon's API_KEY
make start                 # builds dist/ and runs it detached
make status                # running | dead | stopped
make log                   # the last lines of var/log/linear-clone.stdout and .stderr
make stop
```

Open `http://127.0.0.1:43180/`. On its first start in an empty workspace, the app seeds `input/seed.json`, the scaffold's team, 15 issues, comments, activity and inbox, with dates moved to today.

VERIFIED: the service exits with code 1 and one log line when its configuration is invalid or the backplane's `/readyz` does not answer, and with 0 on SIGTERM (tests/cli.test.ts). `make start` then reports it dead.

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
| scheduler | The schedules `due-digest` and `cycle-rollover`, whose RPC callbacks call `Jobs`. |

## Verbs

| Verb | Does |
| --- | --- |
| `make test`, `make coverage` | Unit and integration tests against a real backplane daemon in a temporary directory. |
| `make lint` | oxlint and the strict TypeScript check. |
| `make e2e` | Builds `dist/`, runs it with a real backplane and drives Chromium, Firefox and WebKit. Writes `output/e2e.json`. |
| `make bench` | Times `Issues.list` over 1,000 issues and writes `output/bench.json`. |
| `make metrics` | Prints the running backplane's metric lines for `app="linear-clone"`. |
| `make verify` | lint, test, coverage and e2e. |

VERIFIED: one `make bench` run on an Apple Silicon Mac measured `Issues.list` over 1,000 issues at 15.3 ms median and 18.6 ms at the 95th percentile, over 50 calls.

How it is built, and why: [ARCH.md](ARCH.md).
