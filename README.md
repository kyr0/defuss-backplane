# defuss-backplane

Local, unified low-level persistence and logic layer RPC service for application service backend and MCP agents. One process serves defuss-rpc, MCP and a streaming file endpoint on the same port. Each bucket belongs to one app, tenant and service.

## Quick start

The source ZIP includes the installable tarball in its `release` directory. Copy the tarball into your application's directory. From that directory, install it with one of these commands.

```sh
npm install ./defuss-backplane-0.2.0.tgz
# or
bun add ./defuss-backplane-0.2.0.tgz
```

The release bundles the defuss-db engine code reached by the daemon. npm or bun installs defuss-vfs, the file engine, as a regular dependency. Installing the tarball avoids the model runtimes in the development dependency tree.

In the directory where the daemon will run, create a private bot key once. Skip this command if you already have a configured `.env`.

```sh
(umask 077; set -C; printf 'API_KEY=%s\n' "$(openssl rand -hex 32)" > .env)
```

Start one daemon with Node.js 26 or Bun 1.4.4 or later. The first command runs the installed CLI under Node.js. The second selects Bun explicitly.

```sh
node node_modules/defuss-backplane/dist/cli.js
# or
bun node_modules/defuss-backplane/dist/cli.js
```

The startup log prints the listener address. The default is `http://127.0.0.1:43127`. Give backend processes and local MCP clients the same bot key. Node.js callers can load their environment file with `node --env-file=.env`.

## Backend API

```ts
import { connectBackplane } from "defuss-backplane/client";

const shop = await connectBackplane({ app: "shop" });
const tenant = shop.tenant("acme");
const cache = tenant.cache("catalog");
await cache.set("currency", "EUR", 60_000);
const cached = await cache.get("currency"); // { hit: true, value: "EUR" }

const orders = tenant.db("orders");
const id = await orders.insert({ item: "A7", status: "open" });
await orders.update(id, { status: "paid" });
const page = await orders.query({
  filters: [{ field: "status", op: "eq", value: "paid" }],
  sorters: [{ field: "item", direction: "asc" }],
  projection: ["id", "item"],
  limit: 25,
});
console.log(cached, page.rows);
```

| Operation | Result |
| --- | --- |
| `cache.get(key)` | `{hit:false}` for a missing or expired key, otherwise `{hit:true,value}`. |
| `cache.getVersioned(key)` | Returns the value and revision, or `{found:false,revision:null}`. |
| `cache.set(key,value,ttlMsOrOptions?)` | Overwrites the value and returns true. Omitting TTL clears any previous expiry. Zero expires immediately. |
| `cache.delete(key,options?)` | Returns true after the storage operation, including when the key is absent. |
| `db.insert(document,options?)` | Returns the primary key. The database generates one when the document omits `id`. |
| `db.get(id)` | Returns the document or null. |
| `db.getVersioned(id)` | Returns the document and revision from one snapshot, or `{found:false,revision:null}`. |
| `db.update(id,patch,options?)` | Patches fields and returns whether a document was updated. The ID is immutable. |
| `db.delete(id,options?)` | Returns whether a document was deleted. |
| `db.query(request?)` | Returns `{rows}` with filters, sorters, offset, limit and optional top-level field projection. Default limit 100, maximum 1,000. |

The client sends credentials on its initial schema request and subsequent calls. It sends each immutable scope with the operation. RPC accepts DSON values, including dates and binary data.

## Conditional writes

Read a revision when a backend or agent will edit a value. A hit returns `{found:true,value,revision}`. Pass the token to the write. A competing update or delete returns `REVISION_CONFLICT`. Read again and decide whether the edit still applies.

```ts
const order = await orders.getVersioned(id);
if (order.found) {
  await orders.update(id, { status: "shipped" }, { ifRevision: order.revision });
}
await cache.set("job-7", { state: "claimed" }, { ttlMs: 30_000, ifRevision: null });
```

