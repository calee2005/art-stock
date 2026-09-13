import { encodeJson, decodeJson } from "./json.ts";
import {
  blobKey,
  libraryMetaKey,
  libraryTreeKey,
  lockKey,
  objectKey,
  objectMetaKey,
} from "./keys.ts";
import {
  withRemoteLock,
  type RemoteLockTarget,
  type WithRemoteLockOptions,
} from "./lock.ts";
import { isStoreError } from "./store-error.ts";
import type {
  LibraryMeta,
  LibraryTree,
  LockPurpose,
  ObjectMeta,
  ReplicaStatus,
  Snapshot,
} from "./types.ts";
import type { ObjectStore } from "./store.ts";

const lockOpts = (options?: WithRemoteLockOptions): WithRemoteLockOptions => ({
  probe: false,
  scheduleHeartbeat: () => () => {},
  ...options,
});

export type NamedRemote = RemoteLockTarget & {
  remoteId: string;
};

export function sortRemotesById<T extends { remoteId: string }>(
  remotes: readonly T[],
): T[] {
  return [...remotes].sort((a, b) => a.remoteId.localeCompare(b.remoteId));
}

/**
 * Acquire locks in remoteId lexicographic order; release is reverse because
 * each withRemoteLock finally runs after nested work.
 */
export async function withOrderedRemoteLocks<T>(
  remotes: readonly NamedRemote[],
  purpose: LockPurpose,
  fn: () => Promise<T>,
  options?: WithRemoteLockOptions,
): Promise<T> {
  if (remotes.length === 0) {
    throw new Error("withOrderedRemoteLocks needs at least one remote");
  }
  const sorted = sortRemotesById(remotes);
  const run = (index: number): Promise<T> => {
    if (index >= sorted.length) {
      return fn();
    }
    return withRemoteLock(
      sorted[index]!,
      purpose,
      () => run(index + 1),
      lockOpts(options),
    );
  };
  return run(0);
}

async function putIfAbsent(
  store: ObjectStore,
  key: string,
  body: Uint8Array,
  contentType?: string,
): Promise<void> {
  if (await store.get(key)) {
    return;
  }
  try {
    await store.put(key, body, {
      contentType,
      ifNoneMatch: "*",
      forbidOverwrite: true,
    });
  } catch (error) {
    if (!(isStoreError(error) && error.code === "PRECONDITION_FAILED")) {
      throw error;
    }
  }
}

async function copyObjectGraph(
  source: NamedRemote,
  dest: NamedRemote,
  objectId: string,
): Promise<void> {
  const srcPrefix = source.prefix ?? "";
  const dstPrefix = dest.prefix ?? "";
  const listed = await source.store.list(
    objectKey(srcPrefix, `objects/${objectId}/`),
  );
  const blobShas = new Set<string>();
  for (const item of listed.keys) {
    const relative = item.key.slice(objectKey(srcPrefix, "").length);
    const destKey = objectKey(dstPrefix, relative);
    const got = await source.store.get(item.key);
    if (!got) {
      continue;
    }
    if (item.key.endsWith(".json")) {
      try {
        const snap = decodeJson(got.body) as Snapshot;
        if (typeof snap.blobSha256 === "string") {
          blobShas.add(snap.blobSha256);
        }
      } catch {
        /* meta/branch json */
      }
    }
    if (!(await dest.store.get(destKey))) {
      await putIfAbsent(dest.store, destKey, got.body, got.contentType);
    }
  }
  for (const sha of blobShas) {
    const srcBlob = await source.store.get(blobKey(srcPrefix, sha));
    if (srcBlob) {
      await putIfAbsent(
        dest.store,
        blobKey(dstPrefix, sha),
        srcBlob.body,
        srcBlob.contentType,
      );
    }
  }
}

async function copyLibraryIfNeeded(
  source: NamedRemote,
  dest: NamedRemote,
  libraryId: string,
): Promise<void> {
  const srcPrefix = source.prefix ?? "";
  const dstPrefix = dest.prefix ?? "";
  const srcMeta = await source.store.get(libraryMetaKey(srcPrefix, libraryId));
  if (srcMeta) {
    await putIfAbsent(
      dest.store,
      libraryMetaKey(dstPrefix, libraryId),
      srcMeta.body,
      srcMeta.contentType,
    );
  }
  const srcTree = await source.store.get(libraryTreeKey(srcPrefix, libraryId));
  if (srcTree) {
    await putIfAbsent(
      dest.store,
      libraryTreeKey(dstPrefix, libraryId),
      srcTree.body,
      srcTree.contentType,
    );
  }
}

function replicaMap(
  remoteIds: string[],
  present: Set<string>,
): Record<string, ReplicaStatus> {
  const replicas: Record<string, ReplicaStatus> = {};
  for (const id of remoteIds) {
    replicas[id] = present.has(id) ? "ok" : "pending";
  }
  return replicas;
}

async function writeReplicas(
  remote: NamedRemote,
  objectId: string,
  replicas: Record<string, ReplicaStatus>,
): Promise<void> {
  const key = objectMetaKey(remote.prefix ?? "", objectId);
  const got = await remote.store.get(key);
  if (!got) {
    return;
  }
  const meta = decodeJson(got.body) as ObjectMeta;
  meta.replicas = replicas;
  await remote.store.put(key, encodeJson(meta), {
    contentType: "application/json",
    ifMatch: got.etag,
  });
}

/**
 * Hold every remote lock (sorted by remoteId) then copy an object from the
 * first replica that has it onto the others. Updates `replicas`.
 */
export async function replicateObject(
  remotes: readonly NamedRemote[],
  objectId: string,
  options?: WithRemoteLockOptions,
): Promise<Record<string, ReplicaStatus>> {
  const ids = remotes.map((item) => item.remoteId);
  return withOrderedRemoteLocks(
    remotes,
    "replicate",
    async () => {
      const metas = await Promise.all(
        remotes.map(async (remote) => {
          const got = await remote.store.get(
            objectMetaKey(remote.prefix ?? "", objectId),
          );
          return got ? (decodeJson(got.body) as ObjectMeta) : null;
        }),
      );
      const sourceIndex = metas.findIndex((meta) => meta);
      if (sourceIndex < 0) {
        throw new Error(`Object not found on any remote: ${objectId}`);
      }
      const source = remotes[sourceIndex]!;
      const sourceMeta = metas[sourceIndex]!;
      const present = new Set<string>();
      for (let i = 0; i < remotes.length; i++) {
        if (metas[i]) {
          present.add(remotes[i]!.remoteId);
        }
      }
      for (let i = 0; i < remotes.length; i++) {
        if (metas[i]) {
          continue;
        }
        const dest = remotes[i]!;
        await copyLibraryIfNeeded(source, dest, sourceMeta.libraryId);
        await copyObjectGraph(source, dest, objectId);
        present.add(dest.remoteId);
      }
      const replicas = replicaMap(ids, present);
      for (const remote of remotes) {
        await writeReplicas(remote, objectId, replicas);
      }
      return replicas;
    },
    options,
  );
}

export function lockHeldOn(store: ObjectStore, prefix: string) {
  return store.get(lockKey(prefix));
}
