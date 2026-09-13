import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeJson } from "./json.ts";
import { lockKey } from "./keys.ts";
import { createLibrary } from "./libraries.ts";
import { SCHEMA_VERSION, type LockDocument } from "./types.ts";
import { MemoryObjectStore } from "./store.ts";
import {
  createSyncState,
  enqueueSyncImport,
  pendingCount,
  pushSync,
  setSyncPaused,
} from "./sync.ts";
import type { ObjectStore } from "./index.ts";

function device(store: ObjectStore, id = "dev-a") {
  return { store, deviceId: id, deviceName: id, prefix: "" };
}

function lockDoc(deviceName: string, expiresAt: string): LockDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    fencingToken: 1,
    deviceId: "other",
    deviceName,
    purpose: "sync",
    acquiredAt: "2026-09-13T00:00:00.000Z",
    heartbeatAt: "2026-09-13T00:00:00.000Z",
    expiresAt,
  };
}

test("paused sync keeps the queue", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const lib = await createLibrary(remote, "库");
  const state = createSyncState();
  enqueueSyncImport(state, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "a.bin",
    bytes: new TextEncoder().encode("a"),
  });
  setSyncPaused(state, true);
  const result = await pushSync(remote, state);
  assert.equal(result.status, "paused");
  assert.equal(pendingCount(state), 1);
  assert.equal(result.pending, 1);
});

test("occupied lock shows deviceName and TTL and does not write", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const lib = await createLibrary(remote, "库");
  const expiresAt = new Date(Date.now() + 45_000).toISOString();
  await store.put(lockKey(""), encodeJson(lockDoc("studio-pc", expiresAt)), {
    contentType: "application/json",
  });
  const state = createSyncState();
  enqueueSyncImport(state, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "b.bin",
    bytes: new TextEncoder().encode("b"),
  });
  const listedBefore = await store.list(".artstock/v1/objects/");
  const result = await pushSync(remote, state, { now: () => new Date() });
  assert.equal(result.status, "lock-held");
  if (result.status !== "lock-held") {
    throw new Error("expected lock-held");
  }
  assert.equal(result.deviceName, "studio-pc");
  assert.ok(result.ttlMs > 0);
  assert.equal(pendingCount(state), 1);
  const listedAfter = await store.list(".artstock/v1/objects/");
  assert.equal(listedAfter.keys.length, listedBefore.keys.length);
});

test("flushing reports remaining pending count of zero", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const lib = await createLibrary(remote, "库");
  const state = createSyncState();
  enqueueSyncImport(state, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "c.bin",
    bytes: new TextEncoder().encode("c"),
  });
  assert.equal(pendingCount(state), 1);
  const result = await pushSync(remote, state);
  assert.equal(result.status, "flushed");
  assert.equal(pendingCount(state), 0);
  if (result.status === "flushed") {
    assert.equal(result.flushed, 1);
  }
});
