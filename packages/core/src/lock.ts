import { RemoteError } from "./errors.ts";
import { encodeJson, decodeJson } from "./json.ts";
import { lockKey, objectKey } from "./keys.ts";
import { SCHEMA_VERSION, type LockDocument, type LockPurpose } from "./types.ts";
import { StoreError } from "./store-error.ts";
import type { ObjectStore } from "./store.ts";

export const LOCK_TTL_MS = 60_000;
export const LOCK_HEARTBEAT_MS = 20_000;
export const PROBE_RELATIVE_KEY = ".probe-conditional";

const DEFAULT_ACQUIRE_ATTEMPTS = 8;

export type RemoteLockTarget = {
  store: ObjectStore;
  prefix?: string;
  deviceId: string;
  deviceName: string;
};

export type LockFnContext = {
  fencingToken: number;
  ensureHeld: () => Promise<void>;
};

export type WithRemoteLockOptions = {
  ttlMs?: number;
  heartbeatMs?: number;
  now?: () => Date;
  /** Test hook: invoke the heartbeat tick yourself. */
  scheduleHeartbeat?: (tick: () => Promise<void>) => () => void;
  acquireAttempts?: number;
  /** Default true: refuse remotes that ignore conditional writes. */
  probe?: boolean;
};

function toRemoteError(error: unknown): never {
  if (error instanceof RemoteError) {
    throw error;
  }
  if (error instanceof StoreError && error.code === "REMOTE_UNSUPPORTED") {
    throw new RemoteError(
      "REMOTE_UNSUPPORTED",
      "Remote does not support conditional writes",
    );
  }
  throw error;
}

function iso(date: Date): string {
  return date.toISOString();
}

function buildLockDocument(input: {
  fencingToken: number;
  deviceId: string;
  deviceName: string;
  purpose: LockPurpose;
  now: Date;
  ttlMs: number;
}): LockDocument {
  const acquiredAt = iso(input.now);
  const expiresAt = iso(new Date(input.now.getTime() + input.ttlMs));
  return {
    schemaVersion: SCHEMA_VERSION,
    fencingToken: input.fencingToken,
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    purpose: input.purpose,
    acquiredAt,
    heartbeatAt: acquiredAt,
    expiresAt,
  };
}

export async function readRemoteLock(
  store: ObjectStore,
  prefix: string = "",
): Promise<LockDocument | null> {
  const got = await store.get(lockKey(prefix));
  if (!got) {
    return null;
  }
  return parseLockDocument(got.body);
}

function parseLockDocument(body: Uint8Array): LockDocument | null {
  try {
    const parsed = decodeJson(body) as Partial<LockDocument>;
    if (typeof parsed.fencingToken !== "number") {
      return null;
    }
    if (typeof parsed.expiresAt !== "string") {
      return null;
    }
    if (typeof parsed.deviceId !== "string") {
      return null;
    }
    return parsed as LockDocument;
  } catch {
    return null;
  }
}

function putConditionsCreate(): { ifNoneMatch: "*"; forbidOverwrite: true } {
  return { ifNoneMatch: "*", forbidOverwrite: true };
}

/**
 * Connectivity probe: two conditional creates must not both succeed.
 * Must not fall back to unconditional overwrite.
 */
export async function probeConditionalWrites(
  store: ObjectStore,
  prefix = "",
): Promise<void> {
  const key = objectKey(prefix, PROBE_RELATIVE_KEY);
  const body = encodeJson({ schemaVersion: SCHEMA_VERSION, probe: true });
  try {
    const existing = await store.get(key);
    if (existing) {
      await store.delete(key, { ifMatch: existing.etag });
    }
    await store.put(key, body, putConditionsCreate());
    let secondSucceeded = false;
    try {
      await store.put(key, body, putConditionsCreate());
      secondSucceeded = true;
    } catch (error) {
      if (error instanceof StoreError && error.code === "REMOTE_UNSUPPORTED") {
        throw new RemoteError(
          "REMOTE_UNSUPPORTED",
          "Remote does not support conditional writes",
        );
      }
      if (!(error instanceof StoreError) || error.code !== "PRECONDITION_FAILED") {
        throw error;
      }
    }
    const got = await store.get(key);
    if (got) {
      try {
        await store.delete(key, { ifMatch: got.etag });
      } catch {
        /* probe cleanup is best-effort */
      }
    }
    if (secondSucceeded) {
      throw new RemoteError(
        "REMOTE_UNSUPPORTED",
        "Remote ignored If-None-Match / forbid-overwrite",
      );
    }
  } catch (error) {
    toRemoteError(error);
  }
}

type HeldLock = {
  document: LockDocument;
  etag: string;
};

