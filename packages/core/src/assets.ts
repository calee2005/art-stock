import { encodeJson, decodeJson } from "./json.ts";
import { sha256Hex } from "./hash.ts";
import {
  assetIndexKey,
  assetItemMetaKey,
  assetThumbKey,
  blobKey,
} from "./keys.ts";
import {
  withRemoteLock,
  type RemoteLockTarget,
  type WithRemoteLockOptions,
} from "./lock.ts";
import { isStoreError } from "./store-error.ts";
import { SCHEMA_VERSION, type AssetFolder, type AssetIndex, type AssetItem, type AssetRating, type Hlc } from "./types.ts";
import { compareHlc, createHlcClock, tickHlc, type HlcClock } from "./hlc.ts";
import {
  addToOrSet,
  removeFromOrSet,
} from "./orset.ts";
import {
  applyTagSet,
  mergeEntityTags,
  tagSetOf,
} from "./tags.ts";
import type { ObjectStore } from "./store.ts";

const lockOpts = (options?: WithRemoteLockOptions): WithRemoteLockOptions => ({
  probe: false,
  scheduleHeartbeat: () => () => {},
  ...options,
});

function nowIso(): string {
  return new Date().toISOString();
}

/** 1×1 lossless WebP used when a generator is not available. */
export const PLACEHOLDER_WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x2a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
  0x50, 0x38, 0x4c, 0x14, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x07,
  0x10, 0x11, 0xfd, 0x21, 0xa0, 0x00, 0x02, 0x00, 0x00,
]);

export const DEFAULT_ASSET_CACHE_POLICY = { cacheOriginals: false as const };

export type ImportAssetInput = {
  name: string;
  bytes: Uint8Array;
  mimeType?: string;
  folderId?: string | null;
  thumbBytes?: Uint8Array;
  width?: number;
  height?: number;
  sourceObjectId?: string;
};

async function putBlobIfAbsent(
  remote: RemoteLockTarget,
  sha: string,
  bytes: Uint8Array,
): Promise<void> {
  const key = blobKey(remote.prefix ?? "", sha);
  if (await remote.store.get(key)) {
    return;
  }
  try {
    await remote.store.put(key, bytes, {
      contentType: "application/octet-stream",
      ifNoneMatch: "*",
      forbidOverwrite: true,
    });
  } catch (error) {
    if (isStoreError(error) && error.code === "PRECONDITION_FAILED") {
      return;
    }
    throw error;
  }
}

export function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

export function readPngSize(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  if (bytes.length < 24) {
    return undefined;
  }
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((value, i) => bytes[i] === value)) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export async function listAssets(
  store: ObjectStore,
  prefix: string,
): Promise<AssetItem[]> {
  const listed = await store.list(objectKeyAssetsItems(prefix));
  const items: AssetItem[] = [];
  for (const object of listed.keys) {
    if (!object.key.endsWith("/meta.json")) {
      continue;
    }
    const got = await store.get(object.key);
    if (!got) {
      continue;
    }
    items.push(decodeJson(got.body) as AssetItem);
  }
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function objectKeyAssetsItems(prefix: string): string {
  return assetIndexKey(prefix).replace(/index\.json$/, "items/");
}

export async function getAssetMeta(
  store: ObjectStore,
  prefix: string,
  assetId: string,
): Promise<AssetItem | null> {
  const got = await store.get(assetItemMetaKey(prefix, assetId));
  if (!got) {
    return null;
  }
  return decodeJson(got.body) as AssetItem;
}

export async function importAsset(
  remote: RemoteLockTarget,
  job: ImportAssetInput,
  options?: WithRemoteLockOptions,
): Promise<AssetItem> {
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "upload",
    async () => {
      const sha = await sha256Hex(job.bytes);
      await putBlobIfAbsent(remote, sha, job.bytes);
      const id = crypto.randomUUID();
      const at = nowIso();
      const png = readPngSize(job.bytes);
      const thumb = job.thumbBytes ?? PLACEHOLDER_WEBP;
      const thumbKeyRel = `assets/items/${id}/thumb.webp`;
      const item: AssetItem = {
        schemaVersion: SCHEMA_VERSION,
        id,
        name: job.name,
        folderId: job.folderId ?? null,
        tags: [],
        rating: 0,
        width: job.width ?? png?.width,
        height: job.height ?? png?.height,
        mimeType: job.mimeType ?? "application/octet-stream",
        blobSha256: sha,
        thumbKey: thumbKeyRel,
        sourceObjectId: job.sourceObjectId,
        createdAt: at,
        updatedAt: at,
      };
      await remote.store.put(assetThumbKey(prefix, id), thumb, {
        contentType: "image/webp",
      });
      await remote.store.put(assetItemMetaKey(prefix, id), encodeJson(item), {
        contentType: "application/json",
        ifNoneMatch: "*",
      });
      const indexGot = await remote.store.get(assetIndexKey(prefix));
      const index: AssetIndex = indexGot
        ? (decodeJson(indexGot.body) as AssetIndex)
        : {
            schemaVersion: SCHEMA_VERSION,
            updatedAt: at,
            updatedBy: remote.deviceId,
            folders: [],
            items: [],
          };
      index.folders = index.folders ?? [];
      index.updatedAt = at;
      index.updatedBy = remote.deviceId;
      index.items.push({
        id,
        name: item.name,
        folderId: item.folderId,
        thumbKey: item.thumbKey,
      });
      await remote.store.put(assetIndexKey(prefix), encodeJson(index), {
        contentType: "application/json",
        ...(indexGot ? { ifMatch: indexGot.etag } : { ifNoneMatch: "*" }),
      });
      return item;
    },
    lockOpts(options),
  );
}

