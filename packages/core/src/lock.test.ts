import assert from "node:assert/strict";
import { test } from "node:test";
import { RemoteError } from "./errors.ts";
import { encodeJson, decodeJson } from "./json.ts";
import { lockKey } from "./keys.ts";
import { probeConditionalWrites, withRemoteLock } from "./lock.ts";
import { MemoryObjectStore } from "./store.ts";
import type { LockDocument, ObjectStore, PutOptions } from "./index.ts";

function device(
  store: ObjectStore,
  id: string,
  name = id,
): {
  store: ObjectStore;
  deviceId: string;
  deviceName: string;
  prefix: string;
} {
  return { store, deviceId: id, deviceName: name, prefix: "" };
}

function noopHeartbeat(): (tick: () => Promise<void>) => () => void {
  return () => () => {};
}

test("acquire succeeds with conditional PUT when lock is missing", async () => {
  const store = new MemoryObjectStore();
  const result = await withRemoteLock(
    device(store, "dev-a", "studio-pc"),
    "sync",
    async (ctx) => {
      assert.equal(ctx.fencingToken, 1);
      const got = await store.get(lockKey(""));
      assert.ok(got);
      const doc = decodeJson(got.body) as LockDocument;
      assert.equal(doc.deviceId, "dev-a");
      assert.equal(doc.fencingToken, 1);
      return "ok";
    },
    { probe: false, scheduleHeartbeat: noopHeartbeat() },
  );
  assert.equal(result, "ok");
  assert.equal(await store.get(lockKey("")), null);
});

test("occupied lock returns REMOTE_LOCK_HELD", async () => {
  const store = new MemoryObjectStore();
  await store.put(
    lockKey(""),
    encodeJson({
      schemaVersion: 1,
      fencingToken: 3,
      deviceId: "other",
      deviceName: "nas-box",
      purpose: "sync",
      acquiredAt: "2026-01-01T00:00:00.000Z",
      heartbeatAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:05:00.000Z",
    }),
    { ifNoneMatch: "*" },
  );
  await assert.rejects(
    () =>
      withRemoteLock(device(store, "dev-a"), "upload", async () => "nope", {
        probe: false,
        scheduleHeartbeat: noopHeartbeat(),
        now: () => new Date("2026-01-01T00:01:00.000Z"),
      }),
    (error: unknown) => {
      assert.ok(error instanceof RemoteError);
      assert.equal(error.code, "REMOTE_LOCK_HELD");
      assert.equal(error.holderDeviceName, "nas-box");
      return true;
    },
  );
  const still = decodeJson((await store.get(lockKey("")))!.body) as LockDocument;
  assert.equal(still.deviceId, "other");
  assert.equal(still.fencingToken, 3);
});

test("expired lock is stolen with If-Match and fencingToken+1", async () => {
  const store = new MemoryObjectStore();
  await store.put(
    lockKey(""),
    encodeJson({
      schemaVersion: 1,
      fencingToken: 7,
      deviceId: "other",
      deviceName: "old",
      purpose: "sync",
      acquiredAt: "2026-01-01T00:00:00.000Z",
      heartbeatAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:01:00.000Z",
    }),
    { ifNoneMatch: "*" },
  );
  await withRemoteLock(
    device(store, "dev-b", "laptop"),
    "sync",
    async (ctx) => {
      assert.equal(ctx.fencingToken, 8);
      const doc = decodeJson((await store.get(lockKey("")))!.body) as LockDocument;
      assert.equal(doc.deviceId, "dev-b");
      assert.equal(doc.fencingToken, 8);
    },
    {
      probe: false,
      scheduleHeartbeat: noopHeartbeat(),
      now: () => new Date("2026-01-01T00:01:00.001Z"),
    },
  );
});

test("heartbeat If-Match failure yields REMOTE_LOCK_LOST", async () => {
  const store = new MemoryObjectStore();
  let tick: () => Promise<void> = async () => {};
  await assert.rejects(
    () =>
      withRemoteLock(
        device(store, "dev-a"),
        "sync",
        async (ctx) => {
          const got = await store.get(lockKey(""));
          assert.ok(got);
          await store.delete(lockKey(""), { ifMatch: got.etag });
          await tick();
          await ctx.ensureHeld();
        },
        {
          probe: false,
          scheduleHeartbeat: (next) => {
            tick = next;
            return () => {};
          },
        },
      ),
    (error: unknown) =>
      error instanceof RemoteError && error.code === "REMOTE_LOCK_LOST",
  );
});

