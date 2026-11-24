/** VERIFIED: A lease spans the complete storage operation so idle eviction cannot close a handle underneath a request. */
import { BackplaneError } from "./errors.js";
type Handle = { close(): Promise<void> };
type Entry<T> = { handle: T; users: number };

/** Only cold opens and idle evictions serialize. A lease pins its handle for the whole operation. */
export class HandlePool<T extends Handle> {
  private entries = new Map<string, Entry<T>>();
  private queue = Promise.resolve();
  private stopped = false;
  constructor(
    private open: (path: string, create: boolean) => Promise<T>,
    private capacity = 32,
    private present?: (path: string) => Promise<boolean>,
  ) {}

  private lease(path: string) {
    if (this.stopped) throw new Error("Store is closing");
    const entry = this.entries.get(path);
    if (entry) {
      entry.users++;
      this.entries.delete(path);
      this.entries.set(path, entry);
    }
    return entry;
  }

  async use<R>(
    path: string,
    work: (handle: T) => Promise<R>,
    absent?: () => R,
  ): Promise<R> {
    let entry = this.lease(path);
    if (!entry) {
      const pending = this.queue.then(async () => {
        const existing = this.lease(path);
        if (existing) return existing;
        // Resolve cold absence in the same queue as opens. Recheck after every miss.
        const present = this.present ? await this.present(path) : undefined;
        if (absent && present === false) return undefined;
        if (this.entries.size >= this.capacity) {
          const idle = [...this.entries].find(([, item]) => item.users === 0);
          if (!idle)
            throw new BackplaneError("BUSY", "All store handles are busy");
          this.entries.delete(idle[0]);
          await idle[1].handle.close();
        }
        // Create only for a write into a confirmed-missing store, or when no presence check exists and the caller has
        // no absent result. An existing store opens with creation disabled, so a damaged one fails instead of being
        // recreated empty.
        const fresh = {
          handle: await this.open(
            path,
            present === false || (!absent && present === undefined),
          ),
          users: 1,
        };
        this.entries.set(path, fresh);
        return fresh;
      });
      this.queue = pending.then(
        () => {},
        () => {},
      );
      entry = await pending;
      if (!entry) return absent!();
    }
    try {
      return await work(entry.handle);
    } finally {
      entry.users--;
    }
  }

  /** Open handles, and how many of them a running operation holds. */
  stats() {
    let busy = 0;
    for (const item of this.entries.values()) if (item.users) busy++;
    return { open: this.entries.size, busy };
  }

  /** The owner drains HTTP requests before closing the pool. */
  async close() {
    this.stopped = true;
    await this.queue;
    const entries = [...this.entries.values()];
    if (entries.some((item) => item.users))
      throw new Error("Store handles still in use");
    this.entries.clear();
    await Promise.all(entries.map((item) => item.handle.close()));
  }
}
