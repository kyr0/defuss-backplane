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
2026-11-23T21:01:51Z s=dcdb118f FINDING README.md:15, README.md:112, README.md:202, CHANGELOG.md:5 learn=verifier: VERIFIED: the same backplane.registry-deps rule removes the condition these sentences described.
2026-11-23T21:01:51Z s=dcdb118f FINDING src/tools.ts:446 schedulerTools history comment learn=none: VERIFIED: comment wording against an upstream document; no rule kind can check it.
2026-11-23T22:42:45Z s=dcdb118f DONE fp=8f3788b61aa2 cov=98.8% paths=ARCH.md,CHANGELOG.md,README.md,bun.lock(+14)
2026-11-23T22:42:45Z s=dcdb118f FINDING src/tools.ts:110 McpServer version, scripts/e2e.ts:27 and :331 learn=verifier: VERIFIED: rule backplane.version-sync in .vae/VERIFY.py fails when src/tools.ts or scripts/e2e.ts disagree with package.json; a probe with 0.2.9 in tools.ts mad
2026-11-23T23:02:25Z s=dcdb118f DONE fp=2ace88988c3b cov=98.8% paths=ARCH.md,CHANGELOG.md,bun.lock,package.json(+5)
2026-11-23T23:02:25Z s=dcdb118f FINDING src/server.ts listen close(), src/tools.ts makeTools learn=test: VERIFIED: tests/scheduler.test.ts 'two daemons in one process serve only their own functions and data' runs a scheduling and a plain daemon at once and checks s
2026-11-23T23:02:25Z s=dcdb118f FINDING ARCH.md:8, ARCH.md:20, ARCH.md:36, src/client.ts:1, src/services.ts:1 learn=none: VERIFIED: version wording against upstream source; no rule kind can check it.
2026-11-23T23:02:25Z s=dcdb118f FINDING scripts/e2e.ts npm install --prefer-offline learn=memory: VERIFIED: .vae/MEMORY.md line scoped to the e2e npm install records the refresh command.
2026-11-24T18:07:50Z s=dcdb118f DONE fp=3a7e1c0eb823 cov=98.5% paths=ARCH.md,CHANGELOG.md,README.md,bun.lock(+13)
2026-11-24T18:07:50Z s=dcdb118f FINDING src/client.ts download size, src/transfer.ts object/files headers learn=test: VERIFIED: the existing expect(read).toMatchObject(stored) in tests/http.test.ts now runs against defuss-serve on Bun and fails without x-size.
2026-11-24T18:07:50Z s=dcdb118f FINDING src/server.ts listen, listener address check learn=none: VERIFIED: defuss-serve binds the configured 127.0.0.1, so no test can make the address differ; lsof in the packed-consumer test checks the listener.
2026-11-24T18:07:50Z s=dcdb118f FINDING ARCH.md Security paragraph, upload abort claim learn=test: VERIFIED: the new test promises 4 MiB, sends 64 KiB, drops the socket and checks the old revision and a later upload.
2026-11-24T18:07:50Z s=dcdb118f FINDING tests/scheduler.test.ts worker test learn=none: VERIFIED: not reproduced in 33 runs, so neither the cause nor a fix is established.
2026-11-24T19:27:55Z s=aceaa8e2 FAIL prose
2026-11-24T19:30:26Z s=dcdb118f DONE fp=594bc62bc734 cov=98.0% paths=ARCH.md,CHANGELOG.md,README.md,bun.lock(+22)
2026-11-24T19:30:26Z s=dcdb118f FINDING src/telemetry.ts:onExportError learn=none: VERIFIED: a test would need a refused OTLP endpoint and stderr capture of an in-process daemon, which pins log text rather than behavior.
2026-11-24T19:30:26Z s=dcdb118f FINDING src/telemetry.ts:createTelemetry otlp learn=verifier: VERIFIED: make lint runs tsc over src, so the same mistake fails the gate.
2026-11-24T19:30:26Z s=dcdb118f FINDING tests/o11y.test.ts:57 learn=test: VERIFIED: tests/o11y.test.ts asserts both series.
2026-11-24T19:30:26Z s=dcdb118f FINDING src/telemetry.ts:quiet learn=none: VERIFIED: reproducing it needs a handler that outlives the 3 s drain; the guard is one try/catch at the only write sites.
2026-11-24T19:30:26Z s=dcdb118f FINDING src/telemetry.ts:volume learn=test: VERIFIED: the o11y test checks readiness 200 on a fresh root and 503 for a root below a regular file.
2026-11-24T19:30:26Z s=dcdb118f FINDING tests/scheduler.test.ts worker test learn=none: VERIFIED: not reproduced, so neither the cause nor a fix is established.
2026-11-24T19:53:08Z s=aceaa8e2 FAIL tests.unit,tests.e2e.1,coverage
2026-11-24T20:03:40Z s=dcdb118f DONE fp=637c6a7f8355 cov=98.2% paths=ARCH.md,CHANGELOG.md,README.md,bun.lock(+31)
2026-11-24T20:03:40Z s=dcdb118f FINDING src/client.ts:logs maxIngestBatchBytes learn=test: VERIFIED: tests/logs.test.ts writes the five binary records through a defuss-logs batch sink.
2026-11-24T20:03:40Z s=dcdb118f FINDING src/logs.ts:read learn=test: VERIFIED: tests/logs.test.ts expects INVALID_ARGUMENT for an invalid request on an absent log.
2026-11-24T20:03:40Z s=dcdb118f FINDING tests/logs.test.ts own log learn=test: VERIFIED: the test and both pages state the ordering.
2026-11-24T20:03:40Z s=dcdb118f FINDING scripts/e2e.ts own-log readback learn=test: VERIFIED: the e2e compares against the counted daemon starts.
2026-11-24T20:03:40Z s=dcdb118f FINDING src/server.ts listen learn=test: VERIFIED: tests/o11y.test.ts covers both behaviors; CHANGELOG states the change.
2026-11-24T20:03:40Z s=dcdb118f FINDING defuss-rpc console lines learn=none: VERIFIED: an upstream hook is needed; README and ARCH say these lines reach stdout and stderr only.
2026-11-24T20:03:59Z s=aceaa8e2 FAIL tests.unit
2026-11-24T20:10:43Z s=dcdb118f DONE fp=8545d844fe0e cov=98.2% paths=ARCH.md,CHANGELOG.md,README.md,bun.lock(+31)
2026-11-24T20:10:43Z s=dcdb118f FINDING src/logs.ts:read isOwnLog learn=test: VERIFIED: tests/logs.test.ts and scripts/consumer.ts assert the read exception and the write rejection.
2026-11-24T20:25:03Z s=dcdb118f DONE fp=ab4e7f7410f8 cov=98.2% paths=ARCH.md,CHANGELOG.md,README.md,bun.lock(+32)
2026-11-24T20:25:03Z s=dcdb118f FINDING src/db.ts:version learn=verifier: VERIFIED: make lint runs tsc over src, so a repeat fails the gate.
2026-11-24T20:25:03Z s=dcdb118f FINDING src/scope.ts:component learn=test: VERIFIED: tests/storage.test.ts checks the examples, the pattern, the length, the absence of _, case and punctuation separation in every engine, and 商店 and 123 
2026-11-24T20:25:03Z s=dcdb118f FINDING scripts/e2e.ts v0.1.0 fixture learn=test: VERIFIED: tests/revisions.test.ts and the e2e native readback cover the replaced checks.
2026-11-24T20:52:57Z s=dcdb118f FAIL tests.e2e.1
2026-11-24T21:03:45Z s=dcdb118f FAIL tests.unit
2026-11-24T21:09:14Z s=dcdb118f FINDING tests/scheduler.test.ts worker test got payload 7: an every-second schedule fired between create and the payload edit; fixed by creating it yearly and setting the cron in the edit learn=test
2026-11-24T21:11:49Z s=dcdb118f DONE fp=7fefe08cf20f cov=98.0% paths=ARCH.md,CHANGELOG.md,README.md,bun.lock(+35)
2026-11-24T21:11:49Z s=dcdb118f FINDING src/log.ts:print; src/callbacks.ts:call warn lines learn=test: VERIFIED: tests/logs.test.ts 'a message with line breaks stays one line on the console' runs print in a child process and fails on a raw line break.
2026-11-24T21:11:49Z s=dcdb118f FINDING scripts/consumer-revisions.ts:61-81 learn=test: VERIFIED: the e2e asserts every tool's hints in every phase.
2026-11-24T21:11:49Z s=dcdb118f FINDING src/callbacks.ts:call status mapping learn=test: VERIFIED: covered by tests/callbacks.test.ts.
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
