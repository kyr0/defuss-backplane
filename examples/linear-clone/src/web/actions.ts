/** VERIFIED: scripts/e2e.ts drives it in Chromium, Firefox and WebKit. Every change the browser makes: an API call, then the store, then one re-render. An edit on the open issue page is
 * conditional on the revision the page loaded; when someone else changed the issue first, the page reloads it and a
 * toast says so. Other edits apply to the latest version. */
import { uploadIdOf } from "../core/ids.ts";
import type { Fields, Issue } from "../core/issue.ts";
import { api, faultOf, rpc } from "./client.ts";
import { toast } from "./env.ts";
import { changed, putIssue, store } from "./store.ts";

/** Runs a call and turns a failure into a toast; undefined when it failed. */
async function attempt<T>(call: () => Promise<T>, what: string): Promise<T | undefined> {
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

export async function update(id: string, patch: Partial<Fields>) {
  const revision = store.page?.issue.id === id ? store.page.revision : undefined;
  const result = await attempt(() => api().Issues.update(id, patch, revision), "Saving " + id);
  if (!result) return;
  putIssue(result.issue);
  if (store.page?.issue.id === id) await openPage(id);
  else changed();
}

export async function create(draft: Partial<Fields>) {
  const result = await attempt(() => api().Issues.create(draft), "Creating the issue");
  if (!result) return undefined;
  putIssue(result.issue);
  changed();
  toast(result.issue.id + " created", result.issue.title);
  return result.issue;
}

export async function remove(id: string) {
  if (!(await attempt(() => api().Issues.remove(id), "Deleting " + id))) return;
  store.issues.delete(id);
  if (store.page?.issue.id === id) {
    store.page = null;
    location.hash = "/";
  }
  changed();
  toast(id + " deleted");
}

export async function comment(id: string, body: string) {
  if (!(await attempt(() => api().Issues.comment(id, body), "Commenting"))) return;
  await openPage(id);
}

export async function toggleSubtask(issue: Issue, index: number, done: boolean) {
  await update(issue.id, { subtasks: issue.subtasks.map((s, i) => (i === index ? { ...s, done } : s)) });
}

export async function addSubtask(issue: Issue, title: string) {
  await update(issue.id, { subtasks: [...issue.subtasks, { title, done: false }] });
}

export async function attach(id: string, file: File) {
  const done = await attempt(
    () => rpc.uploadComplete("attachment", file, { uploadId: uploadIdOf(id), originalFilename: file.name }),
    "Uploading " + file.name,
  );
  if (!done) return;
  toast(file.name + " attached");
  await openPage(id);
}

export async function unattach(id: string, name: string) {
  if (!(await attempt(() => api().Issues.removeAttachment(id, name), "Removing " + name))) return;
  await openPage(id);
}

/** Saves the attachment through a temporary link. */
export async function download(id: string, name: string) {
  const file = await attempt(() => rpc.downloadAsBlob("attachment", undefined, { downloadId: id + "/" + name }), "Downloading " + name);
  if (!file) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file.blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

export async function markRead(ids?: string[]) {
  if ((await attempt(() => api().Inbox.markRead(ids), "Marking read")) === undefined) return;
  for (const n of store.inbox) if (!ids || ids.includes(n.id)) n.read = true;
  changed();
}
