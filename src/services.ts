/** VERIFIED: The daemon and the tests compose the four services here, so the RPC server sees one `cache`, `db`, `vfs`
 * and `logs` module whose thrown faults keep their codes. */
import { createCache } from "./cache.js";
import { createDb } from "./db.js";
import { createLogs } from "./logs.js";
import { createVfsService } from "./vfs.js";
import { observeMethods, type Recorder } from "./faults.js";
import type { LogStore } from "defuss-logs";

/** `meter` returns the recorder for one module's calls, and `ownLog` is the daemon's open `_backplane` log, which
 * `logs.read` serves. The daemon passes both, the storage tests neither. */
export function createServices(
  root: string,
  meter?: (module: string) => Recorder,
  ownLog?: LogStore,
) {
  const cache = createCache(root),
    db = createDb(root),
    vfs = createVfsService(root),
    logs = createLogs(root, ownLog);
  return {
    api: {
      cache: observeMethods(cache.api, meter?.("cache")),
      db: observeMethods(db.api, meter?.("db")),
      vfs: observeMethods(vfs.api, meter?.("vfs")),
      logs: observeMethods(logs.api, meter?.("logs")),
    },
    /** The streaming endpoint calls these directly; they are not RPC methods. */
    transfers: {
      upload: vfs.upload,
      download: vfs.download,
      readRange: vfs.readRange,
    },
    /** Open and busy store handles per module, out of 32 each. */
    handles: () => ({
      cache: cache.handles(),
      db: db.handles(),
      vfs: vfs.handles(),
      logs: logs.handles(),
    }),
    close: () =>
      Promise.all([cache.close(), db.close(), vfs.close(), logs.close()]).then(() => {}),
  };
}
