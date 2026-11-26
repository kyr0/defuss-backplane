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
2026-11-25T05:34:36Z s=dcdb118f FINDING examples/linear-clone/src/server/cli.ts learn=test: VERIFIED: tests/cli.test.ts spawns it in a temporary project directory.
2026-11-25T05:34:36Z s=dcdb118f FINDING examples/linear-clone/src/server/api.ts learn=test: VERIFIED: each method called once through the RPC client, the main error path asserted.
2026-11-25T05:34:36Z s=dcdb118f FINDING examples/linear-clone/src/server/config.ts:TIME_ZONE learn=test: VERIFIED: config tests.
2026-11-25T05:39:04Z s=dcdb118f DONE fp=4a1ff273c7c1 cov=98.0% paths=examples/linear-clone/src/server/api.ts,examples/linear-clone/src/server/config.ts,examples/linear-clone/src/server/jobs.ts,examples/linear-clone/src/server/server.ts(+4)
2026-11-25T05:39:04Z s=dcdb118f FINDING examples/linear-clone/src/server/jobs.ts:jobsGuard learn=test: VERIFIED: tests/jobs.test.ts checks anonymous, wrong key, the key, and the MCP tool list.
2026-11-25T05:39:04Z s=dcdb118f FINDING examples/linear-clone/src/server/jobs.ts:dueDigest learn=test: VERIFIED: repeated call test and the real delivery test.
2026-11-25T05:39:04Z s=dcdb118f FINDING examples/linear-clone/src/server/jobs.ts:cycleRollover learn=test: VERIFIED: rollover test with a moved app clock.
2026-11-25T05:39:04Z s=dcdb118f FINDING examples/linear-clone/src/server/jobs.ts:upsertSchedules + server.ts learn=test: VERIFIED: restart test checks URL, revision and the unchanged outcome.
2026-11-25T05:39:04Z s=dcdb118f FINDING examples/linear-clone/tests/jobs.test.ts (delivery) learn=test: VERIFIED: passes against the daemon child process.
2026-11-25T05:39:04Z s=dcdb118f FINDING examples/linear-clone/src/server/config.ts:DIGEST_CRON|ROLLOVER_CRON learn=test: VERIFIED: config tests.
2026-11-25T05:53:40Z s=dcdb118f DONE fp=b8cedf58d025 cov=98.0% paths=examples/linear-clone/Makefile,examples/linear-clone/bun.lock,examples/linear-clone/input/seed.json,examples/linear-clone/package.json(+27)
2026-11-25T05:53:40Z s=dcdb118f FINDING examples/linear-clone/src/web/index.html + tracker.css learn=none: VERIFIED: extraction counts printed; screenshots of list, issue page, cycles and inbox show live data.
2026-11-25T05:53:40Z s=dcdb118f FINDING examples/linear-clone/scripts/e2e.ts learn=test: VERIFIED: make e2e passes, 3 checks.
2026-11-25T05:53:40Z s=dcdb118f FINDING examples/linear-clone/src/core/issue.ts:startedAt learn=test: VERIFIED: core tests for start, keep and clear, and the burn-up's started column.
2026-11-25T05:53:40Z s=dcdb118f FINDING examples/linear-clone/src/core/seed.ts:shiftSeed ms learn=test: VERIFIED: workspace test expects Marco's comment 12 minutes before now.
2026-11-25T05:53:40Z s=dcdb118f FINDING examples/linear-clone/src/web/views/cycles.ts learn=none: VERIFIED: the cycles screenshot shows 15 scope, 8 started, 3 completed, 9 of 14 days left.
2026-11-25T05:53:40Z s=dcdb118f FINDING examples/linear-clone/src/web/main.ts learn=test: VERIFIED: routes pass in three browsers without console errors; interactions are covered by M7.
2026-11-25T05:53:40Z s=dcdb118f FINDING examples/linear-clone/src/core/stats.ts:currentCycle, src/core/ids.ts:uploadIdOf learn=test: VERIFIED: api and jobs tests pass.
2026-11-25T06:13:53Z s=dcdb118f DONE fp=2023d7cde4d3 cov=98.0% paths=examples/linear-clone/Makefile,examples/linear-clone/bun.lock,examples/linear-clone/package.json,examples/linear-clone/scripts/build.ts(+25)
2026-11-25T06:13:53Z s=dcdb118f FINDING examples/linear-clone/src/web (rendering) learn=verifier: VERIFIED: rule linear-clone.morph-rendering (not_regex over src/web) rejects hand-written DOM writes; grep finds none; e2e 20/20 passes.
2026-11-25T06:13:53Z s=dcdb118f FINDING examples/linear-clone/src/web/actions.ts:write learn=test: VERIFIED: the e2e step changes status, priority and assignee back to back and expects all three events and values after reload.
2026-11-25T06:13:53Z s=dcdb118f FINDING examples/linear-clone/src/web/views/inbox.tsx:data-unread learn=memory: VERIFIED: e2e inbox step passes; MEMORY line records the morph rule.
2026-11-25T06:13:53Z s=dcdb118f FINDING examples/linear-clone/src/web/tracker.css:.pm-projects learn=test: VERIFIED: e2e projects step sees 5 visible rows.
2026-11-25T06:13:53Z s=dcdb118f FINDING examples/linear-clone/scripts/e2e.ts:viewport learn=test: VERIFIED: drag and drop step passes and persists after reload.
2026-11-25T06:13:53Z s=dcdb118f FINDING examples/linear-clone/scripts/e2e.ts:probe 404 learn=test: VERIFIED: read in ../defuss-rpc src/client.ts and src/server.ts; the e2e attachment step passes.
2026-11-25T06:13:53Z s=dcdb118f FINDING examples/linear-clone/scripts/e2e.ts:create wait learn=test: VERIFIED: create passes in Chromium, Firefox and WebKit.
2026-11-25T06:13:53Z s=dcdb118f FINDING examples/linear-clone/src/web/icons.tsx learn=test: VERIFIED: e2e routes step fails on any leftover i[data-lucide]; build log sizes.
2026-11-25T06:13:53Z s=dcdb118f FINDING examples/linear-clone/src/web/views/issue.tsx:star learn=none: VERIFIED: rendered from store.starred; no persistence was ever specified (scaffold shows only a toast).
2026-11-25T06:13:53Z s=dcdb118f FINDING examples/linear-clone/Makefile + .vae/VERIFY.py learn=verifier: VERIFIED: gate verify passed with the widened rule.
2026-11-25T06:19:11Z s=dcdb118f DONE fp=d07623fd1f88 cov=98.0% paths=README.md,examples/linear-clone/ARCH.md,examples/linear-clone/Makefile,examples/linear-clone/README.md(+4)
2026-11-25T06:19:11Z s=dcdb118f FINDING examples/linear-clone/scripts/bench.ts learn=none: VERIFIED: make bench writes output/bench.json (p50 15.29 ms, p95 18.6 ms); pgrep finds no daemon afterwards.
2026-11-25T06:19:11Z s=dcdb118f FINDING examples/linear-clone/scripts/metrics.ts learn=none: VERIFIED: printed backplane_operation_duration lines against a throwaway daemon.
2026-11-25T06:19:11Z s=dcdb118f FINDING examples/linear-clone/Makefile:start/status/log/stop learn=none: VERIFIED: command output in this session.
2026-11-25T06:19:11Z s=dcdb118f FINDING examples/linear-clone/scripts/e2e.ts:comment draft learn=test: VERIFIED: make e2e 20/20 passes with the check.
2026-11-25T06:19:11Z s=dcdb118f FINDING examples/linear-clone/ARCH.md claims learn=none: VERIFIED: workspace.ts audit calls, core/digest.ts filter, defuss-mcp dist/http line 40.
2026-11-25T06:19:11Z s=dcdb118f FINDING examples/linear-clone/README.md startup claim learn=none: VERIFIED: test names in tests/cli.test.ts.
2026-11-25T06:19:56Z s=dcdb118f DONE fp=eaf77618e2fe cov=98.0% paths=plans/2026-11-24_22-24_linear-clone-example.md
2026-11-25T06:19:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md learn=none: VERIFIED: gate verify step VERIFIED in this run.
2026-11-26T05:52:52Z s=dcdb118f DONE fp=71101b770037 cov=98.0% paths=examples/linear-clone/bun.lock,examples/linear-clone/package.json,examples/linear-clone/scripts/e2e.ts,examples/linear-clone/src/server/server.ts(+1)
2026-11-26T05:52:52Z s=dcdb118f FINDING examples/linear-clone/package.json learn=none: VERIFIED: node_modules versions read after bun install; scripts/build.ts line 9 reads node_modules/defuss-shadcn/dist.
2026-11-26T05:52:52Z s=dcdb118f FINDING examples/linear-clone/scripts/e2e.ts:openPage learn=test: VERIFIED: gate e2e output/e2e.json at 2026-11-26T05:52:29Z has 20 of 20 checks passing, with the upload step, and no exception.
2026-11-26T05:52:52Z s=dcdb118f FINDING examples/linear-clone/src/server/server.ts:upload guard learn=none: VERIFIED: only comment lines changed (git diff).
2026-11-26T05:52:52Z s=dcdb118f FINDING .vae/MEMORY.md learn=memory: VERIFIED: grep finds no defuss-morph 0.3.0 pin in the repo after the bump.
2026-11-26T05:52:52Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:95,121,135,164,166 B/P learn=none: VERIFIED: vae.py prose on the page reported findings=0.
2026-11-26T06:03:00Z s=dcdb118f DONE fp=ccc77317d33f cov=98.0% paths=ARCH.md,CHANGELOG.md,bun.lock,examples/linear-clone/bun.lock(+3)
2026-11-26T06:03:00Z s=dcdb118f FINDING package.json:dependencies.defuss-rpc learn=none: VERIFIED: git diff c2951b6 17650b1 -- src/server.ts in defuss-rpc; ARCH.md line 45.
2026-11-26T06:03:00Z s=dcdb118f FINDING examples/linear-clone/bun.lock:defuss-backplane learn=verifier: VERIFIED: probe with the stale lock (frozen install exit 0, nested 4.3.0); rule linear-clone.backplane-lock runs .vae/checks/linear_clone_lock.py, which exits 1
2026-11-26T06:03:00Z s=dcdb118f FINDING src/client.ts:1 learn=none: VERIFIED: gate test step ran tests/client.test.ts on defuss-rpc 4.4.0.
2026-11-26T06:03:00Z s=dcdb118f FINDING examples/linear-clone/output/e2e.json learn=none: VERIFIED: gate verify step VERIFIED in this run.
2026-11-26T06:03:00Z s=dcdb118f FINDING ARCH.md:8,45 CHANGELOG.md:5 plans:20,44,95 B/P learn=none: VERIFIED: vae.py prose on the three pages reported findings=0.
