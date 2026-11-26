# One-off jobs with pull workers and outcome hooks

The human asked on 2026-11-26 for this typical workflow:

1. An app creates a job in a tenant's scheduler, without a cron.
2. Worker loops in one or many app processes pull jobs with the app's bot key, take a lease, do the work in worker threads, and report the result.
3. The backplane calls the app's RPC hooks on success, on error and on timeout.
4. Anyone with access reads the job's status and result from its record.

The scheduler code changes ship as defuss-scheduler 0.3.0, which the human publishes; the backplane adopts it afterwards.

Tick a milestone `- [x]` when its proof passes, then run `verify` on its scope.

## What exists

- VERIFIED: runs come only from cron occurrences. `Definition.cron` is required, and `src/types.ts:Run` always carries a `scheduleId` (defuss-scheduler 0.2.0, the current npm version).
- VERIFIED: the pull loop exists and does not depend on the backplane. `src/worker.ts:startWorker` claims through any `WorkerPort` (`claim`, `renew`, `complete`, `fail`), renews leases while a handler runs, and aborts `ctx.signal` when the lease is lost or the run is terminated. The backplane's `app.tenant(t).scheduler(b)` handle is a `WorkerPort` over RPC (docs/WORKERS.md, the "Backplane" section). So several processes with the app's bot key can pull jobs today, and the auth work already limits a bot to its own app (the guard in `src/server.ts` calls `allowApp`).
- VERIFIED: runs end in `src/leases.ts:settle`, which handles `succeeded`, `dead` and the switch to `retryWait`. `expire` covers a lost lease, which settles as a failed attempt, and `terminateRun` covers a hard stop. Lease expiry runs in the maintenance tick, `src/scheduler.ts:137`, where no RPC call passes through the backplane.
- VERIFIED: `getRun` returns state, attempt, `lastError` and `result`. Terminal runs are deleted after `retentionMs`, one day by default.
- VERIFIED: no run has a deadline. A handler that hangs while its worker keeps renewing the lease runs forever.
- VERIFIED: the daemon's `_rpc` handler delivers a defuss-rpc call built with `rpcCalls`, with a one-time `X-Backplane-Callback` token (`src/callbacks.ts`).
- VERIFIED: defuss-multicore 0.1.0's `createPool` offers `run(name, payload, { signal, timeoutMs })`. Cancelling a running task terminates its worker thread, and the pool never retries a task itself.
- VERIFIED: the daemon listens on 127.0.0.1 only.

## Decisions (recommended defaults; the human confirms)

- D1 timeout: `timeoutMs` is a deadline counted from admission. Past it, the job ends in a new terminal state `timedOut`, and a running handler sees its signal abort at its next renewal, as after `terminate`. Lease expiry already covers a worker that dies. A per-attempt limit would need a second knob and is not part of this plan.
- D2 hooks: a job's `then` maps the end states `succeeded`, `dead`, `timedOut` and `terminated` to follow-up jobs, each with a `handler` and a `payload`. The scheduler admits a follow-up in the same transaction that ends the job.
  - Why in the scheduler and not the backplane watching: three of the four endings happen in the maintenance tick, or through a hard stop, with no RPC call the backplane sees. A follow-up written in the ending's own transaction cannot be lost; polling for endings can lose one, and it costs reads.
  - Follow-ups cannot have follow-ups of their own, so hooks cannot loop.
- D3 the hook's arguments: in the backplane, a follow-up with handler `_rpc` is an app hook. The app builds its call with `rpcCalls`, as for `_rpc` schedules. The app picks the job ID itself (IDs are client-chosen, as for schedules), so it puts the ID into the hook's arguments.
  - In addition, `callbacks.verify(token)` answers with `cause: { job, state }`. The app checks the token in any case, so it learns the ending from the daemon, and a forged hook call cannot claim one.
  - Why not have the daemon append a job argument: that would break the type check that `rpcCalls` gives the call.
