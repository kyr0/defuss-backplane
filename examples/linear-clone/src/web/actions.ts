/** VERIFIED: scripts/e2e.ts drives every action through the UI against the real backplane. Every change the browser
 * makes: an API call, then the store, then `changed()`, which re-renders the regions. Writes run one after another,
 * and an edit on the open issue page is conditional on the revision the previous write left: two quick edits of the
 * same page would otherwise race, and the second would fail with REVISION_CONFLICT against the first. When someone
 * else changed the issue first, the page reloads it and a toast says so. Other edits apply to the latest version. */
import df$ from "defuss-query";
import { uploadIdOf } from "../core/ids.ts";
import type { Fields, Issue } from "../core/issue.ts";
import { api, faultOf, rpc } from "./client.ts";
import { toast } from "./env.ts";
import { changed, putIssue, store } from "./store.ts";

let queue: Promise<unknown> = Promise.resolve();
/** Runs `call` after every write before it, and turns a failure into a toast; undefined when it failed. */
function write<T>(what: string, call: () => Promise<T>): Promise<T | undefined> {
  const run = queue.then(async () => {
    try {
      return await call();
    } catch (error) {
      const fault = faultOf(error);
      if (fault.code === "REVISION_CONFLICT" && store.page) {
        toast("Changed elsewhere", store.page.issue.id + " was reloaded with the latest changes.");
        await openPage(store.page.issue.id);
      } else toast(what + " failed", fault.message);
      return undefined;
    }
  });
  queue = run;
  return run;
}

/** Loads the issue page into the store; false when the issue does not exist. */
export async function openPage(id: string) {
  try {
    store.page = await api().Issues.get(id);
    putIssue(store.page.issue);
    changed();
    return true;
  } catch {
    store.page = null;
    return false;
  }
}

/** Saves a patch, given directly or computed from the latest stored issue when the write runs. */
export function update(id: string, patch: Partial<Fields> | ((issue: Issue) => Partial<Fields>)) {
  return write("Saving " + id, async () => {
    const latest = store.issues.get(id);
    if (!latest) return;
    const revision = store.page?.issue.id === id ? store.page.revision : undefined;
    const result = await api().Issues.update(id, typeof patch === "function" ? patch(latest) : patch, revision);
    putIssue(result.issue);
    if (store.page?.issue.id === id) await openPage(id);
    else changed();
  });
}

export const toggleSubtask = (id: string, index: number, done: boolean) =>
  update(id, (issue) => ({ subtasks: issue.subtasks.map((s, i) => (i === index ? { ...s, done } : s)) }));

export const addSubtask = (id: string, title: string) => update(id, (issue) => ({ subtasks: [...issue.subtasks, { title, done: false }] }));

export function create(draft: Partial<Fields>) {
  return write("Creating the issue", async () => {
    const { issue } = await api().Issues.create(draft);
    putIssue(issue);
    changed();
    toast(issue.id + " created", issue.title);
    return issue;
  });
}

export function remove(id: string) {
  return write("Deleting " + id, async () => {
    await api().Issues.remove(id);
    store.issues.delete(id);
    if (store.page?.issue.id === id) {
      store.page = null;
      location.hash = "/";
    }
    changed();
    toast(id + " deleted");
  });
}

export function comment(id: string, body: string) {
  return write("Commenting", async () => {
    await api().Issues.comment(id, body);
    await openPage(id);
  });
}

export function attach(id: string, file: File) {
  return write("Uploading " + file.name, async () => {
    await rpc.uploadComplete("attachment", file, { uploadId: uploadIdOf(id), originalFilename: file.name });
    toast(file.name + " attached");
    await openPage(id);
  });
}

export function unattach(id: string, name: string) {
  return write("Removing " + name, async () => {
    await api().Issues.removeAttachment(id, name);
    await openPage(id);
  });
}

/** Saves the attachment through a temporary link. */
export async function download(id: string, name: string) {
  try {
    const file = await rpc.downloadAsBlob("attachment", undefined, { downloadId: id + "/" + name });
    const href = URL.createObjectURL(file.blob);
    df$<HTMLAnchorElement>("<a></a>").attr("href", href).attr("download", name)[0]!.click();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch (error) {
    toast("Downloading " + name + " failed", faultOf(error).message);
  }
}

export function markRead(ids?: string[]) {
  return write("Marking read", async () => {
    await api().Inbox.markRead(ids);
    store.inbox = store.inbox.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n));
    changed();
  });
}
