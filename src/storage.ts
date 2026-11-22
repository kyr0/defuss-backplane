/** VERIFIED: Both engine pools share this filesystem boundary: a read of an absent store creates nothing, and a write creates owner-only directories. */
import { mkdir, readdir } from "node:fs/promises";

/** True when the store directory holds files. VERIFIED: an empty or missing directory is the only state treated as
 * absent; any other I/O error propagates, so a read cannot mistake an unreadable store for an empty one. */
export async function containsStore(path: string) {
  try {
    return (await readdir(path)).length > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function directory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  return path;
}
