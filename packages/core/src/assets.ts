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
import { SCHEMA_VERSION, type AssetIndex, type AssetItem } from "./types.ts";
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
            items: [],
          };
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