Omitting `ifRevision` keeps the v0.1 write behavior. A null token requires logical absence, including an expired cache key. An insert accepts null or an omitted condition and always creates a new row. An update of an absent row returns false if its precondition passes. Recreating a deleted item issues a fresh token even for identical contents. A token applies to one item, survives daemon restarts, and remains valid across writes to other items. Route all edits through the daemon when using revisions. Native readers can still open the document store. A typed collection requires an explicit ID when its declared ID type excludes arbitrary strings.

## Files

`tenant.vfs(bucket)` stores files as objects under relative path keys. Calls through `/rpc` and MCP carry at most 1 MiB. `upload` and `download` stream objects of any size through `/vfs/object`.

```ts
import { createReadStream, createWriteStream } from "node:fs";
import { Writable } from "node:stream";

const media = tenant.vfs("media");
await media.put("notes/today.txt", "Call the supplier");
const listing = await media.list({ prefix: "notes/" });

await media.upload("videos/intro.mp4", createReadStream("intro.mp4"), { ifRevision: null });
const video = await media.download("videos/intro.mp4");
if (video.found) await video.stream.pipeTo(Writable.toWeb(createWriteStream("copy.mp4")));
```

| Operation | Result |
| --- | --- |
| `vfs.put(key,data,options?)` | Stores a string or bytes as one object and returns `{key,size,revision,mtimeMs}`. |
| `vfs.get(key,range?)` | Returns the bytes with that metadata, or `{found:false,revision:null}`. An object over 1 MiB needs a `{offset,length}` range or `download`. |
| `vfs.head(key)` | Returns the metadata without the bytes. |
| `vfs.list(request?)` | Returns `{objects,nextAfter}` in bytewise key order. `prefix`, `after` and `limit` (default 100, maximum 1,000) select a page. Pass `nextAfter` as `after` for the next page. |
| `vfs.delete(key,options?)` | Returns whether an object was deleted. |
| `vfs.upload(key,body,options?)` | Streams a `ReadableStream`, an async iterable such as a Node.js file stream, a `Blob`, bytes or a string, and returns the metadata. |
| `vfs.download(key)` | Returns the metadata with a `stream` of the bytes, or `{found:false,revision:null}`. Read or cancel the stream. |

A key is a relative path of 1 to 1,024 valid UTF-8 bytes without empty, `.` or `..` segments. A key cannot hold an object while it is also the directory of other keys: with `a/b` stored, writing `a` fails with `INVALID_ARGUMENT`, and reading `a` finds nothing. Writes take `ifRevision` as described above. Every successful write issues a new revision, even for unchanged content. An upload replaces the previous object only after its last byte arrives, so a failed upload leaves the previous object and revision in place.

The streaming endpoint takes the scope and key as URL-encoded query parameters. `PUT` stores the request body and returns the metadata as JSON. `GET` returns the bytes with `Content-Length`, the revision as a quoted `ETag` and the modification time in `X-Mtime-Ms`. A missing object returns 404 with code `NOT_FOUND`. `If-Match: "<revision>"` and `If-None-Match: *` are the HTTP forms of a revision token and of `ifRevision: null`.

```sh
object='http://127.0.0.1:43127/vfs/object?app=shop&tenant=acme&bucket=media&key=videos%2Fintro.mp4'
curl -fsS -T intro.mp4 -H "Authorization: Bearer ${API_KEY}" "$object"
curl -fsS -o copy.mp4 -H "Authorization: Bearer ${API_KEY}" "$object"
```

### Errors

RPC error bodies carry `{code,error,status}`. The SDK throws `BackplaneError` with `code`, `message`, and `status`. MCP tool failures set `isError` and carry `{code,message,status}` in `structuredContent`. MCP transport and JSON-RPC protocol failures use their protocol-defined envelopes.

