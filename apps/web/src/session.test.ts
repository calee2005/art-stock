import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MemoryObjectStore,
  lockKey,
  protocolRoot,
} from "@art-stock/core";
import {
  assertCanWrite,
  emptyRemoteForm,
  formToConfig,
  getManifest,
  hasCredentials,
  listProtocolKeys,
  loadRemoteForm,
  probeReadwrite,
  putWithGlobalLock,
  saveRemoteForm,
  type StorageLike,
} from "./session.ts";

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

test("form prefix defaults empty and saves without contacting a bucket", () => {
  const storage = memoryStorage();
  const form = emptyRemoteForm();
  assert.equal(form.prefix, "");
  assert.equal(hasCredentials(form), false);
  saveRemoteForm(storage, {
    ...form,
    endpoint: "https://minio.local:9000",
    bucket: "art",
    accessKeyId: "AK",
    secretAccessKey: "SK",
    prefix: "art",
    forcePathStyle: true,
  });
  const loaded = loadRemoteForm(storage);
  assert.ok(loaded);
  assert.equal(loaded.forcePathStyle, true);
  const config = formToConfig(loaded);
  assert.equal(config.prefix, "art/");
  assert.equal(protocolRoot(config.prefix), "art/.artstock/v1/");
});

test("probe failure must not be accepted as readwrite", async () => {
  const store = new MemoryObjectStore({ conditionalWrites: false });
  const result = await probeReadwrite(store, "");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "REMOTE_UNSUPPORTED");
  }
});

test("readonly mode disables write entry", () => {
  assert.throws(() => assertCanWrite("readonly"), /只读/);
  assertCanWrite("readwrite");
});

test("list/get and PUT observe lock.json while holding the lock", async () => {
  const store = new MemoryObjectStore();
  await store.put(
    "art/.artstock/v1/manifest.json",
    new TextEncoder().encode(
      JSON.stringify({ schemaVersion: 1, libraries: [] }),
    ),
  );
  const listed = await listProtocolKeys(store, "art/");
  assert.ok(listed.includes("art/.artstock/v1/manifest.json"));
  const manifest = await getManifest(store, "art/");
  assert.ok(manifest);

  const config = formToConfig({
    ...emptyRemoteForm(),
    name: "demo",
    endpoint: "https://minio.local",
    bucket: "art",
    prefix: "art/",
    accessKeyId: "AK",
    secretAccessKey: "SK",
    forcePathStyle: true,
    mode: "readwrite",
  });
  const result = await putWithGlobalLock(
    store,
    config,
    { deviceId: "web-1", deviceName: "web" },
    "hello.txt",
    "hi",
  );
  assert.equal(result.lockSeenDuringPut, true);
  assert.equal(result.putKey, "art/.artstock/v1/hello.txt");
  assert.equal(await store.get(lockKey("art/")), null);
  const hello = await store.get(result.putKey);
  assert.equal(new TextDecoder().decode(hello?.body ?? new Uint8Array()), "hi");
});
