import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_ASSET_CACHE_POLICY,
  PLACEHOLDER_WEBP,
  addAssetTag,
  assetsMatchingTags,
  createAssetFolder,
  createDeviceAssetCache,
  hydrateAssetCache,
  importAsset,
  isWebp,
  listAssetFolders,
  listAssets,
  mergeAssetMeta,
  moveAssetToFolder,
  setAssetRating,
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

test("asset folders persist in index and items can move between them", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const folder = await createAssetFolder(remote, "角色");
  assert.equal((await listAssetFolders(store, "")).map((item) => item.name).join(), "角色");
  const item = await importAsset(remote, {
    name: "hero.png",
    bytes: PNG_1X1,
    mimeType: "image/png",
    folderId: folder.id,
    thumbBytes: PLACEHOLDER_WEBP,
  });
  assert.equal(item.folderId, folder.id);
  const moved = await moveAssetToFolder(remote, item.id, null);
  assert.equal(moved.folderId, null);
});

test("asset tags are an OR-Set union and rating is LWW 0-5", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const item = await importAsset(remote, {
    name: "hero.png",
    bytes: PNG_1X1,
    mimeType: "image/png",
    thumbBytes: PLACEHOLDER_WEBP,
  });
  const tagged = await addAssetTag(remote, item.id, "角色");
  assert.deepEqual(tagged.tags, ["角色"]);
  const rated = await setAssetRating(remote, item.id, 4, { nowMs: 100 });
  assert.equal(rated.rating, 4);
  const later = { ...rated, rating: 1 as const, ratingHlc: { ts: 200, c: 0, deviceId: "b" } };
  const earlier = { ...rated, rating: 5 as const, ratingHlc: { ts: 50, c: 0, deviceId: "a" } };
  const otherTags = {
    ...rated,
    tags: ["场景"],
    tagSet: {
      adds: [{ value: "场景", hlc: { ts: 1, c: 0, deviceId: "b" } }],
      removes: [],
    },
  };
  const merged = mergeAssetMeta(earlier, otherTags);
  assert.ok(merged.tags.includes("角色"));
  assert.ok(merged.tags.includes("场景"));
  assert.equal(mergeAssetMeta(earlier, later).rating, 1);
  assert.equal(assetsMatchingTags([merged], ["角色", "场景"]).length, 1);
});
