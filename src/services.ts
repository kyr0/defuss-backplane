/** VERIFIED: The daemon and the tests compose the three services here, so the RPC registry sees one `cache`, `db` and `vfs` module whose thrown faults keep their codes. */
import { createCache } from "./cache.js";
import { createDb } from "./db.js";
import { createVfsService } from "./vfs.js";
import { observeMethods } from "./faults.js";

export function createServices(root: string) {
  const cache = createCache(root),
    db = createDb(root),
    vfs = createVfsService(root);
  return {
    api: {
      cache: observeMethods(cache.api),
      db: observeMethods(db.api),
      vfs: observeMethods(vfs.api),
    },
    /** The streaming endpoint calls these directly; they are not RPC methods. */
    transfers: { upload: vfs.upload, download: vfs.download },
    close: () =>
      Promise.all([cache.close(), db.close(), vfs.close()]).then(() => {}),
  };
}
