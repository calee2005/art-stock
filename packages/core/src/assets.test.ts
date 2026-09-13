import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_ASSET_CACHE_POLICY,
  PLACEHOLDER_WEBP,
  createDeviceAssetCache,
  hydrateAssetCache,
  importAsset,
  isWebp,
  listAssets,
} from "./assets.ts";
import { assetItemMetaKey, assetThumbKey, blobKey } from "./keys.ts";
import { MemoryObjectStore } from "./store.ts";
import type { ObjectStore } from "./index.ts";

function device(store: ObjectStore) {
  return { store, deviceId: "desk-a", deviceName: "desk-a", prefix: "" };
}

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

test("import writes assets/items meta, thumb.webp and blob under lock", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const item = await importAsset(remote, {
    name: "hero.png",
    bytes: PNG_1X1,
    mimeType: "image/png",
    thumbBytes: PLACEHOLDER_WEBP,
  });
  assert.equal(item.width, 1);
  assert.equal(item.height, 1);
  assert.ok(isWebp(PLACEHOLDER_WEBP));
  assert.ok(await store.get(assetItemMetaKey("", item.id)));
  const thumb = await store.get(assetThumbKey("", item.id));
  assert.ok(thumb);
  assert.equal(thumb.contentType, "image/webp");
  assert.ok(await store.get(blobKey("", item.blobSha256)));
  assert.equal((await listAssets(store, "")).length, 1);
});

test("default cache policy hydrates thumbs not originals", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const item = await importAsset(remote, {
    name: "hero.png",
    bytes: PNG_1X1,
    mimeType: "image/png",
    thumbBytes: PLACEHOLDER_WEBP,
  });
  const cache = createDeviceAssetCache();
  await hydrateAssetCache(store, "", cache, DEFAULT_ASSET_CACHE_POLICY);
  assert.equal(cache.meta.size, 1);
  assert.equal(cache.thumbs.size, 1);
  assert.equal(cache.originals.size, 0);
  await hydrateAssetCache(store, "", cache, { cacheOriginals: true });
  assert.equal(cache.originals.get(item.id)?.byteLength, PNG_1X1.byteLength);
});
