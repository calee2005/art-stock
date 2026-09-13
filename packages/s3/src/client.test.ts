import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLibrary,
  defaultRemoteConfig,
  listLibraries,
  lockKey,
  probeConditionalWrites,
  withRemoteLock,
} from "@art-stock/core";
import { S3ObjectStore } from "./client.ts";
import { listenS3Mock } from "./mock-http.ts";
import { signAwsV4 } from "./sign.ts";

test("signAwsV4 sets lock condition headers and does not embed the secret in the URL", async () => {
  const signed = await signAwsV4({
    method: "PUT",
    url: "http://127.0.0.1:9000/art/.artstock/v1/lock.json",
    headers: {
      "content-type": "application/json",
      "if-none-match": "*",
      "x-oss-forbid-overwrite": "true",
    },
    body: new TextEncoder().encode("{}"),
    accessKeyId: "AKIATEST",
    secretAccessKey: "super-secret-oss",
    region: "us-east-1",
    now: new Date("2020-01-01T00:00:00Z"),
  });
  assert.match(signed.authorization, /AWS4-HMAC-SHA256 Credential=AKIATEST\//);
  assert.doesNotMatch(signed.authorization, /super-secret-oss/);
  assert.equal(signed.headers["if-none-match"], "*");
  assert.equal(signed.headers["x-oss-forbid-overwrite"], "true");
});

test("S3ObjectStore GET/PUT/list honor If-None-Match and If-Match against HTTP mock", async () => {
  const mock = await listenS3Mock({ bucket: "art", accessKeyId: "AKIATEST" });
  const store = new S3ObjectStore(
    defaultRemoteConfig({
      id: "oss",
      name: "oss",
      endpoint: mock.url,
      bucket: "art",
      accessKeyId: "AKIATEST",
      secretAccessKey: "super-secret-oss",
      forcePathStyle: true,
      mode: "readwrite",
      region: "us-east-1",
    }),
  );
  try {
    assert.equal(await store.get(".artstock/v1/missing.json"), null);
    await probeConditionalWrites(store, "");
    const created = await createLibrary(
      { store, prefix: "", deviceId: "pad-1", deviceName: "pad" },
      "Pad库",
    );
    const listed = await listLibraries(store, "");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.name, "Pad库");
    assert.equal(created.name, "Pad库");
    assert.equal(await store.get(lockKey("")), null);
    await withRemoteLock(
      { store, prefix: "", deviceId: "pad-1", deviceName: "pad" },
      "upload",
      async () => {
        const lock = await store.get(lockKey(""));
        assert.ok(lock);
        await store.put(
          ".artstock/v1/pad-sample.txt",
          new TextEncoder().encode("from pad"),
          { contentType: "text/plain" },
        );
      },
      { probe: false, scheduleHeartbeat: () => () => {} },
    );
    const sample = await store.get(".artstock/v1/pad-sample.txt");
    assert.equal(new TextDecoder().decode(sample?.body ?? new Uint8Array()), "from pad");
    const listedKeys = await store.list(".artstock/v1/");
    assert.ok(listedKeys.keys.some((item) => item.key.endsWith("pad-sample.txt")));
  } finally {
    await mock.close();
  }
});
