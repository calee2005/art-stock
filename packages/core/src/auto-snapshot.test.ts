import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAutoSnapshotController,
  createManualClock,
  DEFAULT_SNAPSHOT_POLICY,
} from "./auto-snapshot.ts";
import { createLibrary } from "./libraries.ts";
import { importObjectNow } from "./import.ts";
import { MemoryObjectStore } from "./store.ts";
import { getBranch, listSnapshots } from "./versions.ts";
import type { ObjectStore } from "./index.ts";

function device(store: ObjectStore) {
  return { store, deviceId: "desk-a", deviceName: "desk-a", prefix: "" };
}

test("auto-on-save debounce: rapid saves produce one extra snapshot", async () => {
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
  const before = await getBranch(store, "", objectId, "main");
  assert.ok(before);
  const clock = createManualClock();
  const controller = createAutoSnapshotController({ scheduler: clock });
  const policy = { mode: "auto-on-save" as const, minIntervalMs: 50 };
  const first = controller.notifyFileSaved(
    remote,
    objectId,
    new TextEncoder().encode("burst-1"),
    policy,
  );
  const second = controller.notifyFileSaved(
    remote,
    objectId,
    new TextEncoder().encode("burst-2"),
    policy,
  );
  assert.equal((await first).status, "superseded");
  await clock.advance(50);
  const committed = await second;
  assert.equal(committed.status, "committed");
  if (committed.status !== "committed") {
    throw new Error("expected commit");
  }
  const snaps = await listSnapshots(store, "", objectId);
  assert.equal(snaps.length, 2);
  const main = await getBranch(store, "", objectId, "main");
  assert.equal(main?.pointer.snapshotId, committed.snapshot.id);
  assert.notEqual(main?.pointer.snapshotId, before.pointer.snapshotId);
  assert.equal(committed.snapshot.message, "auto-save");
});

test("manual mode never commits on file save", async () => {
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
  const controller = createAutoSnapshotController();
  const result = await controller.notifyFileSaved(
    remote,
    imported.object.id,
    new TextEncoder().encode("ignored"),
    { mode: "manual", minIntervalMs: 1 },
  );
  assert.equal(result.status, "skipped-manual");
  assert.equal((await listSnapshots(store, "", imported.object.id)).length, 1);
});

test("default policy is auto-on-save with 5000ms debounce", () => {
  assert.equal(DEFAULT_SNAPSHOT_POLICY.mode, "auto-on-save");
  assert.equal(DEFAULT_SNAPSHOT_POLICY.minIntervalMs, 5000);
});
