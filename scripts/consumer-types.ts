/** VERIFIED: A consumer compiles this file after installation so an unpublished declaration cannot mask a broken export. */
import { connectBackplane } from "defuss-backplane/client";

interface Order {
  id: string;
  status: "open" | "paid";
}
async function consume() {
  const backend = await connectBackplane({ app: "typed-shop" });
  const orders = backend.tenant("acme").db<Order>("orders");
  await orders.insert({ status: "open" });
  await orders.update("one", { status: "paid" });
  const doc: Order | null = await orders.get("one");
  return doc?.status;
}
export { consume };

async function typedIds() {
  const app = await connectBackplane({ app: "types" });
  const rows = app.tenant("t").db<{ id: number; amount: number }>("invoice");
  const id: number = await rows.insert({ id: 5, amount: 12 });
  const row = await rows.getVersioned(id);
  if (row.found)
    await rows.update(
      row.value.id,
      { amount: 3 },
      { ifRevision: row.revision },
    );
  // @ts-expect-error Auto-generated string keys cannot inhabit a numeric ID.
  await rows.insert({ amount: 12 });
  // @ts-expect-error The collection accepts numeric keys.
  await rows.get("5");
  // @ts-expect-error The collection accepts numeric keys.
  await rows.delete(5n);
  const narrow = app.tenant("t").db<{ id: "fixed" }>("literal");
  // @ts-expect-error A generated string cannot be guaranteed to equal "fixed".
  await narrow.insert({});
  const fixed: "fixed" = await narrow.insert({ id: "fixed" });
  return fixed;
}
export { typedIds };

async function typedObjects() {
  const files = (await connectBackplane({ app: "types" }))
    .tenant("t")
    .vfs("files");
  const stored = await files.put("a.txt", "text", { ifRevision: null });
  const head = await files.head(stored.key);
  const size: number = head.found ? head.size : 0;
  const read = await files.download("a.txt");
  if (read.found) await read.stream.cancel();
  // @ts-expect-error Object data is a string or bytes.
  await files.put("a.txt", 5);
  // @ts-expect-error A revision token is a string or null.
  await files.delete("a.txt", { ifRevision: 5 });
  return size;
}
export { typedObjects };