| Code | RPC status | Caller action |
| --- | --- | --- |
| INVALID_ARGUMENT | 400 | Correct the arguments. |
| UNAUTHORIZED | 401 | Send the bot key as a bearer token. |
| FORBIDDEN | 403 | Use the loopback URL and port, and send no Origin header. |
| NOT_FOUND | 404 | Check the endpoint path. A download of a missing object also returns this code. |
| METHOD_NOT_ALLOWED | 405 | Use the method named in the `Allow` header. |
| ALREADY_EXISTS | 409 | Choose a different ID or edit the existing row. |
| REVISION_CONFLICT | 409 | Read the current version before deciding whether to retry. |
| PAYLOAD_TOO_LARGE | 413 | Keep `/rpc` and `/mcp` requests under 1 MiB. Stream larger files through `/vfs/object`. |
| BUSY | 503 | Retry with backoff. |
| COMMIT_UNCERTAIN | 500 | Inspect the persisted value before issuing another write. |
| STORAGE_ERROR | 500 | Inspect the store and filesystem. |
| INTERNAL_ERROR | 500 | Retry once. Report repeated failures with the daemon log. |
| DSON_REQUIRED | 422 equivalent in an MCP tool result | Repeat the read with DSON encoding. |

## Local curl and MCP

With `API_KEY` in the shell environment, curl can inspect the RPC schema or populate a cache key.

```sh
curl -fsS -X POST -H "Authorization: Bearer ${API_KEY}" http://127.0.0.1:43127/rpc/schema
curl -fsS -H "Authorization: Bearer ${API_KEY}" http://127.0.0.1:43127/rpc \
  --json '{"className":"cache","methodName":"set","args":[{"app":"shop","tenant":"acme","bucket":"catalog"},"currency","EUR"]}'
```

Configure the agent's Streamable HTTP transport with endpoint `http://127.0.0.1:43127/mcp` and the same Authorization header. Tool discovery lists the ten cache and document operations and `vfs.put`, `vfs.get`, `vfs.head`, `vfs.list` and `vfs.delete`, each with its input schema. For example, call `cache.get` with these arguments.

```json
{"scope":{"app":"shop","tenant":"acme","bucket":"catalog"},"key":"currency"}
```

The result is available as `structuredContent.value`. A native value that would lose information in JSON requires `resultEncoding: "dson"` on the read. The value then contains a `dson` string. Shared references, cycles, dates, binary and bigint values can require this mode. MCP keyed document operations accept a string, number, or a tagged bigint such as `{"bigint":"9007199254740993"}`. The tag is also accepted as `document.id` on insert, which returns the tag for a bigint ID. Reading such a document with `resultEncoding: "dson"` preserves the native ID. Conditional MCP writes take `ifRevision` at the top level alongside `scope` and `key` or `id`. Ordinary MCP writes accept JSON. RPC supports DSON for reads and writes. The VFS tools exchange object content as a string: `encoding` selects `utf8`, the default, or `base64` for binary. A `utf8` read of bytes that are not valid UTF-8 fails with `INVALID_ARGUMENT`.

## Configuration

| Setting | Meaning |
| --- | --- |
| `API_KEY` | Required bot key. Use printable ASCII without whitespace. Every holder may access every tenant. |
| `PORT` | Listener port, default 43127. The host is fixed. |
| `BACKPLANE_DATA_DIR` | Data root, default `./var/data` relative to the daemon working directory. |

App, tenant and bucket identifiers accept 1 to 48 valid UTF-8 bytes. Cache keys and file keys accept 1 to 1,024 valid UTF-8 bytes. Stop the service with SIGTERM or SIGINT. To back up the whole service, stop writers, shut down the daemon, then copy the data root. An application's own authentication determines which tenant it passes to the service.

## Development

Install the versions in `mise.toml`, then run `make setup` and `make verify`. The latter runs lint, type checking, real storage and protocol tests, coverage, and a packed-consumer test across Node.js and Bun. The sources, tests and verification scripts are TypeScript. The strict compiler checks all three, so lint fails when a test or script calls the API with the wrong types. The packed-consumer test needs `curl`, `lsof` and npm on the `PATH`. Use `make start` for the Node.js daemon or `make start RUNTIME=bun` for Bun. `make status`, `make log` and `make stop` control the source-tree daemon.

In a Git working tree, `make gate` runs the vendored defuss-vae verifier. Its review and documentation prompts apply to the current source fingerprint. Storage and transport decisions are in [ARCH.md](ARCH.md).