async function acquireLock(
  remote: RemoteLockTarget,
  purpose: LockPurpose,
  options: {
    ttlMs: number;
    now: () => Date;
    attempts: number;
  },
): Promise<HeldLock> {
  const prefix = remote.prefix ?? "";
  const key = lockKey(prefix);
  let remaining = options.attempts;
  while (remaining > 0) {
    remaining -= 1;
    const createDoc = buildLockDocument({
      fencingToken: 1,
      deviceId: remote.deviceId,
      deviceName: remote.deviceName,
      purpose,
      now: options.now(),
      ttlMs: options.ttlMs,
    });
    try {
      const put = await remote.store.put(key, encodeJson(createDoc), {
        ...putConditionsCreate(),
        contentType: "application/json",
      });
      return { document: createDoc, etag: put.etag };
    } catch (error) {
      if (error instanceof StoreError && error.code === "REMOTE_UNSUPPORTED") {
        throw new RemoteError(
          "REMOTE_UNSUPPORTED",
          "Remote does not support conditional writes",
        );
      }
      if (!(error instanceof StoreError) || error.code !== "PRECONDITION_FAILED") {
        throw error;
      }
    }

    const current = await remote.store.get(key);
    if (!current) {
      continue;
    }
    const held = parseLockDocument(current.body);
    const expiresAtMs = held ? Date.parse(held.expiresAt) : 0;
    if (held && options.now().getTime() <= expiresAtMs) {
      throw new RemoteError("REMOTE_LOCK_HELD", "Remote write lock is held", {
        holderDeviceId: held.deviceId,
        holderDeviceName: held.deviceName,
        expiresAt: held.expiresAt,
      });
    }
    const stealDoc = buildLockDocument({
      fencingToken: (held?.fencingToken ?? 0) + 1,
      deviceId: remote.deviceId,
      deviceName: remote.deviceName,
      purpose,
      now: options.now(),
      ttlMs: options.ttlMs,
    });
    try {
      const put = await remote.store.put(key, encodeJson(stealDoc), {
        ifMatch: current.etag,
        contentType: "application/json",
      });
      return { document: stealDoc, etag: put.etag };
    } catch (error) {
      if (error instanceof StoreError && error.code === "PRECONDITION_FAILED") {
        continue;
      }
      toRemoteError(error);
    }
  }
  throw new RemoteError(
    "REMOTE_LOCK_HELD",
    "Remote write lock acquire retries exhausted",
  );
}

async function heartbeat(
  remote: RemoteLockTarget,
  held: HeldLock,
  options: { ttlMs: number; now: () => Date },
): Promise<HeldLock> {
  const key = lockKey(remote.prefix ?? "");
  const current = await remote.store.get(key);
  if (!current) {
    throw new RemoteError("REMOTE_LOCK_LOST", "Lock object disappeared");
  }
  const doc = parseLockDocument(current.body);
  if (!doc) {
    throw new RemoteError("REMOTE_LOCK_LOST", "Lock document is unreadable");
  }
  if (doc.fencingToken > held.document.fencingToken) {
    throw new RemoteError(
      "REMOTE_LOCK_LOST",
      "fencingToken advanced; lock stolen",
    );
  }
  if (doc.deviceId !== remote.deviceId) {
    throw new RemoteError("REMOTE_LOCK_LOST", "Lock holder changed");
  }
  const now = options.now();
  const next: LockDocument = {
    ...held.document,
    heartbeatAt: iso(now),
    expiresAt: iso(new Date(now.getTime() + options.ttlMs)),
  };
  try {
    const put = await remote.store.put(key, encodeJson(next), {
      ifMatch: current.etag,
      contentType: "application/json",
    });
    return { document: next, etag: put.etag };
  } catch (error) {
    if (error instanceof StoreError && error.code === "PRECONDITION_FAILED") {
      throw new RemoteError("REMOTE_LOCK_LOST", "Heartbeat If-Match failed");
    }
    toRemoteError(error);
  }
}

async function releaseLock(
  remote: RemoteLockTarget,
  etag: string,
): Promise<void> {
  const key = lockKey(remote.prefix ?? "");
  try {
    await remote.store.delete(key, { ifMatch: etag });
  } catch {
    /* TTL is the fallback */
  }
}

/**
 * Acquire the global protocol lock, run `fn`, heartbeat, then If-Match DELETE.
 * Never overwrites lock.json unconditionally.
 */
export async function withRemoteLock<T>(
  remote: RemoteLockTarget,
  purpose: LockPurpose,
  fn: (ctx: LockFnContext) => Promise<T>,
  options: WithRemoteLockOptions = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? LOCK_TTL_MS;
  const heartbeatMs = options.heartbeatMs ?? LOCK_HEARTBEAT_MS;
  const now = options.now ?? (() => new Date());
  if (options.probe !== false) {
    await probeConditionalWrites(remote.store, remote.prefix ?? "");
  }

  const held = await acquireLock(remote, purpose, {
    ttlMs,
    now,
    attempts: options.acquireAttempts ?? DEFAULT_ACQUIRE_ATTEMPTS,
  });
  let current = held;
  let lost: RemoteError | undefined;
  let ticking = false;

  const tick = async (): Promise<void> => {
    if (lost || ticking) {
      return;
    }
    ticking = true;
    try {
      current = await heartbeat(remote, current, { ttlMs, now });
    } catch (error) {
      lost =
        error instanceof RemoteError
          ? error
          : new RemoteError("REMOTE_LOCK_LOST", "Heartbeat failed");
    } finally {
      ticking = false;
    }
  };

  const stopHeartbeat = options.scheduleHeartbeat
    ? options.scheduleHeartbeat(tick)
    : (() => {
        const id = setInterval(() => {
          void tick();
        }, heartbeatMs);
        return () => clearInterval(id);
      })();

  try {
    const result = await fn({
      fencingToken: current.document.fencingToken,
      ensureHeld: async () => {
        if (lost) {
          throw lost;
        }
        await tick();
        if (lost) {
          throw lost;
        }
      },
    });
    if (lost) {
      throw lost;
    }
    return result;
  } finally {
    stopHeartbeat();
    await releaseLock(remote, current.etag);
  }
}
