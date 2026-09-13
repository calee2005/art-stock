import assert from "node:assert/strict";
import { test } from "node:test";
import { blobKey, objectSnapshotKey } from "./keys.ts";
import { createLibrary } from "./libraries.ts";
import { importObjectNow } from "./import.ts";
import { MemoryObjectStore } from "./store.ts";
import {
  addMindChild,
  createMindDoc,
  encodeMindDoc,
  parseMindDoc,
  setMindNodeText,
} from "./mindmap.ts";
import {
  commitSnapshot,
  getBranch,
  listConflictBranches,
  readBranchBytes,
} from "./versions.ts";
import type { ObjectStore } from "./index.ts";

function device(store: ObjectStore, deviceId = "dev-a") {
  return { store, deviceId, deviceName: deviceId, prefix: "" };
}

test("three-level mindmap round-trips as documented JSON", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const lib = await createLibrary(remote, "库");
  let doc = createMindDoc("根");
  doc = addMindChild(doc, doc.root.id, "一层");
  const mid = doc.root.children[0]!.id;
  doc = addMindChild(doc, mid, "二层");
  doc = setMindNodeText(doc, doc.root.children[0]!.children[0]!.id, "三层叶子");
  const bytes = encodeMindDoc(doc);
  assert.equal(bytes[0], 0x7b, "starts with { JSON");
  const imported = await importObjectNow(remote, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "plot.mindmap",
    bytes,
    type: "mindmap",
    mimeType: "application/json",
  });
  const loaded = await readBranchBytes(store, "", imported.object.id);
  assert.ok(loaded);
  const again = parseMindDoc(loaded.bytes);
  assert.equal(again.schemaVersion, 1);
  assert.equal(again.root.text, "根");
  assert.equal(again.root.children[0]?.text, "一层");
  assert.equal(again.root.children[0]?.children[0]?.text, "三层叶子");
  assert.equal(JSON.parse(new TextDecoder().decode(bytes)).root.children[0].children[0].text, "三层叶子");
});

test("concurrent mindmap saves keep both JSON blobs on a conflict branch", async () => {
  const store = new MemoryObjectStore();
  const deviceA = device(store, "dev-a");
  const deviceB = device(store, "dev-b");
  const lib = await createLibrary(deviceA, "库");
  const baseDoc = createMindDoc("根");
  const imported = await importObjectNow(deviceA, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "plot.mindmap",
    bytes: encodeMindDoc(baseDoc),
    type: "mindmap",
  });
  const objectId = imported.object.id;
  const base = await getBranch(store, "", objectId, "main");
  assert.ok(base);
  const fromA = await commitSnapshot(
    deviceA,
    objectId,
    encodeMindDoc(addMindChild(baseDoc, baseDoc.root.id, "A")),
    "a",
  );
  const fromB = await commitSnapshot(
    deviceB,
    objectId,
    encodeMindDoc(addMindChild(baseDoc, baseDoc.root.id, "B")),
    "b",
    "main",
    { expectedParentSnapshotId: base.pointer.snapshotId, nowMs: 1_780_000_000_000 },
  );
  assert.match(fromB.branch, /^conflict\//);
  const conflicts = await listConflictBranches(store, "", objectId);
  assert.equal(conflicts.length, 1);
  assert.notEqual(fromA.blobSha256, fromB.blobSha256);
  assert.ok(await store.get(blobKey("", fromA.blobSha256)));
  assert.ok(await store.get(blobKey("", fromB.blobSha256)));
  assert.ok(await store.get(objectSnapshotKey("", objectId, fromA.id)));
  assert.ok(await store.get(objectSnapshotKey("", objectId, fromB.id)));
  const jsonA = parseMindDoc((await store.get(blobKey("", fromA.blobSha256)))!.body);
  const jsonB = parseMindDoc((await store.get(blobKey("", fromB.blobSha256)))!.body);
  assert.equal(jsonA.root.children[0]?.text, "A");
  assert.equal(jsonB.root.children[0]?.text, "B");
});
