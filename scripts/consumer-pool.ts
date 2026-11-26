/** VERIFIED: scripts/consumer-jobs.ts runs it in each worker process. The consumer's defuss-multicore task module, which
 * Node.js and Bun both load in a worker thread. A render takes 50 ms, so the two worker processes share the jobs. */
import { expose } from "defuss-multicore/worker";

await expose({
  render: async ({ page }: { page: number }) => {
    await new Promise((done) => setTimeout(done, 50));
    return { page: page * 2 };
  },
});
