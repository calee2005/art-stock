import assert from "node:assert/strict";
import { test } from "node:test";
import { S3ObjectStore } from "./client.ts";
import { addressingStyle, objectUrl } from "./url.ts";
import { defaultRemoteConfig } from "@art-stock/core";

test("path-style URL is endpoint/bucket/key", () => {
  assert.equal(addressingStyle(true), "path");
  assert.equal(
    objectUrl({
      endpoint: "https://minio.local:9000",
      bucket: "art",
      key: ".artstock/v1/lock.json",
      forcePathStyle: true,
    }),
    "https://minio.local:9000/art/.artstock/v1/lock.json",
  );
});

test("virtual-hosted URL is bucket.endpoint-host/key", () => {
  assert.equal(addressingStyle(false), "virtual-hosted");
  assert.equal(
    objectUrl({
      endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      bucket: "my-bucket",
      key: ".artstock/v1/lock.json",
      forcePathStyle: false,
    }),
    "https://my-bucket.oss-cn-hangzhou.aliyuncs.com/.artstock/v1/lock.json",
  );
});

test("S3ObjectStore.urlFor follows RemoteConfig.forcePathStyle", () => {
  const pathStore = new S3ObjectStore(
    defaultRemoteConfig({
      id: "r1",
      name: "nas",
      endpoint: "https://nas.local:9000",
      bucket: "stock",
      accessKeyId: "AK",
      secretAccessKey: "SK",
      forcePathStyle: true,
      mode: "readwrite",
    }),
  );
  assert.equal(
    pathStore.urlFor("art/.artstock/v1/manifest.json"),
    "https://nas.local:9000/stock/art/.artstock/v1/manifest.json",
  );

  const virtualStore = new S3ObjectStore(
    defaultRemoteConfig({
      id: "r2",
      name: "oss",
      endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
      bucket: "stock",
      prefix: "art/",
      accessKeyId: "AK",
      secretAccessKey: "SK",
      forcePathStyle: false,
      mode: "readonly",
    }),
  );
  assert.equal(
    virtualStore.urlFor(".artstock/v1/manifest.json"),
    "https://stock.oss-cn-hangzhou.aliyuncs.com/.artstock/v1/manifest.json",
  );
});
