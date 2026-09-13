import { createHlcClock, formatHlcStamp, tickHlc } from "./hlc.ts";
import { encodeJson, decodeJson } from "./json.ts";
import { sha256Hex } from "./hash.ts";
import {
  blobKey,
  objectBranchKey,
  objectBranchesPrefix,
  objectMetaKey,
  objectSnapshotKey,
  objectSnapshotsPrefix,
} from "./keys.ts";
import {
  withRemoteLock,
  type RemoteLockTarget,
  type WithRemoteLockOptions,
} from "./lock.ts";
import { isStoreError } from "./store-error.ts";
import {
  type BranchPointer,
  type Hlc,
  type ObjectMeta,
  type Snapshot,
} from "./types.ts";
import type { ObjectStore } from "./store.ts";

const lockOpts = (options?: WithRemoteLockOptions): WithRemoteLockOptions => ({
  probe: false,
  scheduleHeartbeat: () => () => {},
  ...options,
});

export type CommitSnapshotOptions = WithRemoteLockOptions & {
  /** Local replica's parent. If the remote tip differs, do not fast-forward. */
  expectedParentSnapshotId?: string;
  nowMs?: number;
};

export const CONFLICT_BRANCH_PREFIX = "conflict/";

export function isConflictBranch(name: string): boolean {
  return name.startsWith(CONFLICT_BRANCH_PREFIX);
}

export function conflictBranchName(deviceId: string, hlc: Hlc): string {
  const stamp = formatHlcStamp(hlc);
  const suffix = `-${stamp}`;
  const budget = 64 - CONFLICT_BRANCH_PREFIX.length - suffix.length;
  const safeId = deviceId
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, Math.max(1, budget));
  return validateBranchName(`${CONFLICT_BRANCH_PREFIX}${safeId}${suffix}`);
}

function nowIso(): string {
  return new Date().toISOString();
}

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

export async function getBranch(
  store: ObjectStore,
  prefix: string,
  objectId: string,
  branch: string,
): Promise<{ pointer: BranchPointer; etag: string } | null> {
  const got = await store.get(objectBranchKey(prefix, objectId, branch));
  if (!got) {
    return null;
  }
  return { pointer: decodeJson(got.body) as BranchPointer, etag: got.etag };
}

export async function listSnapshots(
  store: ObjectStore,
  prefix: string,
  objectId: string,
): Promise<Snapshot[]> {
  const listed = await store.list(objectSnapshotsPrefix(prefix, objectId));
  const snapshots: Snapshot[] = [];
  for (const object of listed.keys) {
    const got = await store.get(object.key);
    if (!got) {
      continue;
    }
    snapshots.push(decodeJson(got.body) as Snapshot);
  }
  return snapshots.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function commitSnapshot(
  remote: RemoteLockTarget,
  objectId: string,
  bytes: Uint8Array,
  message = "commit",
  branch?: string,
  options?: CommitSnapshotOptions,
): Promise<Snapshot> {
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const metaGot = await remote.store.get(objectMetaKey(prefix, objectId));
      if (!metaGot) {
        throw new Error(`Object not found: ${objectId}`);
      }
      const meta = decodeJson(metaGot.body) as ObjectMeta;
      const requestedBranch = branch ?? meta.defaultBranch;
      const current = await getBranch(
        remote.store,
        prefix,
        objectId,
        requestedBranch,
      );
      if (!current) {
        throw new Error(`Branch not found: ${requestedBranch}`);
      }
      const expectedParent = options?.expectedParentSnapshotId;
      const diverged =
        expectedParent != null && expectedParent !== current.pointer.snapshotId;
      const parentSnapshotId = diverged
        ? expectedParent
        : current.pointer.snapshotId;
      const hlc = diverged
        ? tickHlc(createHlcClock(remote.deviceId), options?.nowMs)
        : null;
      const branchName = diverged
        ? conflictBranchName(remote.deviceId, hlc!)
        : requestedBranch;
      const sha = await sha256Hex(bytes);
      await putBlobIfAbsent(remote, sha, bytes);
      const at = nowIso();
      const snapshot: Snapshot = {
        id: crypto.randomUUID(),
        parentSnapshotId,
        branch: branchName,
        blobSha256: sha,
        byteSize: bytes.byteLength,
        mimeType: "application/octet-stream",
        message,
        createdAt: at,
        createdBy: remote.deviceId,
      };
      await remote.store.put(
        objectSnapshotKey(prefix, objectId, snapshot.id),
        encodeJson(snapshot),
        { contentType: "application/json", ifNoneMatch: "*" },
      );
      const pointer: BranchPointer = {
        name: branchName,
        snapshotId: snapshot.id,
        updatedAt: at,
        updatedBy: remote.deviceId,
      };
      if (diverged) {
        await remote.store.put(
          objectBranchKey(prefix, objectId, branchName),
          encodeJson(pointer),
          { contentType: "application/json", ifNoneMatch: "*", forbidOverwrite: true },
        );
      } else {
        await remote.store.put(
          objectBranchKey(prefix, objectId, branchName),
          encodeJson(pointer),
          { contentType: "application/json", ifMatch: current.etag },
        );
      }
      return snapshot;
    },
    lockOpts(options),
  );
}

