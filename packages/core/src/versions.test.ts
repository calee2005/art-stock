import assert from "node:assert/strict";
import { test } from "node:test";
import { blobKey, objectSnapshotKey } from "./keys.ts";
import { createLibrary } from "./libraries.ts";
import { importObjectNow } from "./import.ts";
import { MemoryObjectStore } from "./store.ts";
import {
  commitSnapshot,
  getBranch,
  listSnapshots,
  rollbackBranch,
} from "./versions.ts";
import type { ObjectStore } from "./index.ts";

function device(store: ObjectStore) {
  return { store, deviceId: "dev-a", deviceName: "dev-a", prefix: "" };
}

test("two commits create two snapshots and rollback only moves the branch pointer", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const lib = await createLibrary(remote, "库");
  const firstBytes = new TextEncoder().encode("v1");
  const imported = await importObjectNow(remote, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "hero.clip",
    bytes: firstBytes,
    type: "artwork",
  });
  const firstSha = imported.blobSha256;
  const second = await commitSnapshot(
    remote,
    imported.object.id,
    new TextEncoder().encode("v2"),
    "second",
  );
  const snaps = await listSnapshots(store, "", imported.object.id);
  assert.equal(snaps.length, 2);
  const branch = await getBranch(store, "", imported.object.id, "main");
  assert.equal(branch?.pointer.snapshotId, second.id);
  const firstSnap = snaps.find((item) => item.blobSha256 === firstSha);
  assert.ok(firstSnap);
  await rollbackBranch(remote, imported.object.id, firstSnap.id);
  const rolled = await getBranch(store, "", imported.object.id, "main");
  assert.equal(rolled?.pointer.snapshotId, firstSnap.id);
  assert.equal((await listSnapshots(store, "", imported.object.id)).length, 2);
  assert.ok(await store.get(objectSnapshotKey("", imported.object.id, second.id)));
  assert.ok(await store.get(blobKey("", firstSha)));
  assert.ok(await store.get(blobKey("", second.blobSha256)));
  assert.notEqual(firstSha, second.blobSha256);
});
