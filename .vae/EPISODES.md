# Episodes

<!-- Newest last. The gate appends FAIL|DONE|FINDING; past 100 entries it trims only its own oldest DONE|FAIL|learned
FINDING (git keeps them). Leads (LESSON, FINDING learn=none) stay until wrap settles them; doctor fails above 30.
Agents append `<UTC ISO> s=<session> LESSON <VAE-DIALECT>` only for a falsified HYPOTHESIS, a dead end, or a root cause.
Session start injects the 3 newest open entries: LESSON, FINDING learn=none, FAIL without a later DONE.
Wrap: EVERY lead becomes a test | .vae/VERIFY.py rule | one MEMORY line with BC, then delete; OR delete BC evidence. -->

2026-11-22T09:03:42Z s=backplan FAIL prose
2026-11-22T09:04:53Z s=backplan FAIL tests.unit,coverage
2026-11-22T09:07:29Z s=backplan FAIL tests.e2e.1
2026-11-22T09:07:40Z s=backplan FAIL tests.e2e.1
2026-11-22T09:18:16Z s=backplan DONE fp=4bf1b23bfa1c cov=93.0% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+21)
2026-11-22T09:18:16Z s=backplan FINDING src/services.ts collection learn=test: The 48-byte bucket regression exposed the upstream 64-character collection cap. The suffix partitions native stores and the prefix names their collections. A sa
2026-11-22T09:18:16Z s=backplan FINDING src/services.ts cache.get learn=test: The expiry test observed a logically expired key still present in dbsonl. The expired read now conditionally deletes the observed revision and preserves a concu
2026-11-22T09:18:16Z s=backplan FINDING package.json build and scripts/consumer.mjs learn=test: A clean npm install of the full dependency tree was killed during unpack. The release bundles the pinned DB code, preserves bundled licenses, and installs with 
2026-11-22T09:18:16Z s=backplan FINDING README.md quick start learn=test: Installing from the application directory uses the copied tarball. scripts/e2e.mjs installs the archive in a clean application with each package manager.
2026-11-22T10:14:16Z s=backplan DONE fp=7d5e4de0c6c5 cov=91.3% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+26)
2026-11-22T10:14:16Z s=backplan FINDING src/tools.ts jsonEquivalent and decodeId learn=test: scripts/consumer-revisions.mjs checks both runtime pairs.
2026-11-22T10:14:16Z s=backplan FINDING src/pool.ts cold admission learn=test: tests/revisions.test.ts inspects directory contents and typed faults after real operations.
2026-11-22T10:14:16Z s=backplan FINDING src/faults.ts withFaults learn=test: tests/http.test.ts sends a mixed legacy batch. The packaged tests assert 400, 409 and 422.
2026-11-22T10:14:16Z s=backplan FINDING src/client.ts db<T> learn=test: scripts/consumer-types.ts tests both accepted and rejected reads and writes against the packed declarations.
2026-11-22T10:14:16Z s=backplan FINDING src/tools.ts MCP annotations learn=test: The official MCP client asserts both hints for all ten tools in each packed phase.
2026-11-22T10:14:16Z s=backplan FINDING src/services.ts version and change learn=test: The packed consumer races the two protocols and uses an old revision after an intervening write.
2026-11-22T10:14:16Z s=backplan FINDING ARCH.md:20 B09 learn=test: The storage test checks the raw expired entry after a read and the value of a concurrent replacement.
2026-11-22T12:25:31Z s=dcdb118f DONE fp=12a2344a5df8 cov=91.3% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+28)
2026-11-22T12:25:31Z s=dcdb118f FINDING scripts/e2e.mjs:100 127.0.0.2 connect probe (now scripts/e2e.ts lsof listener check) learn=test: The packed e2e asserts the lsof listener set in each daemon run; ARCH.md records why a 127.0.0.2 probe is inconclusive on macOS. CI installs lsof if the runner 
2026-11-22T12:25:31Z s=dcdb118f FINDING tsconfig.json include=[src]; tests/*.ts and scripts/*.mjs outside strict tsc learn=verifier: .vae/VERIFY.py rule backplane.typescript fails on any .js|.mjs|.cjs|.jsx under src, tests or scripts (checked: exit 1 with an added scripts/x.mjs, 0 without).
2026-11-22T13:17:58Z s=dcdb118f DONE fp=eacc6ceb7b87 cov=92.8% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+32)
2026-11-22T13:17:58Z s=dcdb118f FINDING src/services.ts createServices (423 lines mixing pure validation, filesystem I/O and both engines) learn=test: Existing storage, revision and HTTP tests plus the packed consumer type check cover the moved behavior; no new invariant beyond module layout, which needs no ru
2026-11-22T13:17:58Z s=dcdb118f FINDING src/tools.ts tool() doc; CHANGELOG.md Unreleased learn=none: Wording precision in self-written docs; not mechanically checkable.
2026-11-22T15:08:18Z s=dcdb118f DONE fp=1b5141fbda3b cov=97.1% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+32)
2026-11-22T15:08:18Z s=dcdb118f FINDING package.json:4 description learn=none: Product positioning wording chosen by the human; not mechanically checkable.
2026-11-22T15:38:35Z s=dcdb118f DONE fp=8dfdc7f37091 cov=98.6% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+35)
2026-11-22T15:38:35Z s=dcdb118f FINDING src/server.ts listen().close learn=test: scripts/e2e.ts stalls a 64 MiB download before each daemon's SIGTERM; the existing 8 s exit-code assertion fails if shutdown blocks.
2026-11-22T15:38:35Z s=dcdb118f FINDING src/server.ts server.timeout learn=none: Runtime behaviour recorded in ARCH.md; no rule can check an absent timeout.
2026-11-22T15:38:35Z s=dcdb118f FINDING src/vfs.ts download learn=test: tests/vfs.test.ts eviction test; mutating the lease to release immediately made it fail (1 fail), restoring it passes.
2026-11-22T15:38:35Z s=dcdb118f FINDING src/server.ts close createRpcServer({}) learn=test: tests/http.test.ts starts a second daemon in the same process and exercises its VFS service.
2026-11-22T15:38:35Z s=dcdb118f FINDING src/client.ts UploadBody learn=test: scripts/consumer-vfs.ts uploads with createReadStream under the packed declarations and both runtimes.
2026-11-22T15:38:35Z s=dcdb118f FINDING scripts/consumer-vfs.ts checkVfs learn=none: Test-script completeness; no mechanical rule.
2026-11-22T15:38:35Z s=dcdb118f FINDING src/vfs.ts INLINE_LIMIT; src/tools.ts Adapter.output learn=none: Minor API hygiene.
2026-11-22T15:38:35Z s=dcdb118f FINDING README.md Errors table B/P learn=none: Doc completeness against an enum; a future enum change shows in review.
2026-11-22T15:38:35Z s=dcdb118f FINDING package.json:4 description learn=none: Product positioning, not mechanically checkable.
2026-11-22T15:38:35Z s=dcdb118f FINDING src/server.ts:1 file comment learn=none: Comment accuracy; not mechanically checkable.
2026-11-22T15:48:29Z s=dcdb118f DONE fp=554a09784390 cov=98.6% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,CHANGELOG.md(+35)
2026-11-22T15:48:29Z s=dcdb118f FINDING README.md:3 B01/P learn=none: Human-chosen product wording; not mechanically checkable.
