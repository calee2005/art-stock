import { encodeJson, decodeJson } from "./json.ts";
import { sha256Hex } from "./hash.ts";
import {
  blobKey,
  libraryTreeKey,
  objectBranchKey,
  objectMetaKey,
  objectSnapshotKey,
} from "./keys.ts";
import {
  withRemoteLock,
  type RemoteLockTarget,
  type WithRemoteLockOptions,
} from "./lock.ts";
import { isStoreError } from "./store-error.ts";
import { readTree } from "./tree.ts";
import {
  SCHEMA_VERSION,
  type BranchPointer,
  type LibraryTree,
  type ObjectMeta,
  type ObjectType,
  type Snapshot,
  type TreeNode,
} from "./types.ts";

const lockOpts = (options?: WithRemoteLockOptions): WithRemoteLockOptions => ({
  probe: false,
  scheduleHeartbeat: () => () => {},
  ...options,
});

function nowIso(): string {
  return new Date().toISOString();
}

export type ImportObjectInput = {
  libraryId: string;
  parentFolderId: string | null;
  name: string;
  bytes: Uint8Array;
  type?: ObjectType;
  mimeType?: string;
};

export type QueuedImport = ImportObjectInput & {
  id: string;
};

export type ImportQueue = QueuedImport[];

export function enqueueImport(
  queue: ImportQueue,
  job: ImportObjectInput,
): QueuedImport {
  const item: QueuedImport = { ...job, id: crypto.randomUUID() };
  queue.push(item);
  return item;
}

export function inferObjectType(name: string, mimeType?: string): ObjectType {
  const mime = mimeType?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) {
    return "artwork";
  }
  if (mime === "application/pdf" || mime === "application/x-pdf") {
    return "pdf";
  }
  if (mime.startsWith("audio/")) {
    return "audio";
  }
  if (mime.startsWith("video/")) {
    return "video";
  }
  if (mime === "text/markdown" || mime === "text/x-markdown") {
    return "markdown";
  }
  const ext = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
    : "";
  if (["png", "jpg", "jpeg", "webp", "gif", "psd", "clip", "kra"].includes(ext)) {
    return "artwork";
  }
  if (ext === "pdf") {
    return "pdf";
  }
  if (["md", "markdown"].includes(ext)) {
    return "markdown";
  }
  if (ext === "mindmap" || ext === "mind") {
    return "mindmap";
  }
  if (ext === "json" && name.toLowerCase().includes("mind")) {
    return "mindmap";
  }
  if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext)) {
    return "audio";
  }
  if (["mp4", "webm", "mov", "mkv"].includes(ext)) {
    return "video";
  }
  return "binary";
}

async function putBlobIfAbsent(
  remote: RemoteLockTarget,
  sha: string,
  bytes: Uint8Array,
): Promise<void> {
  const key = blobKey(remote.prefix ?? "", sha);
  const existing = await remote.store.get(key);
  if (existing) {
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

export async function importObjectNow(
  remote: RemoteLockTarget,
  job: ImportObjectInput,
  options?: WithRemoteLockOptions,
): Promise<{ object: ObjectMeta; blobSha256: string }> {
  const queued = { ...job, id: crypto.randomUUID() };
  const [result] = await flushImportQueue(remote, [queued], options);
  if (!result) {
    throw new Error("Import failed");
  }
  return result;
}

export async function flushImportQueue(
  remote: RemoteLockTarget,
  queue: ImportQueue,
  options?: WithRemoteLockOptions,
): Promise<Array<{ object: ObjectMeta; blobSha256: string }>> {
  if (queue.length === 0) {
    return [];
  }
  const prefix = remote.prefix ?? "";
  const pending = queue.splice(0, queue.length);
  try {
    return await withRemoteLock(
      remote,
      "upload",
      async () => {
        const results: Array<{ object: ObjectMeta; blobSha256: string }> = [];
        const trees = new Map<string, { tree: LibraryTree; etag: string }>();
        for (const job of pending) {
          const sha = await sha256Hex(job.bytes);
          await putBlobIfAbsent(remote, sha, job.bytes);
          const at = nowIso();
          const objectId = crypto.randomUUID();
          const snapshotId = crypto.randomUUID();
          const object: ObjectMeta = {
            schemaVersion: SCHEMA_VERSION,
            id: objectId,
            libraryId: job.libraryId,
            parentFolderId: job.parentFolderId ?? "",
            name: job.name,
            type: job.type ?? inferObjectType(job.name, job.mimeType),
            tags: [],
            createdAt: at,
            updatedAt: at,
            defaultBranch: "main",
          };
          const snapshot: Snapshot = {
            id: snapshotId,
            parentSnapshotId: null,
            branch: "main",
            blobSha256: sha,
            byteSize: job.bytes.byteLength,
            mimeType: job.mimeType ?? "application/octet-stream",
            message: "import",
            createdAt: at,
            createdBy: remote.deviceId,
          };
          const branch: BranchPointer = {
            name: "main",
            snapshotId,
            updatedAt: at,
            updatedBy: remote.deviceId,
          };
          await remote.store.put(objectMetaKey(prefix, objectId), encodeJson(object), {
            contentType: "application/json",
            ifNoneMatch: "*",
          });
          await remote.store.put(
            objectSnapshotKey(prefix, objectId, snapshotId),
            encodeJson(snapshot),
            { contentType: "application/json", ifNoneMatch: "*" },
          );
          await remote.store.put(
            objectBranchKey(prefix, objectId, "main"),
            encodeJson(branch),
            { contentType: "application/json", ifNoneMatch: "*" },
          );

          let cached = trees.get(job.libraryId);
          if (!cached) {
            const loaded = await readTree(remote.store, prefix, job.libraryId);
            if (!loaded) {
              throw new Error(`Library tree not found: ${job.libraryId}`);
            }
            cached = loaded;
            trees.set(job.libraryId, cached);
          }
          const fileNode: TreeNode = {
            id: crypto.randomUUID(),
            parentId: job.parentFolderId,
            kind: "file",
            name: job.name,
            objectId,
            tags: [],
            updatedAt: at,
            order: cached.tree.nodes.filter((n) => n.parentId === job.parentFolderId)
              .length,
          };
          cached.tree.nodes.push(fileNode);
          results.push({ object, blobSha256: sha });
        }
        for (const [libraryId, cached] of trees) {
          await remote.store.put(
            libraryTreeKey(prefix, libraryId),
            encodeJson(cached.tree),
            { contentType: "application/json", ifMatch: cached.etag },
          );
        }
        return results;
      },
      lockOpts(options),
    );
  } catch (error) {
    queue.unshift(...pending);
    throw error;
  }
}

export async function getObjectMeta(
  remote: RemoteLockTarget,
  objectId: string,
): Promise<ObjectMeta | null> {
  const got = await remote.store.get(objectMetaKey(remote.prefix ?? "", objectId));
  if (!got) {
    return null;
  }
  return decodeJson(got.body) as ObjectMeta;
}
