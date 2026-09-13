import assert from "node:assert/strict";
import { test } from "node:test";
import { blobKey, objectSnapshotKey } from "./keys.ts";
import { createLibrary } from "./libraries.ts";
import { importObjectNow } from "./import.ts";
import { MemoryObjectStore } from "./store.ts";
import {
  commitSnapshot,
  getBranch,
  listBranches,
  listConflictBranches,
  listSnapshots,
} from "./versions.ts";
import {
  conflictBadgeCount,
  countUnresolvedConflicts,
  resolveConflictBranch,
} from "./conflicts.ts";
import type { ObjectStore } from "./index.ts";

function device(store: ObjectStore, deviceId = "dev-a") {
  return { store, deviceId, deviceName: deviceId, prefix: "" };
}

async function fork(store: MemoryObjectStore) {
  const deviceA = device(store, "dev-a");
  const deviceB = device(store, "dev-b");
  const lib = await createLibrary(deviceA, "库");
  const imported = await importObjectNow(deviceA, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "hero.clip",
    bytes: new TextEncoder().encode("v0"),
    type: "artwork",
  });
  const objectId = imported.object.id;
  const base = await getBranch(store, "", objectId, "main");
  assert.ok(base);
  const fromA = await commitSnapshot(
    deviceA,
    objectId,
    new TextEncoder().encode("from-a"),
    "a",
  );
  const fromB = await commitSnapshot(
    deviceB,
    objectId,
    new TextEncoder().encode("from-b"),
    "b",
    "main",
    { expectedParentSnapshotId: base.pointer.snapshotId, nowMs: 1_780_000_000_000 },
  );
  return { objectId, fromA, fromB, deviceA };
}

test("badge counts conflict branches and failed ops", async () => {
  const store = new MemoryObjectStore();
  const { objectId } = await fork(store);
  assert.equal(await countUnresolvedConflicts(store, "", [objectId], 2), 3);
  assert.equal(conflictBadgeCount(1, 2), 3);
});

test("adopt-remote deletes the conflict branch and leaves main on the remote snapshot", async () => {
  const store = new MemoryObjectStore();
  const { objectId, fromA, fromB, deviceA } = await fork(store);
  const [conflict] = await listConflictBranches(store, "", objectId);
  assert.ok(conflict);
  await resolveConflictBranch(deviceA, objectId, conflict.name, "adopt-remote");
  assert.equal((await listConflictBranches(store, "", objectId)).length, 0);
  const main = await getBranch(store, "", objectId, "main");
  assert.equal(main?.pointer.snapshotId, fromA.id);
  assert.ok(await store.get(objectSnapshotKey("", objectId, fromB.id)));
  assert.ok(await store.get(blobKey("", fromB.blobSha256)));
});

test("adopt-local moves main to the conflict snapshot", async () => {
  const store = new MemoryObjectStore();
  const { objectId, fromB, deviceA } = await fork(store);
  const [conflict] = await listConflictBranches(store, "", objectId);
  assert.ok(conflict);
  await resolveConflictBranch(deviceA, objectId, conflict.name, "adopt-local");
  const main = await getBranch(store, "", objectId, "main");
  assert.equal(main?.pointer.snapshotId, fromB.id);
  assert.equal((await listConflictBranches(store, "", objectId)).length, 0);
});

test("keep-both renames the conflict branch and keeps both snapshots", async () => {
  const store = new MemoryObjectStore();
  const { objectId, fromA, fromB, deviceA } = await fork(store);
  const [conflict] = await listConflictBranches(store, "", objectId);
  assert.ok(conflict);
  const kept = await resolveConflictBranch(
    deviceA,
    objectId,
    conflict.name,
    "keep-both",
    { keepAs: "mine" },
  );
  assert.equal(kept?.name, "mine");
  assert.equal(kept?.snapshotId, fromB.id);
  const names = (await listBranches(store, "", objectId)).map((item) => item.name);
  assert.ok(names.includes("mine"));
  assert.ok(names.includes("main"));
  assert.equal(names.some((name) => name.startsWith("conflict/")), false);
  const main = await getBranch(store, "", objectId, "main");
  assert.equal(main?.pointer.snapshotId, fromA.id);
  assert.equal((await listSnapshots(store, "", objectId)).length >= 3, true);
  assert.equal((await listConflictBranches(store, "", objectId)).length, 0);
});
