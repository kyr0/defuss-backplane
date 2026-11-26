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
2026-11-26T07:13:58Z s=dcdb118f FINDING examples/linear-clone/scripts/e2e-api.ts learn=test: VERIFIED: mutation probe (title unmasked) passed before the fix and fails at Issues.create after it; make e2e passes 3 rpc+mcp checks with all 13 tools called.
2026-11-26T07:13:58Z s=dcdb118f FINDING examples/linear-clone/src/server/api.ts:cycleRef,itemIds learn=test: VERIFIED: the e2e service log showed 'call failed method=Cycles.stats error=BackplaneError: Invalid document ID'; tests/api.test.ts asserts 400 INVALID_INPUT(id
2026-11-26T07:13:58Z s=dcdb118f FINDING examples/linear-clone/scripts/e2e-coverage.ts, scripts/e2e.ts, package.json:monocart-coverage-reports learn=test: VERIFIED: make e2e: lines 89.06 %, functions 90.06 %, branches 65.65 % over 13 files, check passes; coverage-summary.json and index.html written.
2026-11-26T07:58:59Z s=dcdb118f DONE fp=7b7c17d75323 cov=92.0% paths=ARCH.md,Makefile,README.md,bun.lock(+42)
2026-11-26T07:58:59Z s=dcdb118f FINDING scripts/deep/run.ts, scripts/deep/drivers.ts, scripts/deep/kit.ts learn=test: VERIFIED: make e2e ran 97 steps with 0 failed and gaps []; earlier partial runs listed real gaps (db.getVersioned id.bigint, listRuns cursor/ref), which the sce
2026-11-26T07:58:59Z s=dcdb118f FINDING scripts/deep/cache.ts, scripts/deep/db.ts, scripts/deep/logs.ts, scripts/deep/scheduler.ts, scripts/deep/vfs.ts learn=test: VERIFIED: each scenario passed on both transports against a scratch daemon and in make e2e; the logs page step failed while it asserted write order and passes a
2026-11-26T07:58:59Z s=dcdb118f FINDING scripts/deep/http.ts learn=test: VERIFIED: passes in make e2e; it found the missing scheduler counter and the plain-text listener 404, now documented.
2026-11-26T07:58:59Z s=dcdb118f FINDING scripts/deep/big.ts learn=test: VERIFIED: output/deep.json upload 9.06 s, downloads 0.41-0.63 s, RSS growth 6/5/0/0 MiB; against the live daemon 65 MiB peak, still under the 128 MiB bound.
2026-11-26T07:58:59Z s=dcdb118f FINDING scripts/deep/video.ts, input/video.webm, Makefile:fixtures, .gitignore, package.json:playwright-core, Makefile:setup learn=test: VERIFIED: with a 130 KB clip Chromium read everything with one bytes=0- request at full speed and at 40 KB/s; with the 4.2 MB clip at 200 KB/s the seek opened a
2026-11-26T07:58:59Z s=dcdb118f FINDING src/server.ts:bounded learn=test: VERIFIED by probe: before, 4 of 10 clients sending 4 MiB saw EPIPE; after, 50 of 50 across 1 MiB+1 KiB, 4, 12, 20 and 64 MiB got 413. The http scenario repeats 
2026-11-26T07:58:59Z s=dcdb118f FINDING src/telemetry.ts:schedulerFault, tests/o11y.test.ts learn=test: VERIFIED: tests/o11y.test.ts failed (length 0) before the fix and 5 pass after.
2026-11-26T07:58:59Z s=dcdb118f FINDING scripts/e2e.ts learn=test: VERIFIED: make e2e exit 0 with the deep entry PASS 97/0/0.
2026-11-26T07:58:59Z s=dcdb118f FINDING Makefile:e2e-live learn=test: VERIFIED: one run against the live daemon (old build) wrote output/deep-live.json and failed only the two defects fixed here; the daemon kept running.
2026-11-26T07:58:59Z s=dcdb118f FINDING examples/linear-clone/src/server/jobs.ts:upsertSchedules, examples/linear-clone/tests/jobs.test.ts learn=test: VERIFIED: the new jobs test failed with 'Schedule ID is reserved' before and 5 of 5 jobs tests pass after; two consecutive deep runs against one backplane pass.
2026-11-26T07:58:59Z s=dcdb118f FINDING examples/linear-clone/scripts/deep.ts learn=test: VERIFIED: 27 of 27 steps in make e2e, twice in a row against one scratch backplane, and once against the live backplane; the run results are {status, result} pe
2026-11-26T07:58:59Z s=dcdb118f FINDING examples/linear-clone/scripts/e2e-deep.ts, examples/linear-clone/scripts/deep-live.ts, examples/linear-clone/scripts/e2e-proc.ts, examples/linear-clone/scripts/e2e.ts, examples/linear-clone/Makefile:e2e-live learn=test: VERIFIED: linear-clone make e2e 51 checks 0 failed (coverage 89.06 %); make e2e-live PASS 27/0; afterwards make status showed the live backplane (86108) and app
2026-11-26T07:58:59Z s=dcdb118f FINDING README.md, ARCH.md, examples/linear-clone/README.md, examples/linear-clone/ARCH.md, plans/2026-11-26_07-23_deep-e2e-tenant.md learn=none: VERIFIED: vae.py prose --fix pages=5 findings=0; each claim is backed by a run or test named above.
2026-11-26T08:04:15Z s=dcdb118f DONE fp=d1afed0ff392 cov=92.0% paths=README.md
2026-11-26T08:04:15Z s=dcdb118f FINDING README.md:Apps, tenants and buckets, README.md:Services learn=none: VERIFIED: each claim restates a fact the README already documents (TTL, 1,000-row queries, 1 MiB calls and streaming, /files ranges, app and tenant logs, _rpc c
2026-11-26T08:08:14Z s=dcdb118f DONE fp=7ad5a6bb4e55 cov=92.0% paths=ARCH.md,README.md,examples/linear-clone/ARCH.md
2026-11-26T08:08:14Z s=dcdb118f FINDING README.md:Apps, tenants and buckets, README.md:Services, ARCH.md, examples/linear-clone/ARCH.md learn=none: VERIFIED: each claim restates a fact the README already documents (TTL, 1,000-row queries, 1 MiB calls and streaming, /files ranges, app and tenant logs, _rpc c
2026-11-26T08:12:15Z s=dcdb118f FAIL backplane.install
2026-11-26T08:23:14Z s=dcdb118f DONE fp=2e27372b3252 cov=91.8% paths=ARCH.md,Makefile,README.md,examples/linear-clone/ARCH.md(+7)
2026-11-26T08:23:14Z s=dcdb118f FINDING README.md, ARCH.md, examples/linear-clone/README.md, examples/linear-clone/ARCH.md learn=verifier: VERIFIED: all 14 linked repos exist and are public (gh api); no defuss version remains (regex scan); vae.py prose findings=0 on all four pages; the defuss-rpc c
2026-11-26T08:23:14Z s=dcdb118f FINDING Makefile:env, Makefile:health, Makefile:healthz, Makefile:metrics, Makefile:results, scripts/service.ts:probe, scripts/service.ts:metrics, tests/service.test.ts learn=test: VERIFIED: tests/service.test.ts 6 pass, the new test runs a real HTTP process: stopped refusal, 200 and 503 probes, filtered and full scrape, 401 without key, a
2026-11-26T08:23:14Z s=dcdb118f FINDING examples/linear-clone/src/server/server.ts:probes, examples/linear-clone/Makefile:health, examples/linear-clone/Makefile:healthz, examples/linear-clone/tests/api.test.ts, examples/linear-clone/scripts/deep.ts learn=test: VERIFIED: tests/api.test.ts 10 pass including a daemon stopped under a running app giving 503 while /livez stays 200; the gate's linear-clone verify ran make e2
