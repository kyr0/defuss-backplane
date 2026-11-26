# Changelog

## Unreleased

Added one-off jobs on defuss-scheduler 0.3.0: `scheduler(bucket).submit(job)` and `getJob(id)` over RPC, and the MCP tools `scheduler.submit` and `scheduler.getJob`. A job can have a deadline and a follow-up per ending. A follow-up with handler `_rpc` calls the app's RPC function, a hook, and its callback token's `verify` answer carries the `cause`. `CallbackCall` gained `job` and `cause`, and its `schedule` is null for jobs. Callbacks for jobs send `X-Backplane-Job` and no `X-Backplane-Schedule`.

Added user and API key authentication for apps on [defuss-auth](https://github.com/kyr0/defuss-auth) 0.2.0. Each app gets its own authority in `<data root>/auth/<app>`, registered with `auth.configure` and reopened at startup. The app forwards its browser's `/auth/*` routes to `/apps/<app>/auth/*` with its key in `X-Backplane-Key`, and asks `auth.authenticate` who sent each call. `auth.addMember`, `removeMember`, `setPassword`, `createApiKey`, `listApiKeys` and `revokeApiKey` manage accounts without email. Auth needs `BACKPLANE_AUTH_MASTER_KEY`, which `make env` now writes; without it the methods answer `UNAVAILABLE`.

Added bot users. `bots.create` makes a key (`Authorization: ApiKey <key>`) that reaches only the apps it names, or every app with `admin`, over RPC, MCP, `/vfs/object` and `/files`. The `API_KEY` from `.env` stays the root key. Bots live in the reserved `_backplane` app, apart from every app's users. On `/metrics`, a bot sees only its apps' lines and those that name no app.

Added the read-only MCP tools `auth.status`, `auth.members`, `auth.listApiKeys` and `bots.list`, and the RPC methods `auth.status` and `auth.members`, so agents can debug sign-in. `make env`, which `make setup` runs, now gives an existing `.env` a missing `BACKPLANE_AUTH_MASTER_KEY`.

Changed `_rpc` callbacks: they carry a one-time token in `X-Backplane-Callback` instead of the root key, and the app checks it with `callbacks.verify` using its own key while the call runs.

Added the fault codes `RATE_LIMITED` (429) and `UNAVAILABLE` (503). Moved to defuss-serve 0.5.0. The package bundles defuss-auth and the defuss-db engine code, so installing it adds neither package, nor defuss-db's vector search and its ML runtimes.

Moved to defuss-serve 0.4.0, defuss-rpc 4.4.0 and defuss-mcp 0.6.2. `defuss-backplane/client` runs each connection on a defuss-rpc client context, so the application's `addHook()` and `setHeaders()` cannot reach backplane calls. Every request of a connection still refuses redirects, which would send a call's arguments to another address, and a connection sends one schema request.

Added scheduled RPC callbacks. A schedule with handler `_rpc` makes the daemon call the app's defuss-rpc function named in its payload at each occurrence, with the payload's arguments and the bot key as bearer token, so the app needs no cron or worker of its own. Targets are loopback and the origins in `BACKPLANE_CALLBACK_ORIGINS`. Handler names starting with `_` are reserved. Scheduling is now always on and `BACKPLANE_SCHEDULER` is gone: every daemon serves the twelve scheduler tools. Moved to defuss-scheduler 0.2.0, whose `ready` call lets one dispatcher serve every app.

Changed the on-disk names of apps, tenants and buckets from hex to a readable slug and the first 8 hex digits of the name's SHA-256, such as `acme-gmbh-033aedd8`. The slug keeps letters of every script, which defuss-db 3.3.0 accepts in collection names. This breaks the on-disk layout: the daemon does not read data roots written by earlier versions, and no migration exists. Each DB bucket is now a collection of the tenant's one database, and its revision collection ends in `_rev`. The daemon's own log moved to `_backplane/logs`. Moved to defuss-db 3.3.0.

Added logs on defuss-logs 0.3.0. `logs.write` and `logs.read` over RPC and MCP append to and page through an app's log, or one tenant's log of the app. `client.logs()` and `client.tenant(name).logs()` return handles that a defuss-logs batch sink accepts, so an application's defuss-logs logger writes there. The daemon now writes its own lines through defuss-logs too: each still goes to stdout or stderr and also into the `_backplane` app log, together with calls that fail with a server error. App names starting with `_` are now reserved for the defuss libraries, and every call that uses one fails with `INVALID_ARGUMENT`, except `logs.read` of `{app: "_backplane"}`, which lets any caller read the daemon's log. A data root the daemon cannot write now stops startup.

Added health probes and metrics on defuss-o11y 0.3.0. `/readyz`, `/livez`, `/health` and `/healthz` answer without the bot key; `/metrics` requires it. The scrape times every cache, db, vfs, logs and scheduler call by module, method, app and fault code, and every request by endpoint and status. Gauges report free space on the data root's volume, store handles per module and active transfers. `BACKPLANE_OTLP=1` pushes the same metrics over OTLP/HTTP. Scheduler background faults are now logged as one ERROR line each.

Added `/files/<app>/<tenant>/<bucket>/<key>`, which serves VFS objects to `GET` and `HEAD` with ETags, conditional requests and single byte ranges, behind the bot key. defuss-serve 0.3.0 now owns the listener on both runtimes, and every route is one of its plugins. Downloads carry `X-Size`, which the client reads, because Bun sends streamed bodies without `Content-Length`.

Moved to defuss-rpc 4.0.0. Each daemon creates its own RPC server and closes it on shutdown, instead of registering on the process-wide one and emptying it afterwards. The wire protocol and the client are unchanged.

## 0.3.0

Added opt-in cron scheduling on defuss-scheduler 0.1.0. With `BACKPLANE_SCHEDULER=1`, the daemon opens one scheduler in the data root. `tenant.scheduler(bucket)` returns a queue that defuss-scheduler's `startWorker` accepts, and twelve MCP tools manage schedules, read runs and their histories, and stop work at once.

Added a file service on defuss-vfs 0.3.0. `tenant.vfs(bucket)` and five MCP tools put, get, head, list and delete objects under relative path keys, with the same revision tokens as cache entries and documents. `upload`, `download` and the `/vfs/object` endpoint stream objects larger than the 1 MiB request limit. The README error table now lists every code the service returns.

The listener no longer ends a request after 30 seconds, so long transfers can finish. On shutdown it closes connections that are still open after 3 seconds. A closed daemon unregisters its RPC functions, so a later daemon in the same process serves its own.

Converted the packed-consumer scripts to TypeScript and extended strict type checking to the tests and scripts. The listener check now inspects the daemon's sockets with lsof, so the packed-consumer test also runs on macOS. The built `dist` files are unchanged.

Split the service implementation into scope validation, storage, cache and document modules. The exports and their type declarations are unchanged apart from declaration order.

## 0.2.0

Added versioned point reads and atomic conditional writes for cache entries and documents over RPC and MCP. Existing point reads and unconditional writes retain their result shapes. Cold read misses leave absent shards untouched. Expired cache entries remain until an explicit delete or overwrite.

Added structured service faults, lossless DSON fallback for shared references, tagged bigint document IDs in MCP, and collection-specific TypeScript ID contracts. MCP discovery marks overwrites and deletes as destructive.

## 0.1.0

Added the loopback daemon, authenticated RPC and MCP discovery, persistent cache with TTL, scoped document CRUD and queries, the backend client, and package tests for Node.js and Bun.
