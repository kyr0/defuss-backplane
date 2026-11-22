/** VERIFIED: Exercises the VFS service through the packed client, its streaming transfers and the official MCP client. */
import assert from "node:assert/strict";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import type { Client } from "@modelcontextprotocol/client";
import {
  BackplaneError,
  type Scope,
  type VfsObject,
  type connectBackplane,
} from "defuss-backplane/client";

type Tenant = ReturnType<
  Awaited<ReturnType<typeof connectBackplane>>["tenant"]
>;
/** Content a phase writes and the next phase, on the other runtime's daemon, reads back. */
const large = (phase: string) =>
  new TextEncoder().encode(phase.padEnd(64, ".").repeat(24 * 1024 + 1));

export async function checkVfs({
  scope,
  phase,
  previous,
  tenant,
  agent,
}: {
  scope: Scope;
  phase: string;
  previous: string;
  tenant: Tenant;
  agent: Client;
}) {
  const vfs = tenant.vfs(scope.bucket);
  async function ok<T = unknown>(
    name: string,
    fields: Record<string, unknown>,
  ): Promise<T> {
    const result = await agent.callTool({
      name,
      arguments: { scope, ...fields },
    });
    assert.ok(!result.isError, JSON.stringify(result.structuredContent));
    return (result.structuredContent as { value: T }).value;
  }
  const is = (code: string, status: number) => (e: unknown) =>
    e instanceof BackplaneError && e.code === code && e.status === status;
  const bytes = async (stream: ReadableStream<Uint8Array>) =>
    new Uint8Array(await new Response(stream).arrayBuffer());

  const files = await mkdtemp(join(tmpdir(), "backplane-vfs-consumer-"));
  try {
    await exercise(files);
  } finally {
    await rm(files, { recursive: true, force: true });
  }
  async function exercise(files: string) {
    if (previous !== "-") {
      assert.deepEqual(
        await ok("vfs.get", { key: "runs/" + previous + ".txt" }),
        {
          ...(await vfs.head("runs/" + previous + ".txt")),
          value: previous,
          encoding: "utf8",
        },
      );
      // The README example: stream a download into a file.
      const earlier = await vfs.download("runs/" + previous + ".bin");
      assert.ok(earlier.found);
      const copy = join(files, "copy.bin");
      await earlier.stream.pipeTo(Writable.toWeb(createWriteStream(copy)));
      assert.deepEqual(new Uint8Array(await readFile(copy)), large(previous));
    }
    const content = large(phase);
    assert.ok(content.length > 1024 * 1024, "the upload exceeds the body limit");
    // The README example: stream a file into an object.
    const source = join(files, "source.bin");
    await writeFile(source, content);
    const stored = await vfs.upload(
      "runs/" + phase + ".bin",
      createReadStream(source),
      { ifRevision: null },
    );
    assert.equal(stored.size, content.length);
    const read = await vfs.download("runs/" + phase + ".bin");
    assert.ok(read.found);
    assert.deepEqual(
      { size: read.size, revision: read.revision, mtimeMs: read.mtimeMs },
      { size: stored.size, revision: stored.revision, mtimeMs: stored.mtimeMs },
    );
    assert.deepEqual(await bytes(read.stream), content);
    await assert.rejects(
      vfs.get("runs/" + phase + ".bin"),
      is("PAYLOAD_TOO_LARGE", 413),
    );
    const slice = await vfs.get("runs/" + phase + ".bin", { length: 64 });
    assert.ok(slice.found);
    assert.deepEqual(slice.value, content.subarray(0, 64));
    await assert.rejects(
      vfs.upload("runs/" + phase + ".bin", new Blob(["x"]), { ifRevision: null }),
      is("REVISION_CONFLICT", 409),
    );
    assert.deepEqual(await vfs.download("runs/absent.bin"), {
      found: false,
      revision: null,
    });

    const text = await ok<VfsObject>("vfs.put", {
      key: "runs/" + phase + ".txt",
      data: phase,
    });
    assert.equal(
      new TextDecoder().decode(
        ((await vfs.get(text.key)) as { value: Uint8Array }).value,
      ),
      phase,
    );
    const binary = await vfs.put("blobs/" + phase, Uint8Array.of(0, 255));
    assert.deepEqual(
      await ok("vfs.get", { key: binary.key, encoding: "base64" }),
      { found: true, ...binary, value: "AP8=", encoding: "base64" },
    );
    await ok("vfs.put", {
      key: binary.key,
      data: "AP8A",
      encoding: "base64",
      ifRevision: binary.revision,
    });
    await assert.rejects(
      vfs.put(binary.key, "x", { ifRevision: binary.revision }),
      is("REVISION_CONFLICT", 409),
    );
    const head = await ok<VfsObject>("vfs.head", { key: binary.key });
    assert.equal(head.size, 3);
    const page = await ok<{ objects: VfsObject[] }>("vfs.list", {
      request: { prefix: "runs/" },
    });
    assert.ok(page.objects.some((o) => o.key === text.key));
    assert.deepEqual(
      (await vfs.list({ prefix: "blobs/" })).objects.map((o) => o.key),
      [binary.key],
    );
    assert.equal(
      await ok("vfs.delete", { key: binary.key, ifRevision: head.revision }),
      true,
    );
    assert.equal(await vfs.delete(binary.key), false);
  }
}
