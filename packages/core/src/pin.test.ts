import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLACEHOLDER_WEBP,
  createDeviceAssetCache,
  hydrateAssetCache,
  importAsset,
} from "./assets.ts";
import { blobKey } from "./keys.ts";
import {
  LOCAL_PIN_STORAGE_KEY,
  addPin,
  fetchOriginalOnDemand,
  hasPin,
  originalCacheKey,
  parsePins,
  purgeUnpinnedOriginals,
  serializePins,
} from "./pin.ts";
import { MemoryObjectStore } from "./store.ts";

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

test("pins stay local and are never written to the remote", async () => {
  const store = new MemoryObjectStore();
  const remote = { store, deviceId: "a", deviceName: "a", prefix: "" };
  const item = await importAsset(remote, {
    name: "hero.png",
    bytes: PNG_1X1,
    mimeType: "image/png",
    thumbBytes: PLACEHOLDER_WEBP,
  });
  const pins = addPin([], { scope: "asset", id: item.id });
  const serialized = serializePins(pins);
  assert.equal(LOCAL_PIN_STORAGE_KEY.startsWith("art-stock."), true);
  assert.equal(hasPin(parsePins(serialized), { scope: "asset", id: item.id }), true);
  const keys = (await store.list("")).keys.map((entry) => entry.key);
  assert.equal(keys.some((key) => key.includes("pin")), false);
  assert.equal(keys.includes(LOCAL_PIN_STORAGE_KEY), false);
});

test("unpinned cache has thumb/meta only; fetch then purge keeps remote blob", async () => {
  const store = new MemoryObjectStore();
  const remote = { store, deviceId: "a", deviceName: "a", prefix: "" };
  const item = await importAsset(remote, {
    name: "hero.png",
    bytes: PNG_1X1,
    mimeType: "image/png",
    thumbBytes: PLACEHOLDER_WEBP,
  });
  const device = createDeviceAssetCache();
  await hydrateAssetCache(store, "", device);
  assert.equal(device.thumbs.size, 1);
  assert.equal(device.originals.size, 0);
  const originals = new Map<string, Uint8Array>();
  const ref = {
    kind: "asset" as const,
    id: item.id,
    blobSha256: item.blobSha256,
  };
  const fetched = await fetchOriginalOnDemand(store, "", originals, ref, [], {
    pin: true,
  });
  assert.equal(fetched.bytes.byteLength, PNG_1X1.byteLength);
  assert.equal(hasPin(fetched.pins, { scope: "asset", id: item.id }), true);
  assert.ok(originals.get(originalCacheKey(ref)));
  const unpinned = await fetchOriginalOnDemand(
    store,
    "",
    new Map(),
    ref,
    [],
  );
  const cache = new Map([[originalCacheKey(ref), unpinned.bytes]]);
  const removed = purgeUnpinnedOriginals(cache, [], [ref]);
  assert.equal(removed, 1);
  assert.equal(cache.size, 0);
  assert.ok(await store.get(blobKey("", item.blobSha256)));
});

test("Pad wifi-only policy blocks cellular original fetch but cache hit still works", async () => {
  const store = new MemoryObjectStore();
  const remote = { store, deviceId: "a", deviceName: "a", prefix: "" };
  const item = await importAsset(remote, {
    name: "hero.png",
    bytes: PNG_1X1,
    mimeType: "image/png",
    thumbBytes: PLACEHOLDER_WEBP,
  });
  const device = createDeviceAssetCache();
  await hydrateAssetCache(store, "", device);
  assert.equal(device.thumbs.size, 1);
  assert.equal(device.originals.size, 0);
  const ref = {
    kind: "asset" as const,
    id: item.id,
    blobSha256: item.blobSha256,
  };
  const empty = new Map<string, Uint8Array>();
  await assert.rejects(
    () =>
      fetchOriginalOnDemand(store, "", empty, ref, [], {
        wifiOnly: true,
        network: "cellular",
      }),
    /WIFI_ONLY/,
  );
  assert.equal(empty.size, 0);
  const wifi = await fetchOriginalOnDemand(store, "", empty, ref, [], {
    wifiOnly: true,
    network: "wifi",
  });
  assert.equal(wifi.bytes.byteLength, PNG_1X1.byteLength);
  await fetchOriginalOnDemand(store, "", empty, ref, [], {
    wifiOnly: true,
    network: "cellular",
  });
});
