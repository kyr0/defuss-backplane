# Episodes

<!-- Newest last. The gate appends FAIL|DONE|FINDING; past 100 entries it trims only its own oldest DONE|FAIL|learned
FINDING (git keeps them). Leads (LESSON, FINDING learn=none) stay until wrap settles them; doctor fails above 30.
Agents append `<UTC ISO> s=<session> LESSON <VAE-DIALECT>` only for a falsified HYPOTHESIS, a dead end, or a root cause.
Session start injects the 3 newest open entries: LESSON, FINDING learn=none, FAIL without a later DONE.
Wrap: EVERY lead becomes a test | .vae/VERIFY.py rule | one MEMORY line with BC, then delete; OR delete BC evidence. -->

2026-11-22T13:17:58Z s=dcdb118f FINDING src/tools.ts tool() doc; CHANGELOG.md Unreleased learn=none: Wording precision in self-written docs; not mechanically checkable.
2026-11-22T15:08:18Z s=dcdb118f FINDING package.json:4 description learn=none: Product positioning wording chosen by the human; not mechanically checkable.
2026-11-22T15:38:35Z s=dcdb118f FINDING src/server.ts server.timeout learn=none: Runtime behaviour recorded in ARCH.md; no rule can check an absent timeout.
2026-11-22T15:38:35Z s=dcdb118f FINDING scripts/consumer-vfs.ts checkVfs learn=none: Test-script completeness; no mechanical rule.
2026-11-22T15:38:35Z s=dcdb118f FINDING src/vfs.ts INLINE_LIMIT; src/tools.ts Adapter.output learn=none: Minor API hygiene.
2026-11-22T15:38:35Z s=dcdb118f FINDING README.md Errors table B/P learn=none: Doc completeness against an enum; a future enum change shows in review.
2026-11-22T15:38:35Z s=dcdb118f FINDING package.json:4 description learn=none: Product positioning, not mechanically checkable.
2026-11-22T15:38:35Z s=dcdb118f FINDING src/server.ts:1 file comment learn=none: Comment accuracy; not mechanically checkable.
2026-11-22T15:48:29Z s=dcdb118f FINDING README.md:3 B01/P learn=none: Human-chosen product wording; not mechanically checkable.
2026-11-22T21:44:39Z s=dcdb118f FINDING tests/daemon.ts:37 start learn=none: Test-harness isolation; the e2e already strips the variable from the daemon env.
2026-11-22T21:44:39Z s=dcdb118f FINDING README.md:89 B01/P learn=none: Wording precision; not mechanically checkable.
2026-11-22T21:44:39Z s=dcdb118f FINDING ARCH.md Scheduling P learn=none: Wording precision; not mechanically checkable.
2026-11-22T21:44:39Z s=dcdb118f FINDING package.json:56 defuss-scheduler file:../defuss-scheduler learn=none: Depends on a human release decision for defuss-scheduler.
2026-11-23T21:01:51Z s=dcdb118f FINDING ARCH.md:10, ARCH.md:68 B01/P learn=none: VERIFIED: wording against an upstream document; no rule kind can check it.
2026-11-23T21:01:51Z s=dcdb118f FINDING src/tools.ts:446 schedulerTools history comment learn=none: VERIFIED: comment wording against an upstream document; no rule kind can check it.
2026-11-23T23:02:25Z s=dcdb118f FINDING ARCH.md:8, ARCH.md:20, ARCH.md:36, src/client.ts:1, src/services.ts:1 learn=none: VERIFIED: version wording against upstream source; no rule kind can check it.
2026-11-24T18:07:50Z s=dcdb118f FINDING src/server.ts listen, listener address check learn=none: VERIFIED: defuss-serve binds the configured 127.0.0.1, so no test can make the address differ; lsof in the packed-consumer test checks the listener.
2026-11-24T18:07:50Z s=dcdb118f FINDING tests/scheduler.test.ts worker test learn=none: VERIFIED: not reproduced in 33 runs, so neither the cause nor a fix is established.
2026-11-24T19:30:26Z s=dcdb118f FINDING src/telemetry.ts:onExportError learn=none: VERIFIED: a test would need a refused OTLP endpoint and stderr capture of an in-process daemon, which pins log text rather than behavior.
2026-11-24T19:30:26Z s=dcdb118f FINDING src/telemetry.ts:quiet learn=none: VERIFIED: reproducing it needs a handler that outlives the 3 s drain; the guard is one try/catch at the only write sites.
2026-11-24T19:30:26Z s=dcdb118f FINDING tests/scheduler.test.ts worker test learn=none: VERIFIED: not reproduced, so neither the cause nor a fix is established.
2026-11-24T20:03:40Z s=dcdb118f FINDING defuss-rpc console lines learn=none: VERIFIED: an upstream hook is needed; README and ARCH say these lines reach stdout and stderr only.
2026-11-24T21:11:49Z s=dcdb118f FINDING src/callbacks.ts security boundary learn=none: VERIFIED: ARCH.md security section states the boundary; the tests cover rejection.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:13 P07 learn=none: VERIFIED: a one-off wording defect in a plan page; no mechanical recurrence check fits.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:17 B01 learn=none: VERIFIED: claim narrowed to its evidence.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:21 B01 learn=none: VERIFIED: attribution corrected.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:27 B01 learn=none: VERIFIED: claim now carries its evidence.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:50 B01 and Ponytail learn=none: VERIFIED: unmeasured optimization marked as hypothesis.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:124 correctness learn=none: VERIFIED: redundant asset removed from the plan.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:23 B09 learn=none: VERIFIED: version pinned to the project's own pin.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:159 B01 learn=none: VERIFIED: sources added.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:152 P07 learn=none: VERIFIED: modality made explicit.
2026-11-24T22:31:46Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:41 B01 learn=none: VERIFIED: the plan now states the probed contract; M3's MCP test will exercise it.
2026-11-24T22:39:46Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:20,32,43 B09 learn=none: VERIFIED: plan text aligned with the upstream state.
2026-11-25T00:34:14Z s=dcdb118f FINDING src/client.ts:1 and ARCH.md:8 (reuse decision) learn=none: VERIFIED: the rationale now matches observed behaviour of the released versions.
2026-11-25T00:34:14Z s=dcdb118f FINDING ARCH.md:45 B09 learn=none: VERIFIED: claim removed with its basis.
2026-11-25T00:34:14Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:20,21,41-43 B09 learn=none: VERIFIED: plan facts match npm.
2026-11-25T01:42:45Z s=dcdb118f FINDING ARCH.md:8 B01 (own claim corrected) learn=none: VERIFIED: claim narrowed to the probe result.
2026-11-25T01:42:45Z s=dcdb118f FINDING tests/client.test.ts:28 learn=none: VERIFIED: matches the error table.
2026-11-25T01:42:45Z s=dcdb118f FINDING src/client.ts connect cost learn=none: VERIFIED: accepted cost; a context API exposing its cached schema would remove it.
2026-11-25T02:59:17Z s=dcdb118f FINDING src/client.ts VFS upload (own earlier claim) learn=none: VERIFIED: read the code.
2026-11-25T02:59:17Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:42 B01 learn=none: VERIFIED: probe repeated on the named versions.
2026-11-25T04:57:07Z s=dcdb118f FINDING examples/linear-clone/Makefile:setup (plan decision 3) learn=none: VERIFIED: rm -rf node_modules deps && make setup passes; plan decision 3 updated.
2026-11-25T04:57:07Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md B01 (own earlier claim) learn=none: VERIFIED: stat inode comparison.
2026-11-25T04:57:07Z s=dcdb118f FINDING .vae/VERIFY.py:linear-clone.verify (plan decision 4) learn=none: VERIFIED: the gate executes the rule.
2026-11-25T04:57:07Z s=dcdb118f FINDING examples/linear-clone/package.json learn=none: VERIFIED: package check VERIFIED in vae.py verify --json.
2026-11-25T04:57:07Z s=dcdb118f FINDING examples/linear-clone/Makefile recipes (runtime) learn=none: UNKNOWN: whether recipes should run through mise exec; not requested.
2026-11-25T04:57:07Z s=dcdb118f FINDING examples/linear-clone/Makefile:2 and .env.example (own claim corrected) learn=none: VERIFIED: probe outputs K1..K9 recorded; documentation corrected.
2026-11-25T05:19:11Z s=dcdb118f FINDING Makefile:test|coverage, package.json:scripts.test (root) learn=none: VERIFIED: bun test ./tests lists no examples/ file.
2026-11-25T05:19:11Z s=dcdb118f FINDING examples/linear-clone/input/seed.json learn=none: VERIFIED: counts printed by the extraction and checked by the seed test.
2026-11-25T05:53:40Z s=dcdb118f FINDING examples/linear-clone/src/web/index.html + tracker.css learn=none: VERIFIED: extraction counts printed; screenshots of list, issue page, cycles and inbox show live data.
2026-11-25T05:53:40Z s=dcdb118f FINDING examples/linear-clone/src/web/views/cycles.ts learn=none: VERIFIED: the cycles screenshot shows 15 scope, 8 started, 3 completed, 9 of 14 days left.
2026-11-25T06:13:53Z s=dcdb118f FINDING examples/linear-clone/src/web/views/issue.tsx:star learn=none: VERIFIED: rendered from store.starred; no persistence was ever specified (scaffold shows only a toast).
2026-11-25T06:19:11Z s=dcdb118f FINDING examples/linear-clone/scripts/bench.ts learn=none: VERIFIED: make bench writes output/bench.json (p50 15.29 ms, p95 18.6 ms); pgrep finds no daemon afterwards.
2026-11-25T06:19:11Z s=dcdb118f FINDING examples/linear-clone/scripts/metrics.ts learn=none: VERIFIED: printed backplane_operation_duration lines against a throwaway daemon.
2026-11-25T06:19:11Z s=dcdb118f FINDING examples/linear-clone/Makefile:start/status/log/stop learn=none: VERIFIED: command output in this session.
2026-11-25T06:19:11Z s=dcdb118f FINDING examples/linear-clone/ARCH.md claims learn=none: VERIFIED: workspace.ts audit calls, core/digest.ts filter, defuss-mcp dist/http line 40.
2026-11-25T06:19:11Z s=dcdb118f FINDING examples/linear-clone/README.md startup claim learn=none: VERIFIED: test names in tests/cli.test.ts.
2026-11-25T06:19:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md learn=none: VERIFIED: gate verify step VERIFIED in this run.
2026-11-26T05:52:52Z s=dcdb118f FINDING examples/linear-clone/package.json learn=none: VERIFIED: node_modules versions read after bun install; scripts/build.ts line 9 reads node_modules/defuss-shadcn/dist.
2026-11-26T05:52:52Z s=dcdb118f FINDING examples/linear-clone/src/server/server.ts:upload guard learn=none: VERIFIED: only comment lines changed (git diff).
2026-11-26T05:52:52Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:95,121,135,164,166 B/P learn=none: VERIFIED: vae.py prose on the page reported findings=0.
2026-11-26T06:03:00Z s=dcdb118f FINDING package.json:dependencies.defuss-rpc learn=none: VERIFIED: git diff c2951b6 17650b1 -- src/server.ts in defuss-rpc; ARCH.md line 45.
2026-11-26T06:03:00Z s=dcdb118f FINDING src/client.ts:1 learn=none: VERIFIED: gate test step ran tests/client.test.ts on defuss-rpc 4.4.0.
2026-11-26T06:03:00Z s=dcdb118f FINDING examples/linear-clone/output/e2e.json learn=none: VERIFIED: gate verify step VERIFIED in this run.
2026-11-26T06:03:00Z s=dcdb118f FINDING ARCH.md:8,45 CHANGELOG.md:5 plans:20,44,95 B/P learn=none: VERIFIED: vae.py prose on the three pages reported findings=0.
2026-11-26T06:18:41Z s=dcdb118f FINDING Makefile:start learn=none: VERIFIED: fresh-clone probes: start without .env exits 2 with the message; setup prints 'created .env with a new API_KEY', -rw-------, 64 hex; start then runs; 
2026-11-26T06:18:41Z s=dcdb118f FINDING examples/linear-clone/Makefile:.env learn=none: VERIFIED: fresh-clone probes: example start without .env exits 2 with the message; .env alone creates both files with matching keys; setup then start serves htt
2026-11-26T06:18:41Z s=dcdb118f FINDING examples/linear-clone tests with .env present learn=none: VERIFIED: fresh clone with both .env files: example make test 69 pass, root make test 41 pass.
2026-11-26T06:18:41Z s=dcdb118f FINDING scripts/consumer-scheduler.ts:record learn=none: VERIFIED: the CI diff shows only planner fields changed; defuss-scheduler dist types define ScheduleRecord = Omit<Schedule, nextDue|lastProcessed|lastSkipped>; 
2026-11-26T06:18:41Z s=dcdb118f FINDING README.md:305 examples/linear-clone/README.md:7-24 B/P learn=none: VERIFIED: vae.py prose on both pages reported findings=0.
2026-11-26T06:51:18Z s=dcdb118f FINDING Makefile, examples/linear-clone/Makefile learn=none: VERIFIED: grep for running pid / make start|status|log callers found none; make help lists the verbs.
2026-11-26T07:13:58Z s=dcdb118f FINDING mise.toml, package.json:devDependencies.oxlint learn=none: VERIFIED: mise install fetched oxlint-aarch64-apple-darwin; mise exec -- oxlint --version printed 1.94.0; bun install changed only the workspace pin in bun.lock
2026-11-26T07:13:58Z s=dcdb118f FINDING scripts/e2e.ts, scripts/consumer-mcp.ts, scripts/consumer.ts, scripts/consumer-scheduler.ts learn=none: VERIFIED: make e2e passes; the summary assert checks name, url with the e2e port, headers and path.
2026-11-26T07:58:59Z s=dcdb118f FINDING README.md, ARCH.md, examples/linear-clone/README.md, examples/linear-clone/ARCH.md, plans/2026-11-26_07-23_deep-e2e-tenant.md learn=none: VERIFIED: vae.py prose --fix pages=5 findings=0; each claim is backed by a run or test named above.
2026-11-26T08:04:15Z s=dcdb118f FINDING README.md:Apps, tenants and buckets, README.md:Services learn=none: VERIFIED: each claim restates a fact the README already documents (TTL, 1,000-row queries, 1 MiB calls and streaming, /files ranges, app and tenant logs, _rpc c
2026-11-26T08:08:14Z s=dcdb118f FINDING README.md:Apps, tenants and buckets, README.md:Services, ARCH.md, examples/linear-clone/ARCH.md learn=none: VERIFIED: each claim restates a fact the README already documents (TTL, 1,000-row queries, 1 MiB calls and streaming, /files ranges, app and tenant logs, _rpc c
2026-11-26T09:46:47Z s=dcdb118f FINDING README.md:Plain defuss-rpc, ARCH.md learn=none: VERIFIED: each sentence restates the code above and the client test; vae.py prose findings=0.
2026-11-26T11:12:00Z s=dcdb118f FINDING scripts/deep/scheduler.ts, README.md:RPC callbacks, ARCH.md, examples/linear-clone/ARCH.md learn=none: VERIFIED: the packed e2e ran the deep suite (its scheduler step's callback was delivered); vae.py prose findings=0.
2026-11-26T12:04:25Z s=dcdb118f FINDING plans/2026-11-26_12-00_defuss-auth-service.md learn=none: VERIFIED: the probes ran on 2026-11-26 (tmp scripts deleted, no vae:probe lines left); the cited lines were read in this session; vae.py prose findings=0.
2026-11-26T13:11:56Z s=dcdb118f FINDING src/callbacks.ts:callbackTokens, src/callbacks.ts:call learn=test: VERIFIED: tests/callbacks.test.ts: no Authorization reaches the app, the token verifies during the call and not after. tests/bots.test.ts: another app's bot get
2026-11-26T13:11:56Z s=dcdb118f FINDING src/config.ts:authMasterKey, Makefile:env, Makefile:bot, scripts/service.ts:bot, scripts/service.ts:scheme, .env.example learn=test: VERIFIED: tests/auth.test.ts (unset and malformed keys); tests/service.test.ts 6 pass, with the bot verb against a throwaway server (request shape, the UNAVAILA
2026-11-26T13:11:56Z s=dcdb118f FINDING src/client.ts:connectBackplane, src/client.ts:auth.proxy, src/api.ts:BackplaneApi, src/errors.ts, src/faults.ts:AUTH_CODES learn=test: VERIFIED: tests/auth.test.ts uses auth.proxy() for every proxy; the packed consumer type-checks and runs it; make lint passes.
2026-11-26T13:11:56Z s=dcdb118f FINDING package.json, bun.lock learn=test: VERIFIED: make e2e failed with the runtime dependency (consumer.ts asserts that the ML packages do not resolve) and passed with the bundle.
2026-11-26T13:11:56Z s=dcdb118f FINDING scripts/e2e.ts, scripts/consumer-auth.ts, scripts/consumer-scheduler.ts, scripts/deep/auth.ts, scripts/deep/run.ts, scripts/deep/kit.ts, scripts/deep/drivers.ts, scripts/deep/scheduler.ts learn=test: VERIFIED: make e2e exit 0; deep PASS 105 steps, 0 failed, 0 gaps; auth passed for auth-node-first, auth-bun-second and auth-node-last.
2026-11-26T13:11:56Z s=dcdb118f FINDING tests/auth.test.ts, tests/bots.test.ts, tests/callbacks.test.ts, tests/daemon.ts, tests/service.test.ts learn=test: VERIFIED: bun test 60+ pass; the trustedProxies mutation fails the rate-key test.
2026-11-26T13:11:56Z s=dcdb118f FINDING examples/linear-clone/src/server/identity.ts, examples/linear-clone/src/server/server.ts, examples/linear-clone/src/server/api.ts, examples/linear-clone/src/server/jobs.ts:jobsGuard, examples/linear-clone/src/core/faults.ts, examples/linear-clone/src/core/model.ts learn=test: VERIFIED: tests/auth.test.ts 3 pass: 401 without a credential and for the bot key, a comment's author is the signed-in person, refresh via the cookie, an accoun
2026-11-26T13:11:56Z s=dcdb118f FINDING examples/linear-clone/src/server/workspace.ts:members, examples/linear-clone/src/server/admin.ts, examples/linear-clone/src/server/config.ts, examples/linear-clone/Makefile, examples/linear-clone/.env.example, examples/linear-clone/package.json, examples/linear-clone/bun.lock learn=test: VERIFIED: tests/cli.test.ts 4 pass (member from stdin, apikey, usage errors); tests/config.test.ts 18 pass; the lock check passes.
2026-11-26T13:11:56Z s=dcdb118f FINDING examples/linear-clone/src/web/session.ts, examples/linear-clone/src/web/client.ts, examples/linear-clone/src/web/main.tsx, examples/linear-clone/src/web/index.html, examples/linear-clone/src/web/tracker.css learn=test: VERIFIED: linear-clone make e2e PASS 54 checks: Chromium (a wrong password shows the error, the session resumes after a reload, log out shows the form and a rel
2026-11-26T13:11:56Z s=dcdb118f FINDING examples/linear-clone/scripts/e2e.ts, examples/linear-clone/scripts/e2e-api.ts, examples/linear-clone/scripts/e2e-deep.ts, examples/linear-clone/scripts/e2e-proc.ts, examples/linear-clone/scripts/deep.ts, examples/linear-clone/tests/api.test.ts, examples/linear-clone/tests/cli.test.ts, examples/linear-clone/tests/config.test.ts, examples/linear-clone/tests/helpers/daemon.ts, examples/linear-clone/tests/helpers/auth.ts, examples/linear-clone/tests/jobs.test.ts, examples/linear-clone/tests/auth.test.ts learn=test: VERIFIED: bun test 77+ pass in linear-clone; make e2e PASS 54.
2026-11-26T13:11:56Z s=dcdb118f FINDING README.md, ARCH.md, CHANGELOG.md, examples/linear-clone/README.md, examples/linear-clone/ARCH.md, plans/2026-11-26_12-00_defuss-auth-service.md, .vae/EPISODES.md learn=none: VERIFIED: vae.py prose findings=0 on every page.
2026-11-26T13:17:03Z s=dcdb118f DONE fp=c399219c8c6d cov=92.5% paths=ARCH.md,CHANGELOG.md,Makefile,README.md(+60)
2026-11-26T13:17:03Z s=dcdb118f FINDING plans/2026-11-26_13-14_scheduler-jobs.md learn=none: VERIFIED: vae.py prose findings=0; the cited lines were read on 2026-11-26.
2026-11-26T14:11:18Z s=dcdb118f FAIL tests.e2e.1
2026-11-26T14:17:08Z s=dcdb118f DONE fp=a3cc610645a0 cov=92.5% paths=ARCH.md,CHANGELOG.md,Makefile,README.md(+68)
2026-11-26T14:17:08Z s=dcdb118f FINDING src/tools.ts:authTools, src/tools.ts:Adapter, src/auth.ts:status, src/auth.ts:members, src/client.ts:auth.status, src/client.ts:members learn=test: VERIFIED: tests/auth.test.ts 5 pass. MCP status before and after configure; pages of 2 skip the other tenant's account and end with next null, which shows that 
2026-11-26T14:17:08Z s=dcdb118f FINDING scripts/consumer.ts, scripts/consumer-equivalence.ts, scripts/consumer-revisions.ts, scripts/consumer-scheduler.ts, scripts/deep/auth.ts, scripts/deep/drivers.ts:mcpTool, scripts/deep/run.ts learn=test: VERIFIED: make e2e passed in the gate run; output/deep.json has 106 steps, 0 failed and 0 gaps; the equivalence check asserts that every listed tool ran.
2026-11-26T14:17:08Z s=dcdb118f FINDING Makefile:env, scripts/master-key.ts, tests/setup.test.ts learn=test: VERIFIED: tests/setup.test.ts covers the new .env (32-byte base64url key, mode 600), a rerun that changes nothing, an old .env that gains the key, and an empty 
2026-11-26T14:17:08Z s=dcdb118f FINDING examples/linear-clone/src/server/admin.ts:bot, examples/linear-clone/Makefile:setup, examples/linear-clone/Makefile:bot, examples/linear-clone/tests/cli.test.ts, examples/linear-clone/tests/helpers/daemon.ts learn=test: VERIFIED: tests/cli.test.ts 5 pass. Its own daemon: the first run rotates the helper's bot, keeps the other .env lines and mode 600, the new key works and the o
2026-11-26T14:17:08Z s=dcdb118f FINDING README.md, ARCH.md, CHANGELOG.md, examples/linear-clone/README.md learn=none: VERIFIED: vae.py prose findings=0; package.json devDependencies list defuss-auth 0.2.0 and defuss-db 3.3.0.
