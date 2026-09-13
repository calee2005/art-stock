import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLibrary,
  defaultRemoteConfig,
  listAssets,
  listLibraries,
  listSnapshots,
} from "@art-stock/core";
import { listenS3Mock } from "../../../packages/s3/src/mock-http.ts";
import { S3ObjectStore } from "@art-stock/s3";
import {
  applyInboxScan,
  applyPadE2eConfig,
  assertPublicE2eConfig,
  bytesFromInvoke,
  diffInbox,
  emptyInboxScanState,
  importInboxToAssets,
  INBOX_SCAN_STORAGE_KEY,
  isAndroidUserAgent,
  loadInboxScanState,
  persistRemoteForm,
  redactSecrets,
  restoreRemoteForm,
  runPadBrowseAndUpload,
  saveInboxScanState,
  saveInboxScanStateHost,
  stripSecretsFromForm,
} from "./pad-host.ts";
import {
  emptyRemoteForm,
  loadRemoteForm,
  type RemoteForm,
  type StorageLike,
} from "./session.ts";

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

test("Pixel Tablet user agent is treated as Android Pad", () => {
  assert.equal(
    isAndroidUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    ),
    true,
  );
  assert.equal(isAndroidUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false);
});

test("Tauri persist strips secrets from localStorage and uses IPC", async () => {
  const storage = memoryStorage();
  const secrets = new Map<string, string>();
  const form: RemoteForm = {
    ...emptyRemoteForm(),
    endpoint: "http://127.0.0.1:19001",
    bucket: "art",
    accessKeyId: "AKIATEST",
    secretAccessKey: "super-secret-oss",
    forcePathStyle: true,
  };
  await persistRemoteForm(storage, form, async (cmd, args) => {
    if (cmd === "secure_store_set") {
      secrets.set(String(args?.key), String(args?.value));
    }
  });
  const stored = loadRemoteForm(storage);
  assert.ok(stored);
  assert.equal(stored.secretAccessKey, "");
  assert.equal(stored.accessKeyId, "");
  assert.equal(JSON.stringify(stored).includes("super-secret-oss"), false);
  assert.equal(secrets.get("secretAccessKey"), "super-secret-oss");
  assert.equal(secrets.get("accessKeyId"), "AKIATEST");

  const restored = await restoreRemoteForm(storage, async (cmd, args) => {
    if (cmd === "secure_store_get") {
      return secrets.get(String(args?.key)) ?? null;
    }
    return null;
  });
  assert.equal(restored.secretAccessKey, "super-secret-oss");
  assert.equal(restored.endpoint, "http://127.0.0.1:19001");
});

test("pad-e2e.json rejects secret material", () => {
  assert.throws(
    () =>
      assertPublicE2eConfig(
        JSON.stringify({
          endpoint: "http://127.0.0.1:19001",
          bucket: "art",
          secretAccessKey: "nope",
        }),
      ),
    /must not contain secrets/,
  );
  const ok = assertPublicE2eConfig(
    JSON.stringify({ endpoint: "http://127.0.0.1:19001", bucket: "art", forcePathStyle: true }),
  );
  assert.equal(ok.bucket, "art");
});

test("Pad browse libraries and locked upload against HTTP S3 mock", async () => {
  const mock = await listenS3Mock({ bucket: "art", accessKeyId: "AKIATEST", port: 0 });
  const form = applyPadE2eConfig(
    {
      ...emptyRemoteForm(),
      accessKeyId: "AKIATEST",
      secretAccessKey: "super-secret-oss",
    },
    { endpoint: mock.url, bucket: "art", forcePathStyle: true, libraryName: "Pad库" },
  );
  const store = new S3ObjectStore(
    defaultRemoteConfig({
      id: "pad",
      name: "pad",
      endpoint: mock.url,
      bucket: "art",
      accessKeyId: "AKIATEST",
      secretAccessKey: "super-secret-oss",
      forcePathStyle: true,
      mode: "readwrite",
    }),
  );
  try {
    const result = await runPadBrowseAndUpload({
      store,
      form,
      deviceId: "pad-1",
      deviceName: "pad",
      libraryName: "Pad库",
      uploadBody: "from pad",
    });
    assert.ok(result.libraryNames.includes("Pad库"));
    assert.equal(result.lockSeenDuringPut, true);
    assert.ok(result.fencingToken >= 1);
    const again = await listLibraries(store, "");
    assert.equal(again[0]?.name, "Pad库");
  } finally {
    await mock.close();
  }
});

test("redactSecrets never leaves the OSS secret in status text", () => {
  const form = stripSecretsFromForm({
    ...emptyRemoteForm(),
    secretAccessKey: "super-secret-oss",
  });
  assert.equal(form.secretAccessKey, "");
  assert.equal(
    redactSecrets("failed super-secret-oss boom", ["super-secret-oss"]),
    "failed [redacted] boom",
  );
});

