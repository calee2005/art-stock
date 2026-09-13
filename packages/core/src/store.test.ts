import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryObjectStore } from "./store.ts";
import { StoreError } from "./store-error.ts";

const encoder = new TextEncoder();
const text = (value: string) => encoder.encode(value);

test("mock get/put/head/list/delete round-trip", async () => {
  const store = new MemoryObjectStore();
  assert.equal(await store.get("a"), null);
  assert.equal(await store.head("a"), null);

  const put = await store.put("a", text("hello"), {
    contentType: "text/plain",
  });
  const got = await store.get("a");
  assert.ok(got);
  assert.equal(got.etag, put.etag);
  assert.equal(new TextDecoder().decode(got.body), "hello");
  assert.equal(got.contentType, "text/plain");

  const head = await store.head("a");
  assert.ok(head);
  assert.equal(head.etag, put.etag);
  assert.equal(head.contentLength, 5);

  await store.put("b", text("bee"));
  const listed = await store.list("");
  assert.deepEqual(
    listed.keys.map((item) => item.key),
    ["a", "b"],
  );

  await store.delete("a");
  assert.equal(await store.get("a"), null);
});

test("put If-None-Match * succeeds only when object is missing", async () => {
  const store = new MemoryObjectStore();
  await store.put("lock.json", text("one"), { ifNoneMatch: "*" });
  await assert.rejects(
    () => store.put("lock.json", text("two"), { ifNoneMatch: "*" }),
    (error: unknown) => {
      assert.ok(error instanceof StoreError);
      assert.equal(error.code, "PRECONDITION_FAILED");
      return true;
    },
  );
  const got = await store.get("lock.json");
  assert.equal(new TextDecoder().decode(got?.body ?? new Uint8Array()), "one");
});

test("put x-oss-forbid-overwrite rejects existing objects", async () => {
  const store = new MemoryObjectStore();
  await store.put("k", text("a"), { forbidOverwrite: true });
  await assert.rejects(
    () => store.put("k", text("b"), { forbidOverwrite: true }),
    (error: unknown) =>
      error instanceof StoreError && error.code === "PRECONDITION_FAILED",
  );
});

test("put If-Match updates only when etag matches", async () => {
  const store = new MemoryObjectStore();
  const first = await store.put("k", text("a"));
  await assert.rejects(
    () => store.put("k", text("b"), { ifMatch: '"deadbeef"' }),
    (error: unknown) =>
      error instanceof StoreError && error.code === "PRECONDITION_FAILED",
  );
  const second = await store.put("k", text("b"), { ifMatch: first.etag });
  assert.notEqual(second.etag, first.etag);
  const got = await store.get("k");
  assert.equal(new TextDecoder().decode(got?.body ?? new Uint8Array()), "b");
});

test("delete If-Match releases only the matching generation", async () => {
  const store = new MemoryObjectStore();
  const put = await store.put("lock.json", text("held"));
  await assert.rejects(
    () => store.delete("lock.json", { ifMatch: '"nope"' }),
    (error: unknown) =>
      error instanceof StoreError && error.code === "PRECONDITION_FAILED",
  );
  await store.delete("lock.json", { ifMatch: put.etag });
  assert.equal(await store.get("lock.json"), null);
});

test("store without conditional writes reports REMOTE_UNSUPPORTED", async () => {
  const store = new MemoryObjectStore({ conditionalWrites: false });
  await assert.rejects(
    () => store.put("k", text("x"), { ifNoneMatch: "*" }),
    (error: unknown) =>
      error instanceof StoreError && error.code === "REMOTE_UNSUPPORTED",
  );
  await store.put("k", text("x"));
  const got = await store.get("k");
  assert.equal(new TextDecoder().decode(got?.body ?? new Uint8Array()), "x");
});

test("list prefix and pagination", async () => {
  const store = new MemoryObjectStore();
  await store.put("art/.artstock/v1/a", text("1"));
  await store.put("art/.artstock/v1/b", text("2"));
  await store.put("other/c", text("3"));
  const page1 = await store.list("art/.artstock/v1/", { maxKeys: 1 });
  assert.equal(page1.keys.length, 1);
  assert.equal(page1.isTruncated, true);
  const page2 = await store.list("art/.artstock/v1/", {
    maxKeys: 1,
    continuationToken: page1.nextContinuationToken,
  });
  assert.equal(page2.keys.length, 1);
  assert.equal(page2.isTruncated, false);
  const other = await store.list("other/");
  assert.equal(other.keys.length, 1);
  assert.equal(other.keys[0]?.key, "other/c");
});
