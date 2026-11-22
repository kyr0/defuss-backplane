# Changelog

## Unreleased

Added a file service on defuss-vfs 0.3.0. `tenant.vfs(bucket)` and five MCP tools put, get, head, list and delete objects under relative path keys, with the same revision tokens as cache entries and documents. `upload`, `download` and the `/vfs/object` endpoint stream objects larger than the 1 MiB request limit. The README error table now lists every code the service returns.

The listener no longer ends a request after 30 seconds, so long transfers can finish. On shutdown it closes connections that are still open after 3 seconds. A closed daemon unregisters its RPC functions, so a later daemon in the same process serves its own.

Converted the packed-consumer scripts to TypeScript and extended strict type checking to the tests and scripts. The listener check now inspects the daemon's sockets with lsof, so the packed-consumer test also runs on macOS. The built `dist` files are unchanged.

Split the service implementation into scope validation, storage, cache and document modules. The exports and their type declarations are unchanged apart from declaration order.

## 0.2.0

Added versioned point reads and atomic conditional writes for cache entries and documents over RPC and MCP. Existing point reads and unconditional writes retain their result shapes. Cold read misses leave absent shards untouched. Expired cache entries remain until an explicit delete or overwrite.

Added structured service faults, lossless DSON fallback for shared references, tagged bigint document IDs in MCP, and collection-specific TypeScript ID contracts. MCP discovery marks overwrites and deletes as destructive.

## 0.1.0

Added the loopback daemon, authenticated RPC and MCP discovery, persistent cache with TTL, scoped document CRUD and queries, the backend client, and package tests for Node.js and Bun.