test("inbox bytes import to assets under withRemoteLock and leave the inbox", async () => {
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x18, 0xdd, 0x8d, 0xb0, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  assert.deepEqual(bytesFromInvoke([...png]), png);
  const mock = await listenS3Mock({ bucket: "art", accessKeyId: "AKIATEST", port: 0 });
  const store = new S3ObjectStore(
    defaultRemoteConfig({
      id: "pad",
      name: "pad",
      endpoint: mock.url,
      bucket: "art",
      accessKeyId: "AKIATEST",
      secretAccessKey: "super-secret-oss",
      forcePathStyle: true,
      mode: "readwrite",
    }),
  );
  const inbox = new Map<string, Uint8Array>([["from-gallery.png", png]]);
  try {
    const result = await importInboxToAssets({
      invoke: async (cmd, args) => {
        if (cmd === "inbox_read") {
          return [...(inbox.get(String(args?.name)) ?? [])];
        }
        if (cmd === "inbox_remove") {
          inbox.delete(String(args?.name));
          return null;
        }
        return null;
      },
      remote: { store, prefix: "", deviceId: "pad-1", deviceName: "pad" },
      name: "from-gallery.png",
      mimeType: "image/png",
    });
    assert.equal(result.name, "from-gallery.png");
    assert.equal(inbox.size, 0);
    const assets = await listAssets(store, "");
    assert.equal(assets[0]?.name, "from-gallery.png");
    const lock = await store.get(".artstock/v1/lock.json");
    assert.equal(lock, null);
  } finally {
    await mock.close();
  }
});

test("createLibrary uses the same store as listLibraries on the HTTP mock", async () => {
  const mock = await listenS3Mock({ bucket: "art", accessKeyId: "AKIATEST" });
  const store = new S3ObjectStore(
    defaultRemoteConfig({
      id: "pad",
      name: "pad",
      endpoint: mock.url,
      bucket: "art",
      accessKeyId: "AKIATEST",
      secretAccessKey: "super-secret-oss",
      forcePathStyle: true,
      mode: "readwrite",
    }),
  );
  try {
    await createLibrary(
      { store, prefix: "", deviceId: "pad-1", deviceName: "pad" },
      "浏览库",
    );
    const listed = await listLibraries(store, "");
    assert.equal(listed.map((item) => item.name).join(","), "浏览库");
  } finally {
    await mock.close();
  }
});

test("inbox scan imports a new file then snapshots on change under the lock", async () => {
  assert.deepEqual(
    diffInbox(
      [{ name: "a.png", size: 1 }],
      [
        { name: "a.png", size: 1 },
        { name: "b.png", size: 2 },
      ],
    ).map((item) => item.name),
    ["b.png"],
  );
  const mock = await listenS3Mock({ bucket: "art", accessKeyId: "AKIATEST", port: 0 });
  const store = new S3ObjectStore(
    defaultRemoteConfig({
      id: "pad",
      name: "pad",
      endpoint: mock.url,
      bucket: "art",
      accessKeyId: "AKIATEST",
      secretAccessKey: "super-secret-oss",
      forcePathStyle: true,
      mode: "readwrite",
    }),
  );
  const remote = { store, prefix: "", deviceId: "pad-1", deviceName: "pad" };
  try {
    const library = await createLibrary(remote, "扫描库");
    const files = new Map<string, Uint8Array>([["sketch.png", Uint8Array.from([1, 2, 3])]]);
    const first = await applyInboxScan({
      previous: emptyInboxScanState(),
      items: [{ name: "sketch.png", size: 3 }],
      read: async (name) => files.get(name) ?? new Uint8Array(),
      remote,
      libraryId: library.id,
      now: () => 1_000,
    });
    assert.deepEqual(first.imported, ["sketch.png"]);
    const objectId = first.state.objectIds["sketch.png"];
    assert.ok(objectId);
    files.set("sketch.png", Uint8Array.from([1, 2, 3, 4]));
    const second = await applyInboxScan({
      previous: first.state,
      items: [{ name: "sketch.png", size: 4 }],
      read: async (name) => files.get(name) ?? new Uint8Array(),
      remote,
      libraryId: library.id,
      now: () => 7_000,
    });
    assert.deepEqual(second.snapshotted, ["sketch.png"]);
    const snaps = await listSnapshots(store, "", objectId);
    assert.ok(snaps.length >= 2);
    const debounced = await applyInboxScan({
      previous: second.state,
      items: [{ name: "sketch.png", size: 5 }],
      read: async () => Uint8Array.from([9, 9, 9, 9, 9]),
      remote,
      libraryId: library.id,
      policy: { mode: "auto-on-save", minIntervalMs: 5000 },
      now: () => (second.state.lastCommitAt["sketch.png"] ?? 0) + 10,
    });
    assert.deepEqual(debounced.snapshotted, []);
    const storage = memoryStorage();
    saveInboxScanState(storage, second.state);
    assert.equal(storage.getItem(INBOX_SCAN_STORAGE_KEY)?.includes("secret"), false);
    const restored = loadInboxScanState(storage);
    assert.equal(restored.objectIds["sketch.png"], objectId);
    let savedHost: { objectIds?: Record<string, string> } | undefined;
    await saveInboxScanStateHost(
      storage,
      async (cmd, args) => {
        if (cmd === "inbox_scan_save") {
          savedHost = args?.state as { objectIds?: Record<string, string> };
        }
      },
      second.state,
    );
    assert.equal(savedHost?.objectIds?.["sketch.png"], objectId);
    const manual = await applyInboxScan({
      previous: second.state,
      items: [{ name: "sketch.png", size: 5 }],
      read: async () => Uint8Array.from([9]),
      remote,
      libraryId: library.id,
      policy: { mode: "manual", minIntervalMs: 0 },
    });
    assert.deepEqual(manual.skippedManual, ["sketch.png"]);
  } finally {
    await mock.close();
  }
});
