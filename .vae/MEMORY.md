# Agent memory

<!-- One tagged line per durable fact NOT derivable from code, git or docs:
- VERIFIED[scope] fact BC evidence
- HYPOTHESIS[scope] claim BC observation; falsifier=`cmd`
- UNKNOWN[scope] gap BC missing evidence
[scope] = the narrowest path|module|command|condition the evidence covers, not a topic: the entry decides nothing
outside it, and recurrence inside one subsystem never widens it.
Every line carries its BC and stays within 240 chars. Replace stale lines instead of appending.
Mechanizable lessons belong in tests or .vae/VERIFY.py.
Budget 4 KiB (`vae.py doctor --repo .`); entries are injected at session start. -->
- VERIFIED[scripts/e2e.ts npm install --prefer-offline] a just-published dependency version fails ETARGET from npm's stale cached metadata; `npm view <pkg>@<version> version` refreshes it BC defuss-rpc 4.0.0 on 2026-11-24
- VERIFIED[defuss-morph 0.3.0 JSX] an attribute stays while its key is in the VNode: `undefined` keeps the old value and `null` is written as the string "null"; use a boolean (false removes it) or leave the key out BC examples/linear-clone inbox data-unread on 2026-11-25
