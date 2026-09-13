import { isRemoteError } from "./errors.ts";
import {
  flushImportQueue,
  type ImportObjectInput,
  type QueuedImport,
} from "./import.ts";
import {
  readRemoteLock,
  type RemoteLockTarget,
  type WithRemoteLockOptions,
} from "./lock.ts";
import type { ObjectMeta } from "./types.ts";

export type SyncJob = QueuedImport & {
  label: string;
};

export type SyncState = {
  paused: boolean;
  queue: SyncJob[];
  lastCursor: Record<string, string>;
  metaCache: Map<string, ObjectMeta>;
  thumbCache: Map<string, Uint8Array>;
};

export function createSyncState(): SyncState {
  return {
    paused: false,
    queue: [],
    lastCursor: {},
    metaCache: new Map(),
    thumbCache: new Map(),
  };
}

export function pendingCount(state: SyncState): number {
  return state.queue.length;
}

export function setSyncPaused(state: SyncState, paused: boolean): void {
  state.paused = paused;
}

export function enqueueSyncImport(
  state: SyncState,
  job: ImportObjectInput,
  label = job.name,
): SyncJob {
  const item: SyncJob = { ...job, id: crypto.randomUUID(), label };
  state.queue.push(item);
  return item;
}

export function cacheObjectMeta(state: SyncState, object: ObjectMeta): void {
  state.metaCache.set(object.id, object);
}

export function cacheThumb(
  state: SyncState,
  objectId: string,
  bytes: Uint8Array,
): void {
  state.thumbCache.set(objectId, bytes);
}

export type PushSyncResult =
  | { status: "flushed"; flushed: number; pending: number }
  | { status: "paused"; pending: number }
  | {
      status: "lock-held";
      pending: number;
      deviceName: string;
      expiresAt: string;
      ttlMs: number;
    };

export async function pushSync(
  remote: RemoteLockTarget,
  state: SyncState,
  options?: WithRemoteLockOptions & { now?: () => Date },
): Promise<PushSyncResult> {
  if (state.paused) {
    return { status: "paused", pending: pendingCount(state) };
  }
  if (state.queue.length === 0) {
    return { status: "flushed", flushed: 0, pending: 0 };
  }
  const now = options?.now ?? (() => new Date());
  const batch = state.queue.splice(0, state.queue.length);
  try {
    const results = await flushImportQueue(remote, batch, options);
    for (const result of results) {
      cacheObjectMeta(state, result.object);
    }
    return {
      status: "flushed",
      flushed: results.length,
      pending: pendingCount(state),
    };
  } catch (error) {
    state.queue.unshift(...batch);
    if (isRemoteError(error) && error.code === "REMOTE_LOCK_HELD") {
      const held = await readRemoteLock(remote.store, remote.prefix ?? "");
      const expiresAt = error.expiresAt ?? held?.expiresAt ?? now().toISOString();
      const deviceName = error.holderDeviceName ?? held?.deviceName ?? "unknown";
      const ttlMs = Math.max(0, Date.parse(expiresAt) - now().getTime());
      return {
        status: "lock-held",
        pending: pendingCount(state),
        deviceName,
        expiresAt,
        ttlMs,
      };
    }
    throw error;
  }
}