export type DeviceAssetCache = {
  meta: Map<string, AssetItem>;
  thumbs: Map<string, Uint8Array>;
  originals: Map<string, Uint8Array>;
};

export function createDeviceAssetCache(): DeviceAssetCache {
  return { meta: new Map(), thumbs: new Map(), originals: new Map() };
}

/** Pull meta + thumbs. Original blobs only when cacheOriginals is true. */
export async function hydrateAssetCache(
  store: ObjectStore,
  prefix: string,
  cache: DeviceAssetCache,
  policy = DEFAULT_ASSET_CACHE_POLICY,
): Promise<void> {
  const items = await listAssets(store, prefix);
  for (const item of items) {
    cache.meta.set(item.id, item);
    const thumb = await store.get(assetThumbKey(prefix, item.id));
    if (thumb) {
      cache.thumbs.set(item.id, thumb.body);
    }
    if (policy.cacheOriginals) {
      const blob = await store.get(blobKey(prefix, item.blobSha256));
      if (blob) {
        cache.originals.set(item.id, blob.body);
      }
    }
  }
}

function normalizeIndex(index: AssetIndex): AssetIndex {
  return { ...index, folders: index.folders ?? [] };
}

async function loadIndex(
  store: ObjectStore,
  prefix: string,
): Promise<{ index: AssetIndex; etag: string } | null> {
  const got = await store.get(assetIndexKey(prefix));
  if (!got) {
    return null;
  }
  return { index: normalizeIndex(decodeJson(got.body) as AssetIndex), etag: got.etag };
}

export function wouldCreateAssetFolderCycle(
  folders: AssetFolder[],
  folderId: string,
  newParentId: string | null,
): boolean {
  if (newParentId == null) {
    return false;
  }
  if (newParentId === folderId) {
    return true;
  }
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const seen = new Set<string>();
  let current: string | null = newParentId;
  while (current) {
    if (current === folderId) {
      return true;
    }
    if (seen.has(current)) {
      return true;
    }
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

export async function listAssetFolders(
  store: ObjectStore,
  prefix: string,
): Promise<AssetFolder[]> {
  const loaded = await loadIndex(store, prefix);
  return loaded?.index.folders ?? [];
}

export async function createAssetFolder(
  remote: RemoteLockTarget,
  name: string,
  parentId: string | null = null,
  options?: WithRemoteLockOptions,
): Promise<AssetFolder> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Folder name must not be empty");
  }
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const at = nowIso();
      const loaded = await loadIndex(remote.store, prefix);
      const index: AssetIndex = loaded?.index ?? {
        schemaVersion: SCHEMA_VERSION,
        updatedAt: at,
        updatedBy: remote.deviceId,
        folders: [],
        items: [],
      };
      if (parentId && !index.folders.some((folder) => folder.id === parentId)) {
        throw new Error(`Folder not found: ${parentId}`);
      }
      const folder: AssetFolder = {
        id: crypto.randomUUID(),
        name: trimmed,
        parentId,
        order: index.folders.length,
      };
      index.folders.push(folder);
      index.updatedAt = at;
      index.updatedBy = remote.deviceId;
      await remote.store.put(assetIndexKey(prefix), encodeJson(index), {
        contentType: "application/json",
        ...(loaded ? { ifMatch: loaded.etag } : { ifNoneMatch: "*" }),
      });
      return folder;
    },
    lockOpts(options),
  );
}

export async function moveAssetToFolder(
  remote: RemoteLockTarget,
  assetId: string,
  folderId: string | null,
  options?: WithRemoteLockOptions,
): Promise<AssetItem> {
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const loaded = await loadIndex(remote.store, prefix);
      if (folderId) {
        if (!loaded?.index.folders.some((folder) => folder.id === folderId)) {
          throw new Error(`Folder not found: ${folderId}`);
        }
      }
      const metaGot = await remote.store.get(assetItemMetaKey(prefix, assetId));
      if (!metaGot) {
        throw new Error(`Asset not found: ${assetId}`);
      }
      const item = decodeJson(metaGot.body) as AssetItem;
      item.folderId = folderId;
      item.updatedAt = nowIso();
      await remote.store.put(assetItemMetaKey(prefix, assetId), encodeJson(item), {
        contentType: "application/json",
        ifMatch: metaGot.etag,
      });
      if (loaded) {
        const entry = loaded.index.items.find((row) => row.id === assetId);
        if (entry) {
          entry.folderId = folderId;
        }
        loaded.index.updatedAt = item.updatedAt;
        loaded.index.updatedBy = remote.deviceId;
        await remote.store.put(assetIndexKey(prefix), encodeJson(loaded.index), {
          contentType: "application/json",
          ifMatch: loaded.etag,
        });
      }
      return item;
    },
    lockOpts(options),
  );
}

