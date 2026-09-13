import assert from "node:assert/strict";
import { test } from "node:test";
import { blobKey } from "./keys.ts";
import { createLibrary } from "./libraries.ts";
import { getObjectMeta, importObjectNow } from "./import.ts";
import { MemoryObjectStore } from "./store.ts";
import {
  countPdfPages,
  createPdfViewer,
  encodeMinimalPdf,
  extractPdfPageText,
  goToPdfPage,
  isPdfName,
  loadPdfOriginal,
  pickLwwPageCount,
  preparePdfViewer,
  writeObjectPageCount,
} from "./pdf.ts";
import type { ObjectStore } from "./index.ts";

function device(store: ObjectStore, deviceId = "dev-a") {
  return { store, deviceId, deviceName: deviceId, prefix: "" };
}

test("two-page PDF paging matches extracted page text", () => {
  const bytes = encodeMinimalPdf(["Page One", "Page Two"]);
  assert.equal(countPdfPages(bytes), 2);
  let viewer = createPdfViewer({
    objectId: "obj",
    blobSha256: "abc",
    pageCount: 2,
  });
  viewer = { ...viewer, bytes };
  assert.equal(extractPdfPageText(viewer.bytes!, viewer.currentPage), "Page One");
  viewer = goToPdfPage(viewer, 2);
  assert.equal(viewer.currentPage, 2);
  assert.equal(extractPdfPageText(viewer.bytes!, viewer.currentPage), "Page Two");
  viewer = goToPdfPage(viewer, 99);
  assert.equal(viewer.currentPage, 2);
  assert.ok(isPdfName("notes.pdf"));
  assert.ok(isPdfName("x", "application/pdf"));
  assert.equal(isPdfName("notes.md"), false);
});

test("unpinned PDF does not GET the blob until opened; viewing does not write", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const lib = await createLibrary(remote, "库");
  const bytes = encodeMinimalPdf(["Alpha", "Beta"]);
  const imported = await importObjectNow(remote, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "notes.pdf",
    bytes,
    type: "pdf",
    mimeType: "application/pdf",
  });

  const blobGets: string[] = [];
  const origGet = store.get.bind(store);
  store.get = async (key: string) => {
    if (key.includes("blobs/")) {
      blobGets.push(key);
    }
    return origGet(key);
  };
  const putKeys: string[] = [];
  const origPut = store.put.bind(store);
  store.put = async (key, body, options) => {
    putKeys.push(key);
    return origPut(key, body, options);
  };

  const viewer = await preparePdfViewer(store, "", imported.object.id);
  assert.ok(viewer);
  assert.equal(viewer.bytes, null);
  assert.equal(blobGets.length, 0);
  assert.deepEqual(putKeys, []);
  assert.equal(viewer.blobSha256, imported.blobSha256);

  const opened = await loadPdfOriginal(store, "", viewer);
  assert.equal(blobGets.length, 1);
  assert.equal(blobGets[0], blobKey("", imported.blobSha256));
  assert.deepEqual(putKeys, []);
  assert.equal(opened.pageCount, 2);
  assert.equal(extractPdfPageText(opened.bytes!, 1), "Alpha");
  const next = goToPdfPage(opened, 2);
  assert.equal(extractPdfPageText(next.bytes!, next.currentPage), "Beta");

  const written = await writeObjectPageCount(remote, imported.object.id, 2, {
    nowMs: 50,
  });
  assert.equal(written.pageCount, 2);
  assert.ok(putKeys.some((key) => key.endsWith("lock.json")));
  assert.ok(putKeys.some((key) => key.includes(`/objects/${imported.object.id}/meta.json`)));
  const later = pickLwwPageCount(
    { pageCount: 2, pageCountHlc: { ts: 50, c: 0, deviceId: "a" } },
    { pageCount: 9, pageCountHlc: { ts: 80, c: 0, deviceId: "b" } },
  );
  assert.equal(later.pageCount, 9);
  const meta = await getObjectMeta(remote, imported.object.id);
  assert.equal(meta?.pageCount, 2);
});
