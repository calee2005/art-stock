import { DEFAULT_REMOTE_PREFIX, normalizePrefix } from "./prefix.ts";
import type { RemoteConfig } from "./types.ts";

/** Fixed protocol directory. Concatenate after a normalized prefix. */
export const PROTOCOL_DIR = ".artstock/v1/";

export function protocolRoot(prefix: string = DEFAULT_REMOTE_PREFIX): string {
  return `${normalizePrefix(prefix)}${PROTOCOL_DIR}`;
}

/** Full object key: `{prefix}.artstock/v1/{relative}`. */
export function objectKey(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  relative: string,
): string {
  const rel = relative.replace(/^\/+/, "");
  return `${protocolRoot(prefix)}${rel}`;
}

export function lockKey(prefix: string = DEFAULT_REMOTE_PREFIX): string {
  return objectKey(prefix, "lock.json");
}

export function manifestKey(prefix: string = DEFAULT_REMOTE_PREFIX): string {
  return objectKey(prefix, "manifest.json");
}

export function blobKey(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  sha256: string,
): string {
  return objectKey(prefix, `blobs/${sha256.toLowerCase()}`);
}

export function objectMetaKey(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  objectId: string,
): string {
  return objectKey(prefix, `objects/${objectId}/meta.json`);
}

export function objectBranchKey(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  objectId: string,
  branch: string,
): string {
  return objectKey(prefix, `objects/${objectId}/branches/${branch}.json`);
}

export function objectBranchesPrefix(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  objectId: string,
): string {
  return objectKey(prefix, `objects/${objectId}/branches/`);
}

export function objectSnapshotKey(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  objectId: string,
  snapshotId: string,
): string {
  return objectKey(prefix, `objects/${objectId}/snapshots/${snapshotId}.json`);
}

export function objectSnapshotsPrefix(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  objectId: string,
): string {
  return objectKey(prefix, `objects/${objectId}/snapshots/`);
}

export function libraryMetaKey(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  libraryId: string,
): string {
  return objectKey(prefix, `libraries/${libraryId}/meta.json`);
}

export function libraryTreeKey(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  libraryId: string,
): string {
  return objectKey(prefix, `libraries/${libraryId}/tree.json`);
}

export function kanbanIndexKey(prefix: string = DEFAULT_REMOTE_PREFIX): string {
  return objectKey(prefix, "kanban/index.json");
}

export function kanbanWorkspaceMetaKey(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  workspaceId: string,
): string {
  return objectKey(prefix, `kanban/workspaces/${workspaceId}/meta.json`);
}

export function kanbanBoardMetaKey(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  boardId: string,
): string {
  return objectKey(prefix, `kanban/boards/${boardId}/meta.json`);
}

export function kanbanListKey(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  boardId: string,
  listId: string,
): string {
  return objectKey(prefix, `kanban/boards/${boardId}/lists/${listId}.json`);
}

export function kanbanListsPrefix(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  boardId: string,
): string {
  return objectKey(prefix, `kanban/boards/${boardId}/lists/`);
}

export function kanbanItemKey(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  itemId: string,
): string {
  return objectKey(prefix, `kanban/items/${itemId}.json`);
}

export function kanbanItemsPrefix(prefix: string = DEFAULT_REMOTE_PREFIX): string {
  return objectKey(prefix, "kanban/items/");
}

export function assetIndexKey(prefix: string = DEFAULT_REMOTE_PREFIX): string {
  return objectKey(prefix, "assets/index.json");
}

export function assetItemMetaKey(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  assetId: string,
): string {
  return objectKey(prefix, `assets/items/${assetId}/meta.json`);
}

export function assetThumbKey(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  assetId: string,
): string {
  return objectKey(prefix, `assets/items/${assetId}/thumb.webp`);
}

export function einkConfigKey(prefix: string = DEFAULT_REMOTE_PREFIX): string {
  return objectKey(prefix, "device/eink/config.json");
}

export function einkSummaryKey(prefix: string = DEFAULT_REMOTE_PREFIX): string {
  return objectKey(prefix, "device/eink/summary.json");
}

export function clockKey(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  deviceId: string,
): string {
  return objectKey(prefix, `clocks/${deviceId}.json`);
}

export function oplogKey(
  prefix: string = DEFAULT_REMOTE_PREFIX,
  year: string | number,
  hlcStamp: string,
  deviceId: string,
): string {
  return objectKey(prefix, `oplog/${year}/${hlcStamp}-${deviceId}.json`);
}

export function defaultRemoteConfig(
  fields: Omit<RemoteConfig, "prefix"> & { prefix?: string },
): RemoteConfig {
  return {
    ...fields,
    prefix: normalizePrefix(fields.prefix ?? DEFAULT_REMOTE_PREFIX),
  };
}
