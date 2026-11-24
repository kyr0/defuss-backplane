# Readable scope directory names

Status: implemented on 2026-11-24 with defuss-db 3.3.0. Two changes from this plan: the slug keeps letters, digits and marks of every script after NFC instead of folding them to ASCII, because defuss-db 3.3.0 accepts them in collection names, and the daemon's own log uses the literal directory `_backplane`. The v0.1.0 fixture left the packed-consumer test, since its hex directories are no longer read.

## Goal

Human request: app, tenant and bucket names read as plain words on disk, so debugging needs no hex decoding, and two distinct names never share storage.

Human decisions: the format is `<slug>-<8 hex>`. 8 hex chars suffice because the goal is avoiding accidental collisions, not resisting chosen ones. No migration and no reading of old hex directories, because the project has no users yet.

## Facts

- VERIFIED[src/scope.ts:component] encodes each name as `x` plus the hex of its UTF-8 bytes. Callers: `address()`, which `cache.ts:34`, `vfs.ts:108` and `db.ts:59` call; `telemetry.ts:35` only validates and ignores the result; `tests/vfs.test.ts:57` rebuilds a path with it.
- VERIFIED[defuss-db 3.1.0] collection names match `^[A-Za-z][A-Za-z0-9_-]{0,63}$` BC `node_modules/defuss-db/dist/database-BMfyv4y0.mjs:173`.
- VERIFIED[src/db.ts:stampName] the revision collection swaps the leading `x` for `v`, so it relies on encoded names starting with `x`.
- VERIFIED[src/db.ts:collection] a name over 64 chars splits into a collection (first 64) and a partition directory (the rest). It exists only because hex doubles the length.
- VERIFIED[src/server.ts:39] `scheduler` sits beside the app directories and is safe only while no app directory can be named `scheduler`.
- VERIFIED[tests/storage.test.ts:152] covers 48-byte names and keeps `Ä` and `Ä` apart. Both slug to `a`, so after the change the hash alone keeps them apart, and the test keeps proving it.

## Encoding contract

`component(value)` keeps its validation (1 to 48 well-formed UTF-8 bytes) and returns `slug + "-" + hash`:

- slug: NFKD, drop combining marks (`\p{M}`), lowercase, replace each run outside `[a-z0-9]` with `-`, trim `-`, keep the first 48 chars, trim `-` again. IF the slug is empty OR starts with a digit THEN prefix `x` (defuss-db needs a leading letter).
- hash: the first 8 hex chars of SHA-256 over the exact UTF-8 bytes (`node:crypto`).
- Output matches `^[a-z][a-z0-9-]*-[0-9a-f]{8}$`, holds at most 58 chars and never contains `_`. `db.ts` relies on the last two properties.

Examples, observed with a scratch copy of the rule:

| Name | Directory |
| --- | --- |
| `shop` | `shop-8d9001d3` |
| `Shop` | `shop-d00aae6b` |
| `Acme GmbH` | `acme-gmbh-033aedd8` |
| `Café` | `cafe-73473dcc` |
| `商店` | `x-61f96c6a` |
| `123` | `x123-a665a459` |
| `1` followed by 47 `b` | 58 chars, the maximum |

Why this beats a plain slug: a slug alone merges `Shop`/`shop`, `my shop`/`my-shop` and `café`/`cafe`. The hash of the exact bytes keeps them apart. Lowercase ASCII output keeps them apart on case-insensitive and normalizing volumes such as APFS, too. Why it beats hex: `ls` shows the name.

## Steps

1. `src/scope.ts:component`: implement the contract above and rewrite its doc comment with the why. Proof: step 4.
2. `src/db.ts:stampName` returns `name + "_rev"`. No encoded name contains `_`, so no bucket can address a revision collection, and the longest stamp holds 62 chars. `src/db.ts:collection`: drop the split. The partition is always `main` and the collection is the encoded bucket. Update the comments at `db.ts:34` and `db.ts:50`. Proof: the existing db tests and the 48-byte test reach the maximum length through real defuss-db.
3. `src/server.ts:39`: change the comment to say that app directories end in `-<8 hex>`, so none is named `scheduler`.
4. Tests, using real services on `mkdtemp` roots:
   - `tests/storage.test.ts`: write cache, db and vfs data under tenant `Acme`, then read under `acme` and `acme!` and expect misses. A dev Mac runs this on case-insensitive APFS.
   - `tests/storage.test.ts`: a bucket named `商店` and one named `123` work in db. defuss-db would reject an invalid collection name.
   - `tests/storage.test.ts`: `component()` output matches the contract regex and length for ASCII, Unicode, 48-byte and empty-slug inputs. This check covers the contract that `db.ts` relies on from `scope.ts`.
   - `tests/vfs.test.ts:55`: assert the readable directory names (`^shop-[0-9a-f]{8}$` and so on). Rebuilding the path with `component()` passes for any encoding.
5. Docs:
   - `ARCH.md:61`: rewrite the naming paragraph (slug plus hash, why, no partition split).
   - `ARCH.md:79`: replace the `x`/`v` wording with `_rev`.
   - ARCH security: the 8-hex hash prevents accidental collisions, not chosen ones, so the backend should assign tenant names rather than pass end-user input verbatim.
   - `README.md:217`: one sentence saying each name appears on disk as `<slug>-<8 hex>`.
   - `CHANGELOG.md`: a breaking on-disk layout change; existing data roots are not read.
   - Proof: `vae.py prose --fix` and the gate.
6. `make verify`, then the gate.

Rollback: revert the commit. Before testing locally, stop the daemon and delete development data under `var/data`, which the new names no longer find.

## Not doing

Migration, reading old hex directories, a decode or list command, a longer hash.