- D4 worker threads: the scheduler gets a helper `poolHandlers(pool, names)`. Each name becomes a handler that calls `pool.run(name, run.payload, { signal: ctx.signal })`. `pool` is a structural type, so defuss-multicore stays the app's choice and is not a dependency of the scheduler. Set `concurrency` to the pool's `maxWorkers`.
- D5 the backplane-dependent part: only the hooks need the backplane. The worker loop stays in defuss-scheduler, and the backplane adds no loop of its own (the human's point f).
- D6 remote workers: workers on the daemon's host only, containers included, through host networking or a mounted socket. UNKNOWN: whether the daemon can sit behind a TLS proxy for other hosts. defuss-serve rejects a foreign `Host` header, so the proxy has to rewrite it; probe=`caddy reverse-proxy --from :8443 --to 127.0.0.1:43127 --change-host-header`, then `curl` `/readyz` through it. Exposing the daemon beyond loopback changes its security model and needs the human's approval.

## Milestones

### defuss-scheduler 0.3.0

- [ ] S1 `src/types.ts:Queue.submit(job, options?)` and `src/types.ts:Job`. A job is a run without a schedule:
  - fields `id`, `ref?`, `handler`, `payload`, `retry?`, `capabilities?`, `concurrencyKey?`, `availableAt?`, `timeoutMs?` and `then?`;
  - `requestId` replay works as for `create`;
  - `Run.scheduleId` becomes `string | null`, and `Run` gains `jobId` and `deadline`;
  - job IDs are unique per scope and stay reserved like schedule IDs;
  - `terminate({ job })` and `terminate({ ref })` cover jobs;
  - `listRuns({ ref })` finds them.
  Proof: tests against a real store cover submission, idempotent replay, a duplicate ID failing with `ALREADY_EXISTS`, a claim granting the job, `complete` storing the result for `getRun`, retries until `dead`, and the payload and `maxPending` limits. Why-doc: why a job is a run without a schedule, rather than a schedule that fires once.
- [ ] S2 deadline. A deadline index, built like `keys.expiry`, lets `tick` end unfinished jobs past `deadline` as `timedOut`. A renewal after the deadline answers `stale`, so the handler's signal aborts. Proof: a test where a real worker with a slow handler sees its job end as `timedOut`, with `ctx.signal` aborted and its late `complete` ignored.
- [ ] S3 `then` follow-ups, admitted in the same transaction by `settle`, by the deadline ending and by `terminateRun`. The follow-up's `Run.cause` is `{ job, state }`. A `then` inside a follow-up is refused at submission. Proof: tests for each of the four endings, for a crash between ending and admission (the authority reopened from the same directory shows both or neither), and for a follow-up `then` being refused.
- [ ] S4 `src/worker.ts:poolHandlers`. Proof: a test runs a real defuss-multicore pool, a devDependency, under `startWorker` on Node and on Bun. It covers a result, a thrown error becoming a failed attempt, and abort on terminate stopping the thread. HYPOTHESIS: the pool's `worker_threads` run under Bun; falsifier=the Bun run of that test.
- [ ] S5 docs: README "Jobs" section, docs/API.md (`submit`, `timedOut`, `then`, `cause`), docs/WORKERS.md (`poolHandlers`), CHANGELOG. `Run.scheduleId` being nullable is a breaking type change; it ships in 0.3.0 and the CHANGELOG states it. Proof: `make verify`; prose findings=0.
- [ ] S6 the human publishes 0.3.0; wait for npm (MEMORY: `npm view defuss-scheduler@0.3.0 version` refreshes the cache).

### defuss-backplane (after S6)

- [ ] B1 `src/scheduler.ts`.
  - `methods` gains `submit`; the `Record<keyof Queue, true>` already fails the build until it does.
  - `schedulerApi.submit` applies the `_` handler rule to the job and to each `then` entry, and checks every `_rpc` payload with `callback(payload, origins)` at submission.
  Proof: tests/scheduler tests cover a refused `_x` handler, a bad `_rpc` hook URL refused at submission, and a bot submitting only into its own app.
- [ ] B2 `src/callbacks.ts`. The `_rpc` dispatcher also serves follow-ups. `CallbackCall` gains `job?` and `cause?`, and `callbacks.verify` returns them. Proof: tests/callbacks.test.ts delivers a hook for each ending to a real defuss-rpc server; the server verifies its token and reads `cause`.
- [ ] B3 `src/client.ts`.
  - The queue handle's `submit` is typed.
  - `rpcHook(url, call)` returns `{ handler: "_rpc", payload: { url, ...call } }`. VERIFIED: src/client.ts has no `_rpc` helper yet; schedules spread the call into the payload by hand, and they could use this one too.
  - README example: `submit({ id, handler: "render", payload, timeoutMs, then: { succeeded: rpcHook(url, calls.Renders.done(id)), dead: …, timedOut: … } })`.
- [ ] B4 `src/tools.ts:schedulerTools` gains `scheduler.submit`, for an agent that queues work. The tool count text goes from twelve to thirteen.
- [ ] B5 proof of the workflow in the packed e2e. scripts/consumer-jobs.ts runs:
  - two worker processes with the app's bot key, each running `startWorker(queue, { concurrency: 2, handlers: poolHandlers(pool, ["render"]) })` on a real defuss-multicore pool;
  - 20 submitted jobs, which both processes pull;
  - one job that throws permanently, one past its deadline and one terminated, each delivering its hook to a consumer RPC server that verifies the token;
  - `getRun` showing every result.
  The deep suite drives `submit` over RPC and MCP, so the coverage check finds no unused method.
- [ ] B6 load. HYPOTHESIS: idle slots poll `claim` every 250 ms plus jitter, so 200 idle slots cost the daemon about 800 empty RPC calls per second, which stays within one core. Falsifier: `make bench` gains a case with 200 idle slots over RPC and records the daemon's CPU. If the cost is too high, plan a long-poll `claim` separately.
- [ ] B7 docs: README (jobs, hooks, workers in threads and processes, `cause`), ARCH (why follow-ups live in the scheduler, the hook trust path, D6), CHANGELOG. Proof: the gate.

## Out of scope

- A per-attempt time limit.
- A job that waits for other jobs, beyond its `then` follow-ups.
- Workers on other hosts before D6 is decided.
- An admin UI.
- linear-clone has no job use case yet, so it adopts nothing.

## Risk

`Run.scheduleId: string | null` breaks consumers that read it as a string. Within this workspace that is only the backplane's `src/callbacks.ts`, whose B2 change covers it.