export async function rollbackBranch(
  remote: RemoteLockTarget,
  objectId: string,
  snapshotId: string,
  branch?: string,
  options?: WithRemoteLockOptions,
): Promise<BranchPointer> {
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const snapGot = await remote.store.get(
        objectSnapshotKey(prefix, objectId, snapshotId),
      );
      if (!snapGot) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
      }
      const metaGot = await remote.store.get(objectMetaKey(prefix, objectId));
      if (!metaGot) {
        throw new Error(`Object not found: ${objectId}`);
      }
      const meta = decodeJson(metaGot.body) as ObjectMeta;
      const branchName = branch ?? meta.defaultBranch;
      const current = await getBranch(remote.store, prefix, objectId, branchName);
      if (!current) {
        throw new Error(`Branch not found: ${branchName}`);
      }
      const pointer: BranchPointer = {
        name: branchName,
        snapshotId,
        updatedAt: nowIso(),
        updatedBy: remote.deviceId,
      };
      await remote.store.put(
        objectBranchKey(prefix, objectId, branchName),
        encodeJson(pointer),
        { contentType: "application/json", ifMatch: current.etag },
      );
      return pointer;
    },
    lockOpts(options),
  );
}

const BRANCH_NAME = /^[A-Za-z0-9._/-]+$/;

export function validateBranchName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 64) {
    throw new Error("Branch name must be 1–64 characters");
  }
  if (
    !BRANCH_NAME.test(trimmed) ||
    trimmed.includes("..") ||
    trimmed.startsWith("/") ||
    trimmed.endsWith("/")
  ) {
    throw new Error("Branch name must match [A-Za-z0-9._/-]+ and is not a Git ref");
  }
  return trimmed;
}

export async function listBranches(
  store: ObjectStore,
  prefix: string,
  objectId: string,
): Promise<BranchPointer[]> {
  const listed = await store.list(objectBranchesPrefix(prefix, objectId));
  const branches: BranchPointer[] = [];
  for (const object of listed.keys) {
    const got = await store.get(object.key);
    if (!got) {
      continue;
    }
    branches.push(decodeJson(got.body) as BranchPointer);
  }
  return branches.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listConflictBranches(
  store: ObjectStore,
  prefix: string,
  objectId: string,
): Promise<BranchPointer[]> {
  const branches = await listBranches(store, prefix, objectId);
  return branches.filter((item) => isConflictBranch(item.name));
}

export async function createBranch(
  remote: RemoteLockTarget,
  objectId: string,
  name: string,
  fromBranch?: string,
  options?: WithRemoteLockOptions,
): Promise<BranchPointer> {
  const branchName = validateBranchName(name);
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const metaGot = await remote.store.get(objectMetaKey(prefix, objectId));
      if (!metaGot) {
        throw new Error(`Object not found: ${objectId}`);
      }
      const meta = decodeJson(metaGot.body) as ObjectMeta;
      const sourceName = fromBranch ?? meta.defaultBranch;
      const source = await getBranch(remote.store, prefix, objectId, sourceName);
      if (!source) {
        throw new Error(`Source branch not found: ${sourceName}`);
      }
      const pointer: BranchPointer = {
        name: branchName,
        snapshotId: source.pointer.snapshotId,
        updatedAt: nowIso(),
        updatedBy: remote.deviceId,
      };
      await remote.store.put(
        objectBranchKey(prefix, objectId, branchName),
        encodeJson(pointer),
        { contentType: "application/json", ifNoneMatch: "*", forbidOverwrite: true },
      );
      return pointer;
    },
    lockOpts(options),
  );
}

export async function switchDefaultBranch(
  remote: RemoteLockTarget,
  objectId: string,
  name: string,
  options?: WithRemoteLockOptions,
): Promise<ObjectMeta> {
  const branchName = validateBranchName(name);
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const target = await getBranch(remote.store, prefix, objectId, branchName);
      if (!target) {
        throw new Error(`Branch not found: ${branchName}`);
      }
      const metaGot = await remote.store.get(objectMetaKey(prefix, objectId));
      if (!metaGot) {
        throw new Error(`Object not found: ${objectId}`);
      }
      const meta = decodeJson(metaGot.body) as ObjectMeta;
      meta.defaultBranch = branchName;
      meta.updatedAt = nowIso();
      await remote.store.put(objectMetaKey(prefix, objectId), encodeJson(meta), {
        contentType: "application/json",
        ifMatch: metaGot.etag,
      });
      return meta;
    },
    lockOpts(options),
  );
}

export async function deleteBranch(
  remote: RemoteLockTarget,
  objectId: string,
  name: string,
  options?: WithRemoteLockOptions,
): Promise<void> {
  const branchName = validateBranchName(name);
  if (branchName === "main") {
    throw new Error("Cannot delete main");
  }
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const metaGot = await remote.store.get(objectMetaKey(prefix, objectId));
      if (!metaGot) {
        throw new Error(`Object not found: ${objectId}`);
      }
      const meta = decodeJson(metaGot.body) as ObjectMeta;
      if (meta.defaultBranch === branchName) {
        throw new Error("Cannot delete the default branch");
      }
      const current = await getBranch(remote.store, prefix, objectId, branchName);
      if (!current) {
        throw new Error(`Branch not found: ${branchName}`);
      }
      await remote.store.delete(objectBranchKey(prefix, objectId, branchName), {
        ifMatch: current.etag,
      });
    },
    lockOpts(options),
  );
}