test("larger fencingToken aborts with REMOTE_LOCK_LOST", async () => {
  const store = new MemoryObjectStore();
  let tick: () => Promise<void> = async () => {};
  await assert.rejects(
    () =>
      withRemoteLock(
        device(store, "dev-a"),
        "sync",
        async (ctx) => {
          const got = await store.get(lockKey(""));
          assert.ok(got);
          const stolen: LockDocument = {
            schemaVersion: 1,
            fencingToken: 99,
            deviceId: "thief",
            deviceName: "thief",
            purpose: "sync",
            acquiredAt: "2026-01-01T00:00:00.000Z",
            heartbeatAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2026-01-01T00:10:00.000Z",
          };
          await store.put(lockKey(""), encodeJson(stolen), {
            ifMatch: got.etag,
          });
          await tick();
          await ctx.ensureHeld();
        },
        {
          probe: false,
          scheduleHeartbeat: (next) => {
            tick = next;
            return () => {};
          },
        },
      ),
    (error: unknown) =>
      error instanceof RemoteError && error.code === "REMOTE_LOCK_LOST",
  );
});

test("finally releases with conditional DELETE", async () => {
  const store = new MemoryObjectStore();
  await withRemoteLock(
    device(store, "dev-a"),
    "upload",
    async () => "done",
    { probe: false, scheduleHeartbeat: noopHeartbeat() },
  );
  assert.equal(await store.get(lockKey("")), null);
});

test("lock.json puts always carry If-Match or If-None-Match/forbid-overwrite", async () => {
  const inner = new MemoryObjectStore();
  const puts: Array<PutOptions | undefined> = [];
  const store: ObjectStore = {
    get: (key) => inner.get(key),
    head: (key) => inner.head(key),
    list: (prefix, options) => inner.list(prefix, options),
    delete: (key, options) => inner.delete(key, options),
    put: async (key, body, options) => {
      if (key.endsWith("lock.json")) {
        puts.push(options);
      }
      return inner.put(key, body, options);
    },
  };
  await withRemoteLock(device(store, "dev-a"), "sync", async () => null, {
    probe: false,
    scheduleHeartbeat: noopHeartbeat(),
  });
  assert.ok(puts.length >= 1);
  for (const options of puts) {
    const conditional =
      options?.ifMatch != null ||
      options?.ifNoneMatch === "*" ||
      options?.forbidOverwrite === true;
    assert.equal(conditional, true);
  }
});

test("probe and acquire fail as REMOTE_UNSUPPORTED without conditional writes", async () => {
  const store = new MemoryObjectStore({ conditionalWrites: false });
  await assert.rejects(
    () => probeConditionalWrites(store, ""),
    (error: unknown) =>
      error instanceof RemoteError && error.code === "REMOTE_UNSUPPORTED",
  );
  await assert.rejects(
    () =>
      withRemoteLock(device(store, "dev-a"), "sync", async () => "x", {
        probe: true,
        scheduleHeartbeat: noopHeartbeat(),
      }),
    (error: unknown) =>
      error instanceof RemoteError && error.code === "REMOTE_UNSUPPORTED",
  );
  assert.equal(await store.get(lockKey("")), null);
});

test("probe rejects stores that ignore If-None-Match", async () => {
  const backing = new Map<string, Uint8Array>();
  const store: ObjectStore = {
    async get(key) {
      const body = backing.get(key);
      if (!body) {
        return null;
      }
      return {
        body,
        etag: '"x"',
        contentLength: body.byteLength,
      };
    },
    async head(key) {
      const body = backing.get(key);
      if (!body) {
        return null;
      }
      return { etag: '"x"', contentLength: body.byteLength };
    },
    async put(key, body) {
      backing.set(key, body);
      return { etag: '"x"' };
    },
    async delete(key) {
      backing.delete(key);
    },
    async list() {
      return { keys: [], isTruncated: false };
    },
  };
  await assert.rejects(
    () => probeConditionalWrites(store, ""),
    (error: unknown) =>
      error instanceof RemoteError && error.code === "REMOTE_UNSUPPORTED",
  );
});
