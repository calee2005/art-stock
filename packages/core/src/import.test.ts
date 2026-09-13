import assert from "node:assert/strict";
import { test } from "node:test";
import { blobKey, lockKey, objectMetaKey } from "./keys.ts";
import { createLibrary } from "./libraries.ts";
import { createFolder, readTree } from "./tree.ts";
import { MemoryObjectStore } from "./store.ts";
import { sha256Hex } from "./hash.ts";
import {
  enqueueImport,
  flushImportQueue,
  getObjectMeta,
  importObjectNow,
  inferObjectType,
  type ImportQueue,
} from "./import.ts";
import type { ObjectStore, PutOptions } from "./index.ts";

function device(store: ObjectStore) {
  return { store, deviceId: "dev-a", deviceName: "dev-a", prefix: "" };
}

test("import stores blob by sha256 and object meta type binary", async () => {
  const store = new MemoryObjectStore();
  const lib = await createLibrary(device(store), "库");
  const bytes = new TextEncoder().encode("hello-art");
  const sha = await sha256Hex(bytes);
  const { object, blobSha256 } = await importObjectNow(device(store), {
    libraryId: lib.id,
    parentFolderId: null,
    name: "notes.bin",
    bytes,
  });
  assert.equal(object.type, "binary");
  assert.equal(blobSha256, sha);
  assert.equal(sha, sha.toLowerCase());
  const blob = await store.get(blobKey("", sha));
  assert.ok(blob);
  assert.equal(new TextDecoder().decode(blob.body), "hello-art");
  const meta = await getObjectMeta(device(store), object.id);
  assert.equal(meta?.name, "notes.bin");
  const tree = await readTree(store, "", lib.id);
  assert.ok(
    tree?.tree.nodes.some((node) => node.kind === "file" && node.objectId === object.id),
  );
});

test("inferObjectType is the extension point beyond binary", () => {
  assert.equal(inferObjectType("notes.bin"), "binary");
  assert.equal(inferObjectType("hero.png"), "artwork");
  assert.equal(inferObjectType("doc.pdf"), "pdf");
  assert.equal(inferObjectType("x", "audio/mpeg"), "audio");
});

test("duplicate blob content is reused and queue restores on failure", async () => {
  const store = new MemoryObjectStore();
  const lib = await createLibrary(device(store), "库");
  const bytes = new TextEncoder().encode("same-bytes");
  await importObjectNow(device(store), {
    libraryId: lib.id,
    parentFolderId: null,
    name: "a.bin",
    bytes,
  });
  const again = await importObjectNow(device(store), {
    libraryId: lib.id,
    parentFolderId: null,
    name: "b.bin",
    bytes,
  });
  assert.equal(again.blobSha256, await sha256Hex(bytes));
  const blobs = await store.list(".artstock/v1/blobs/");
  assert.equal(blobs.keys.length, 1);

  const broken: ObjectStore = {
    get: (key) => store.get(key),
    head: (key) => store.head(key),
    list: (prefix, options) => store.list(prefix, options),
    delete: (key, options) => store.delete(key, options),
    put: async () => {
      throw new Error("offline");
    },
  };
  const queue: ImportQueue = [];
  enqueueImport(queue, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "c.bin",
    bytes: new TextEncoder().encode("later"),
  });
  await assert.rejects(() => flushImportQueue(device(broken), queue));
  assert.equal(queue.length, 1);
});

test("offline queue uploads under lock when flushed", async () => {
  const inner = new MemoryObjectStore();
  const lockOnBlob: boolean[] = [];
  const store: ObjectStore = {
    get: (key) => inner.get(key),
    head: (key) => inner.head(key),
    list: (prefix, options) => inner.list(prefix, options),
    delete: (key, options) => inner.delete(key, options),
    put: async (key, body, options?: PutOptions) => {
      if (key.includes("/blobs/")) {
        lockOnBlob.push((await inner.get(lockKey(""))) != null);
      }
      return inner.put(key, body, options);
    },
  };
  const lib = await createLibrary(device(store), "库");
  const folder = await createFolder(device(store), lib.id, null, "收件");
  const queue: ImportQueue = [];
  enqueueImport(queue, {
    libraryId: lib.id,
    parentFolderId: folder.id,
    name: "a.clip",
    bytes: new TextEncoder().encode("clip-bytes"),
    type: "artwork",
  });
  assert.equal(queue.length, 1);
  assert.equal(await inner.get(objectMetaKey("", "missing")), null);
  const [result] = await flushImportQueue(device(store), queue);
  assert.equal(queue.length, 0);
  assert.equal(result?.object.type, "artwork");
  assert.ok(lockOnBlob.every(Boolean));
  assert.equal(await inner.get(lockKey("")), null);
});
