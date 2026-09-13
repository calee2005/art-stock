import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLibrary,
  defaultRemoteConfig,
  listLibraries,
} from "@art-stock/core";
import { listenS3Mock } from "../../../packages/s3/src/mock-http.ts";
import { S3ObjectStore } from "@art-stock/s3";
import {
  applyPadE2eConfig,
  assertPublicE2eConfig,
  isAndroidUserAgent,
  persistRemoteForm,
  redactSecrets,
  restoreRemoteForm,
  runPadBrowseAndUpload,
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
