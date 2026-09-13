import assert from "node:assert/strict";
import { test } from "node:test";
import { blobKey, objectSnapshotKey } from "./keys.ts";
import { createLibrary } from "./libraries.ts";
import { importObjectNow } from "./import.ts";
import { MemoryObjectStore } from "./store.ts";
import {
  commitSnapshot,
  conflictBranchName,
  createBranch,
  deleteBranch,
  getBranch,
  isConflictBranch,
  listBranches,
  listConflictBranches,
  listSnapshots,
  rollbackBranch,
  switchDefaultBranch,
  validateBranchName,
} from "./versions.ts";
import type { ObjectStore } from "./index.ts";

function device(store: ObjectStore, deviceId = "dev-a") {
  return { store, deviceId, deviceName: deviceId, prefix: "" };
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

test("named branch alt is a pointer copy; commit on alt does not move main", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const lib = await createLibrary(remote, "库");
  const imported = await importObjectNow(remote, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "hero.clip",
    bytes: new TextEncoder().encode("v1"),
    type: "artwork",
  });
  const objectId = imported.object.id;
  const mainBefore = await getBranch(store, "", objectId, "main");
  assert.ok(mainBefore);
  const alt = await createBranch(remote, objectId, "alt");
  assert.equal(alt.snapshotId, mainBefore.pointer.snapshotId);
  const names = (await listBranches(store, "", objectId)).map((b) => b.name);
  assert.deepEqual(names, ["alt", "main"]);
  const onAlt = await commitSnapshot(
    remote,
    objectId,
    new TextEncoder().encode("alt-v2"),
    "work on alt",
    "alt",
  );
  assert.equal(onAlt.branch, "alt");
  const mainAfter = await getBranch(store, "", objectId, "main");
  const altAfter = await getBranch(store, "", objectId, "alt");
  assert.equal(mainAfter?.pointer.snapshotId, mainBefore.pointer.snapshotId);
  assert.equal(altAfter?.pointer.snapshotId, onAlt.id);
  assert.notEqual(altAfter?.pointer.snapshotId, mainAfter?.pointer.snapshotId);
  const switched = await switchDefaultBranch(remote, objectId, "alt");
  assert.equal(switched.defaultBranch, "alt");
  await switchDefaultBranch(remote, objectId, "main");
  await deleteBranch(remote, objectId, "alt");
  assert.equal((await listBranches(store, "", objectId)).length, 1);
});

test("branch names are named pointers not Git refs", () => {
  assert.equal(validateBranchName("alt"), "alt");
  assert.equal(validateBranchName("feat/v2"), "feat/v2");
  assert.throws(() => validateBranchName(""), /1–64/);
  assert.throws(() => validateBranchName("a".repeat(65)), /1–64/);
  assert.throws(() => validateBranchName("has space"), /Git ref/);
  assert.throws(() => validateBranchName("../escape"), /Git ref/);
  assert.throws(() => validateBranchName("/leading"), /Git ref/);
});

test("two devices on the same branch with different parents create a conflict branch", async () => {
  const store = new MemoryObjectStore();
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
    "device a",
  );
  const mainAfterA = await getBranch(store, "", objectId, "main");
  assert.equal(mainAfterA?.pointer.snapshotId, fromA.id);
  const nowMs = 1_780_000_000_000;
  const fromB = await commitSnapshot(
    deviceB,
    objectId,
    new TextEncoder().encode("from-b"),
    "device b",
    "main",
    { expectedParentSnapshotId: base.pointer.snapshotId, nowMs },
  );
  const expectedName = conflictBranchName(deviceB.deviceId, {
    ts: nowMs,
    c: 0,
    deviceId: deviceB.deviceId,
  });
  assert.equal(fromB.branch, expectedName);
  assert.equal(fromB.parentSnapshotId, base.pointer.snapshotId);
  assert.ok(isConflictBranch(fromB.branch));
  const remoteMain = await getBranch(store, "", objectId, "main");
  assert.equal(remoteMain?.pointer.snapshotId, fromA.id);
  assert.equal(remoteMain?.pointer.updatedBy, "dev-a");
  const conflicts = await listConflictBranches(store, "", objectId);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.name, expectedName);
  assert.equal(conflicts[0]?.snapshotId, fromB.id);
  assert.ok(await store.get(objectSnapshotKey("", objectId, fromA.id)));
  assert.ok(await store.get(objectSnapshotKey("", objectId, fromB.id)));
  assert.ok(await store.get(blobKey("", fromA.blobSha256)));
  assert.ok(await store.get(blobKey("", fromB.blobSha256)));
  assert.notEqual(fromA.blobSha256, fromB.blobSha256);
});
