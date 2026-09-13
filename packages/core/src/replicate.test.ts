import assert from "node:assert/strict";
import { test } from "node:test";
import { blobKey, lockKey, objectMetaKey } from "./keys.ts";
import { decodeJson } from "./json.ts";
import { createLibrary } from "./libraries.ts";
import { importObjectNow } from "./import.ts";
import { MemoryObjectStore } from "./store.ts";
import {
  replicateObject,
  sortRemotesById,
  withOrderedRemoteLocks,
  type NamedRemote,
} from "./replicate.ts";
import type { LockDocument, ObjectMeta } from "./types.ts";

function named(
  store: MemoryObjectStore,
  remoteId: string,
  deviceId = remoteId,
): NamedRemote {
  return {
    remoteId,
    store,
    prefix: "",
    deviceId,
    deviceName: remoteId,
  };
}

test("remote lock order follows remoteId lexicography regardless of input order", async () => {
  const nas = new MemoryObjectStore();
  const oss = new MemoryObjectStore();
  const remotes = [named(oss, "oss-aliyun"), named(nas, "nas-home")];
  assert.deepEqual(
    sortRemotesById(remotes).map((item) => item.remoteId),
    ["nas-home", "oss-aliyun"],
  );
  const acquired: string[] = [];
  for (const remote of remotes) {
    const orig = remote.store.put.bind(remote.store);
    remote.store.put = async (key, body, options) => {
      if (key === lockKey("")) {
        acquired.push(`${remote.remoteId}:${(decodeJson(body) as LockDocument).purpose}`);
      }
      return orig(key, body, options);
    };
  }
  await withOrderedRemoteLocks(remotes, "replicate", async () => {
    assert.ok(await nas.get(lockKey("")));
    assert.ok(await oss.get(lockKey("")));
    return "ok";
  });
  assert.deepEqual(
    acquired.map((item) => item.split(":")[0]),
    ["nas-home", "oss-aliyun"],
  );
  assert.ok(acquired.every((item) => item.endsWith(":replicate")));
  assert.equal(await nas.get(lockKey("")), null);
  assert.equal(await oss.get(lockKey("")), null);
});

test("OSS object is copied to NAS and replicas become ok", async () => {
  const ossStore = new MemoryObjectStore();
  const nasStore = new MemoryObjectStore();
  const oss = named(ossStore, "oss-aliyun");
  const nas = named(nasStore, "nas-home");
  const lib = await createLibrary(oss, "库");
  const imported = await importObjectNow(oss, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "hero.clip",
    bytes: new TextEncoder().encode("oss-bytes"),
    type: "artwork",
  });
  assert.equal(await nasStore.get(objectMetaKey("", imported.object.id)), null);
  const replicas = await replicateObject([oss, nas], imported.object.id);
  assert.equal(replicas["oss-aliyun"], "ok");
  assert.equal(replicas["nas-home"], "ok");
  const nasMeta = decodeJson(
    (await nasStore.get(objectMetaKey("", imported.object.id)))!.body,
  ) as ObjectMeta;
  assert.equal(nasMeta.name, "hero.clip");
  assert.deepEqual(nasMeta.replicas, replicas);
  const ossMeta = decodeJson(
    (await ossStore.get(objectMetaKey("", imported.object.id)))!.body,
  ) as ObjectMeta;
  assert.equal(ossMeta.replicas?.["nas-home"], "ok");
  assert.ok(await nasStore.get(blobKey("", imported.blobSha256)));
});