export type AssetWriteOptions = WithRemoteLockOptions & {
  clock?: HlcClock;
  nowMs?: number;
};

export async function addAssetTag(
  remote: RemoteLockTarget,
  assetId: string,
  tag: string,
  options?: AssetWriteOptions,
): Promise<AssetItem> {
  return writeAssetTag(remote, assetId, tag, "add", options);
}

export async function removeAssetTag(
  remote: RemoteLockTarget,
  assetId: string,
  tag: string,
  options?: AssetWriteOptions,
): Promise<AssetItem> {
  return writeAssetTag(remote, assetId, tag, "remove", options);
}

async function writeAssetTag(
  remote: RemoteLockTarget,
  assetId: string,
  tag: string,
  op: "add" | "remove",
  options?: AssetWriteOptions,
): Promise<AssetItem> {
  const value = tag.trim();
  if (!value) {
    throw new Error("Tag must not be empty");
  }
  const prefix = remote.prefix ?? "";
  const clock = options?.clock ?? createHlcClock(remote.deviceId);
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const metaGot = await remote.store.get(assetItemMetaKey(prefix, assetId));
      if (!metaGot) {
        throw new Error(`Asset not found: ${assetId}`);
      }
      const item = decodeJson(metaGot.body) as AssetItem;
      const hlc = tickHlc(clock, options?.nowMs ?? Date.now());
      const nextSet =
        op === "add"
          ? addToOrSet(tagSetOf(item), value, hlc)
          : removeFromOrSet(tagSetOf(item), value, hlc);
      const updated = applyTagSet(item, nextSet);
      updated.updatedAt = nowIso();
      await remote.store.put(assetItemMetaKey(prefix, assetId), encodeJson(updated), {
        contentType: "application/json",
        ifMatch: metaGot.etag,
      });
      return updated;
    },
    lockOpts(options),
  );
}

function asRating(value: number): AssetRating {
  if (!Number.isInteger(value) || value < 0 || value > 5) {
    throw new Error("Rating must be an integer 0–5");
  }
  return value as AssetRating;
}

export function pickLwwRating(
  a: Pick<AssetItem, "rating" | "ratingHlc">,
  b: Pick<AssetItem, "rating" | "ratingHlc">,
): Pick<AssetItem, "rating" | "ratingHlc"> {
  const empty: Hlc = { ts: 0, c: 0, deviceId: "" };
  return compareHlc(a.ratingHlc ?? empty, b.ratingHlc ?? empty) >= 0
    ? { rating: a.rating, ratingHlc: a.ratingHlc }
    : { rating: b.rating, ratingHlc: b.ratingHlc };
}

function pickLwwVisionTags(
  a: AssetItem,
  b: AssetItem,
): AssetItem["visionTags"] {
  if (!a.visionTags) {
    return b.visionTags;
  }
  if (!b.visionTags) {
    return a.visionTags;
  }
  return a.visionTags.taggedAt >= b.visionTags.taggedAt
    ? a.visionTags
    : b.visionTags;
}

export function mergeAssetMeta(local: AssetItem, remote: AssetItem): AssetItem {
  const tagged = mergeEntityTags(local, remote);
  const rating = pickLwwRating(local, remote);
  return {
    ...tagged,
    rating: rating.rating,
    ratingHlc: rating.ratingHlc,
    visionTags: pickLwwVisionTags(local, remote),
    updatedAt:
      local.updatedAt >= remote.updatedAt ? local.updatedAt : remote.updatedAt,
  };
}

export async function setAssetRating(
  remote: RemoteLockTarget,
  assetId: string,
  rating: number,
  options?: AssetWriteOptions,
): Promise<AssetItem> {
  const value = asRating(rating);
  const prefix = remote.prefix ?? "";
  const clock = options?.clock ?? createHlcClock(remote.deviceId);
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const metaGot = await remote.store.get(assetItemMetaKey(prefix, assetId));
      if (!metaGot) {
        throw new Error(`Asset not found: ${assetId}`);
      }
      const item = decodeJson(metaGot.body) as AssetItem;
      item.rating = value;
      item.ratingHlc = tickHlc(clock, options?.nowMs ?? Date.now());
      item.updatedAt = nowIso();
      await remote.store.put(assetItemMetaKey(prefix, assetId), encodeJson(item), {
        contentType: "application/json",
        ifMatch: metaGot.etag,
      });
      return item;
    },
    lockOpts(options),
  );
}

export function assetsMatchingTags(
  items: AssetItem[],
  tags: string[],
): AssetItem[] {
  const wanted = tags.map((item) => item.trim()).filter(Boolean);
  if (wanted.length === 0) {
    return items;
  }
  return items.filter((item) => wanted.every((tag) => item.tags.includes(tag)));
}

export function assetsInFolder(
  items: AssetItem[],
  folderId: string | null,
): AssetItem[] {
  return items.filter((item) => item.folderId === folderId);
}
