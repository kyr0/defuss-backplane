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
2026-11-24T21:11:49Z s=dcdb118f FINDING src/callbacks.ts:call result learn=test: VERIFIED: tests/callbacks.test.ts expects {status:200,result:{ok:true}}.
2026-11-24T21:11:49Z s=dcdb118f FINDING src/scheduler.ts:schedulerApi claim learn=test: VERIFIED: tests/callbacks.test.ts covers the reserved handler, the bad URLs and the worker claim.
2026-11-24T21:11:49Z s=dcdb118f FINDING src/callbacks.ts security boundary learn=none: VERIFIED: ARCH.md security section states the boundary; the tests cover rejection.
2026-11-24T21:11:49Z s=dcdb118f FINDING tests/scheduler.test.ts:'schedules are shared by RPC and MCP, and the client queue runs a worker' learn=test: VERIFIED: the test itself now cannot see a pre-edit run; 5 consecutive runs passed.
2026-11-24T22:27:56Z s=dcdb118f DONE fp=99ab5cc09bff cov=98.0% paths=plans/2026-11-24_22-24_linear-clone-example.md
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:13 P07 learn=none: VERIFIED: a one-off wording defect in a plan page; no mechanical recurrence check fits.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:17 B01 learn=none: VERIFIED: claim narrowed to its evidence.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:21 B01 learn=none: VERIFIED: attribution corrected.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:27 B01 learn=none: VERIFIED: claim now carries its evidence.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:50 B01 and Ponytail learn=none: VERIFIED: unmeasured optimization marked as hypothesis.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:124 correctness learn=none: VERIFIED: redundant asset removed from the plan.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:23 B09 learn=none: VERIFIED: version pinned to the project's own pin.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:159 B01 learn=none: VERIFIED: sources added.
2026-11-24T22:27:56Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:152 P07 learn=none: VERIFIED: modality made explicit.
2026-11-24T22:31:46Z s=dcdb118f DONE fp=cc82a7f6d8ca cov=98.0% paths=plans/2026-11-24_22-24_linear-clone-example.md
2026-11-24T22:31:46Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:41 B01 learn=none: VERIFIED: the plan now states the probed contract; M3's MCP test will exercise it.
2026-11-24T22:39:46Z s=dcdb118f DONE fp=d80e7140c518 cov=98.0% paths=plans/2026-11-24_22-24_linear-clone-example.md
2026-11-24T22:39:46Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:20,32,43 B09 learn=none: VERIFIED: plan text aligned with the upstream state.
2026-11-25T00:34:14Z s=dcdb118f DONE fp=1870a7af1824 cov=98.0% paths=ARCH.md,CHANGELOG.md,bun.lock,package.json(+2)
2026-11-25T00:34:14Z s=dcdb118f FINDING package.json dependencies learn=test: VERIFIED: the existing suite and e2e exercise every route, MCP tool and RPC module on the new versions.
2026-11-25T00:34:14Z s=dcdb118f FINDING src/client.ts:1 and ARCH.md:8 (reuse decision) learn=none: VERIFIED: the rationale now matches observed behaviour of the released versions.
2026-11-25T00:34:14Z s=dcdb118f FINDING ARCH.md:45 B09 learn=none: VERIFIED: claim removed with its basis.
2026-11-25T00:34:14Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:20,21,41-43 B09 learn=none: VERIFIED: plan facts match npm.
2026-11-25T01:42:45Z s=dcdb118f DONE fp=54dc84de7de1 cov=98.0% paths=ARCH.md,CHANGELOG.md,bun.lock,package.json(+3)
2026-11-25T01:42:45Z s=dcdb118f FINDING src/client.ts:connectBackplane learn=test: VERIFIED: tests/client.test.ts adds the isolation, wrong-key and redirect contracts; the existing suite covers every module through the client.
2026-11-25T01:42:45Z s=dcdb118f FINDING src/client.ts redirect guard (security) learn=test: VERIFIED: 'a call answered with a redirect fails, so its arguments never reach another address' fails without the guard.
2026-11-25T01:42:45Z s=dcdb118f FINDING ARCH.md:8 B01 (own claim corrected) learn=none: VERIFIED: claim narrowed to the probe result.
2026-11-25T01:42:45Z s=dcdb118f FINDING tests/client.test.ts:28 learn=none: VERIFIED: matches the error table.
2026-11-25T01:42:45Z s=dcdb118f FINDING src/client.ts connect cost learn=none: VERIFIED: accepted cost; a context API exposing its cached schema would remove it.
2026-11-25T02:59:17Z s=dcdb118f DONE fp=41e758ab1c76 cov=98.0% paths=ARCH.md,CHANGELOG.md,bun.lock,package.json(+3)
2026-11-25T02:59:17Z s=dcdb118f FINDING src/client.ts:createRpcContext fetch learn=test: VERIFIED: tests/client.test.ts covers calls and the schema request.
2026-11-25T02:59:17Z s=dcdb118f FINDING src/client.ts:getRpcClient({ schema }) learn=test: VERIFIED: 'a connection sends one schema request and refuses a redirected one'.
2026-11-25T02:59:17Z s=dcdb118f FINDING src/client.ts VFS upload (own earlier claim) learn=none: VERIFIED: read the code.
2026-11-25T02:59:17Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md:42 B01 learn=none: VERIFIED: probe repeated on the named versions.
2026-11-25T02:59:17Z s=dcdb118f FINDING package.json learn=test: VERIFIED: the suite and e2e cover every client path.
2026-11-25T04:57:07Z s=dcdb118f DONE fp=fc0e7b7cf383 cov=98.0% paths=examples/linear-clone/Makefile,examples/linear-clone/bun.lock,examples/linear-clone/bunfig.toml,examples/linear-clone/package.json(+4)
2026-11-25T04:57:07Z s=dcdb118f FINDING examples/linear-clone/Makefile:setup (plan decision 3) learn=none: VERIFIED: rm -rf node_modules deps && make setup passes; plan decision 3 updated.
2026-11-25T04:57:07Z s=dcdb118f FINDING plans/2026-11-24_22-24_linear-clone-example.md B01 (own earlier claim) learn=none: VERIFIED: stat inode comparison.
2026-11-25T04:57:07Z s=dcdb118f FINDING .vae/VERIFY.py:linear-clone.verify (plan decision 4) learn=none: VERIFIED: the gate executes the rule.
2026-11-25T04:57:07Z s=dcdb118f FINDING examples/linear-clone/src/server/config.ts:loadConfig learn=test: VERIFIED: tests/config.test.ts covers defaults, every key of .env.example, empty values and each invalid value; 100 % lines.
2026-11-25T04:57:07Z s=dcdb118f FINDING examples/linear-clone/package.json learn=none: VERIFIED: package check VERIFIED in vae.py verify --json.
2026-11-25T04:57:07Z s=dcdb118f FINDING examples/linear-clone/Makefile recipes (runtime) learn=none: UNKNOWN: whether recipes should run through mise exec; not requested.
2026-11-25T04:57:07Z s=dcdb118f FINDING examples/linear-clone/Makefile:2 and .env.example (own claim corrected) learn=none: VERIFIED: probe outputs K1..K9 recorded; documentation corrected.
2026-11-25T05:05:59Z s=dcdb118f DONE fp=4c24fca2ed89 cov=98.5% paths=examples/linear-clone/src/core/dates.ts,examples/linear-clone/src/core/digest.ts,examples/linear-clone/src/core/ids.ts,examples/linear-clone/src/core/issue.ts(+4)
2026-11-25T05:05:59Z s=dcdb118f FINDING examples/linear-clone/src/core/issue.ts:validateDraft|validatePatch learn=test: VERIFIED: tests/core.test.ts drafts and patches cover each field's error path.
2026-11-25T05:05:59Z s=dcdb118f FINDING examples/linear-clone/src/core/issue.ts:applyPatch learn=test: VERIFIED: tests cover done, reopen and no-op patches.
2026-11-25T05:05:59Z s=dcdb118f FINDING examples/linear-clone/src/core/stats.ts:cycleStats learn=test: VERIFIED: tests match the scaffold's formulas with real values.
2026-11-25T05:05:59Z s=dcdb118f FINDING examples/linear-clone/src/core/digest.ts:dueDigest learn=test: VERIFIED: tests cover done, unassigned and future issues.
2026-11-25T05:05:59Z s=dcdb118f FINDING examples/linear-clone/src/core/rollover.ts:planRollover learn=test: VERIFIED: tests cover running, ended, reused and repeated cases.
2026-11-25T05:05:59Z s=dcdb118f FINDING examples/linear-clone/src/core/dates.ts learn=test: VERIFIED: tests check Berlin and Los Angeles around midnight UTC.
2026-11-25T05:14:22Z s=dcdb118f FAIL tests.unit,linear-clone.verify
2026-11-25T05:19:11Z s=dcdb118f DONE fp=8d764a2b4d1d cov=98.0% paths=Makefile,examples/linear-clone/Makefile,examples/linear-clone/bun.lock,examples/linear-clone/input/seed.json(+12)
2026-11-25T05:19:11Z s=dcdb118f FINDING Makefile:test|coverage, package.json:scripts.test (root) learn=none: VERIFIED: bun test ./tests lists no examples/ file.
2026-11-25T05:19:11Z s=dcdb118f FINDING examples/linear-clone/src/server/workspace.ts:events.list learn=test: VERIFIED: three consecutive runs of the suite pass with the fixed clock.
2026-11-25T05:19:11Z s=dcdb118f FINDING examples/linear-clone/src/server/workspace.ts:nextNumber learn=test: VERIFIED: tests/workspace.test.ts.
2026-11-25T05:19:11Z s=dcdb118f FINDING examples/linear-clone/src/server/workspace.ts:issues.update learn=test: VERIFIED: stale-revision test.
2026-11-25T05:19:11Z s=dcdb118f FINDING examples/linear-clone/src/server/workspace.ts:seed learn=test: VERIFIED: seed tests, including deletion before a second seed.
2026-11-25T05:19:11Z s=dcdb118f FINDING examples/linear-clone/src/server/workspace.ts:cycles.stats learn=test: VERIFIED: the test reads the cache through a second client.
2026-11-25T05:19:11Z s=dcdb118f FINDING examples/linear-clone/src/server/workspace.ts:issues.remove learn=test: VERIFIED: removal test sees events and the attachment gone.
2026-11-25T05:19:11Z s=dcdb118f FINDING examples/linear-clone/src/server/log.ts:createLog learn=test: VERIFIED: tests/log.test.ts and the workspace log test read the record back.
2026-11-25T05:19:11Z s=dcdb118f FINDING examples/linear-clone/input/seed.json learn=none: VERIFIED: counts printed by the extraction and checked by the seed test.
2026-11-25T05:19:11Z s=dcdb118f FINDING examples/linear-clone/tests/helpers/daemon.ts learn=test: VERIFIED: every workspace test runs against it.
2026-11-25T05:32:54Z s=dcdb118f FAIL linear-clone.verify
2026-11-25T05:34:36Z s=dcdb118f DONE fp=b82c3015000f cov=98.0% paths=examples/linear-clone/bun.lock,examples/linear-clone/package.json,examples/linear-clone/src/core/faults.ts,examples/linear-clone/src/core/issue.ts(+10)
2026-11-25T05:34:36Z s=dcdb118f FINDING examples/linear-clone/src/core/faults.ts + src/server/server.ts:withStatus learn=test: VERIFIED: tests/api.test.ts asserts status and code for every method's main error, and the MCP error text.
2026-11-25T05:34:36Z s=dcdb118f FINDING examples/linear-clone/src/server/server.ts:upload guard (upstream root cause) learn=test: VERIFIED: four consecutive suite runs without the error; defuss-rpc src/upload.test.ts covers the root cause.
2026-11-25T05:34:36Z s=dcdb118f FINDING examples/linear-clone/src/server/server.ts:download handler learn=test: VERIFIED: tests for 'no-slash' and 'ENG-141/../x' answer 404; five runs pass.
2026-11-25T05:34:36Z s=dcdb118f FINDING examples/linear-clone/src/server/server.ts:uploadIdOf learn=test: VERIFIED: the round-trip test uploads with uploadIdOf and downloads byte for byte.
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
