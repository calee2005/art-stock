import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeJson } from "./json.ts";
import { lockKey, libraryMetaKey, libraryTreeKey, manifestKey } from "./keys.ts";
import {
  createLibrary,
  listLibraries,
  readManifest,
  renameLibrary,
} from "./libraries.ts";
import { MemoryObjectStore } from "./store.ts";
import type { Manifest, ObjectStore, PutOptions } from "./index.ts";

function device(
  store: ObjectStore,
  id: string,
  prefix = "",
): { store: ObjectStore; deviceId: string; deviceName: string; prefix: string } {
  return { store, deviceId: id, deviceName: id, prefix };
}

test("create two libraries, list them, rename updates manifest", async () => {
  const store = new MemoryObjectStore();
  const a = device(store, "client-a");
  const one = await createLibrary(a, "角色设定");
  const two = await createLibrary(a, " 场景 ");
  assert.notEqual(one.id, two.id);
  assert.equal(two.name, "场景");

  const listed = await listLibraries(store, "");
  assert.equal(listed.length, 2);
  assert.deepEqual(
    listed.map((item) => item.name).sort(),
    ["场景", "角色设定"],
  );

  const renamed = await renameLibrary(a, one.id, "角色设定-v2");
  assert.equal(renamed.name, "角色设定-v2");
  const after = await listLibraries(store, "");
  assert.ok(after.some((item) => item.id === one.id && item.name === "角色设定-v2"));
});

test("writes go through the lock and update manifest.json", async () => {
  const inner = new MemoryObjectStore();
  const lockPresentOnManifestPut: boolean[] = [];
  const store: ObjectStore = {
    get: (key) => inner.get(key),
    head: (key) => inner.head(key),
    list: (prefix, options) => inner.list(prefix, options),
    delete: (key, options) => inner.delete(key, options),
    put: async (key, body, options?: PutOptions) => {
      if (key === manifestKey("")) {
        const lock = await inner.get(lockKey(""));
        lockPresentOnManifestPut.push(lock != null);
      }
      return inner.put(key, body, options);
    },
  };
  await createLibrary(device(store, "client-a"), "库一");
  assert.deepEqual(lockPresentOnManifestPut, [true]);
  assert.equal(await inner.get(lockKey("")), null);

  const { manifest } = await readManifest(inner, "");
  assert.ok(manifest);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.libraries.length, 1);
  assert.equal(manifest.updatedBy, "client-a");
  const json = JSON.parse(
    new TextDecoder().decode((await inner.get(manifestKey("")))!.body),
  ) as Manifest;
  assert.equal("libraries" in json, true);
  assert.doesNotMatch(JSON.stringify(json), /_/);
});

test("another client lists the same libraries from the shared remote", async () => {
  const remote = new MemoryObjectStore();
  await createLibrary(device(remote, "studio-pc", "art/"), "A");
  await createLibrary(device(remote, "studio-pc", "art/"), "B");
  const fromPad = await listLibraries(remote, "art/");
  assert.equal(fromPad.length, 2);
  assert.deepEqual(fromPad.map((item) => item.name).sort(), ["A", "B"]);
  const meta = await remote.get(libraryMetaKey("art/", fromPad[0]!.id));
  assert.ok(meta);
  const tree = await remote.get(libraryTreeKey("art/", fromPad[0]!.id));
  assert.ok(tree);
  const parsed = decodeJson(tree.body) as { nodes: unknown[] };
  assert.deepEqual(parsed.nodes, []);
});
