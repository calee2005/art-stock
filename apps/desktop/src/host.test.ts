import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAutoSnapshotController,
  createLibrary,
  createManualClock,
  importObjectNow,
  listLibraries,
  listSnapshots,
  MemoryObjectStore,
  encodeMinimalPdf,
  encodeMindDoc,
  createMindDoc,
  addMindChild,
} from "@art-stock/core";
import {
  createDesktopFileWatch,
  createLibraryOnDesktop,
  desktopLockTarget,
  importAssetOnDesktop,
  listLibrariesOnDesktop,
  loadDesktopRemote,
  openPdfOnDesktop,
  preparePdfOnDesktop,
  saveDesktopRemote,
  sqliteQueryAssets,
  parseMindDocOnDesktop,
  type SecureStore,
} from "./host.ts";

function memorySecrets(): SecureStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async set(key, value) {
      map.set(key, value);
    },
    async get(key) {
      return map.get(key) ?? null;
    },
  };
}

test("desktop and web see the same library list on one remote", async () => {
  const store = new MemoryObjectStore();
  await createLibrary(
    { store, prefix: "", deviceId: "web", deviceName: "web" },
    "Web库",
  );
  await createLibraryOnDesktop(store, "", "桌面库");
  const fromWeb = await listLibraries(store, "");
  const fromDesktop = await listLibrariesOnDesktop(store, "");
  assert.deepEqual(
    fromWeb.map((item) => item.name).sort(),
    ["Web库", "桌面库"],
  );
  assert.deepEqual(fromWeb, fromDesktop);
});

test("secrets go through SecureStore not plaintext JSON", async () => {
  const secrets = memorySecrets();
  let jsonFile = "";
  await saveDesktopRemote(
    async (json) => {
      jsonFile = json;
    },
    secrets,
    {
      id: "r1",
      name: "oss",
      endpoint: "https://example.invalid",
      bucket: "art",
      prefix: "",
      accessKeyId: "AKIATEST",
      secretAccessKey: "wJalrXUtnFEMI",
      forcePathStyle: true,
      mode: "readwrite",
    },
  );
  assert.equal(jsonFile.includes("wJalrXUtnFEMI"), false);
  assert.equal(jsonFile.includes("secretAccessKey"), false);
  assert.equal(secrets.map.get("secretAccessKey"), "wJalrXUtnFEMI");
  const loaded = await loadDesktopRemote(jsonFile, secrets);
  assert.equal(loaded.secretAccessKey, "wJalrXUtnFEMI");
  assert.equal(loaded.accessKeyId, "AKIATEST");
});

test("watched file save auto-commits after minIntervalMs debounce", async () => {
  const store = new MemoryObjectStore();
  const remote = desktopLockTarget(store, "", "desk-a", "desk-a");
  const lib = await createLibrary(remote, "库");
  const imported = await importObjectNow(remote, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "hero.clip",
    bytes: new TextEncoder().encode("v1"),
    type: "artwork",
  });
  const files = new Map<string, Uint8Array>([
    ["/tmp/hero.clip", new TextEncoder().encode("save-1")],
  ]);
  const clock = createManualClock();
  const watch = createDesktopFileWatch(
    remote,
    { readFile: async (path) => files.get(path) ?? new Uint8Array() },
    createAutoSnapshotController({ scheduler: clock }),
  );
  watch.bind({
    path: "/tmp/hero.clip",
    objectId: imported.object.id,
    policy: { mode: "auto-on-save", minIntervalMs: 40 },
  });
  const first = watch.onFsChange("/tmp/hero.clip");
  files.set("/tmp/hero.clip", new TextEncoder().encode("save-2"));
  const second = watch.onFsChange("/tmp/hero.clip");
  assert.equal((await first).status, "superseded");
  await clock.advance(40);
  const result = await second;
  assert.equal(result.status, "committed");
  assert.equal((await listSnapshots(store, "", imported.object.id)).length, 2);
});

test("desktop import generates webp thumb under lock and does not require caching originals", async () => {
  const store = new MemoryObjectStore();
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const item = await importAssetOnDesktop(store, "", {
    name: "spot.png",
    bytes: png,
    mimeType: "image/png",
  });
  assert.ok(item.thumbKey.endsWith("thumb.webp"));
  const thumb = await store.get(
    `.artstock/v1/assets/items/${item.id}/thumb.webp`,
  );
  assert.ok(thumb);
  assert.equal(thumb.contentType, "image/webp");
});

test("desktop PDF viewer loads blob only on open via the same core protocol", async () => {
  const store = new MemoryObjectStore();
  const remote = desktopLockTarget(store, "", "desk-pdf", "desk-pdf");
  const lib = await createLibrary(remote, "库");
  const imported = await importObjectNow(remote, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "brief.pdf",
    bytes: encodeMinimalPdf(["Desk One", "Desk Two"]),
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
  const prepared = await preparePdfOnDesktop(store, "", imported.object.id);
  assert.ok(prepared);
  assert.equal(prepared.bytes, null);
  assert.equal(blobGets.length, 0);
  const opened = await openPdfOnDesktop(store, "", prepared);
  assert.equal(opened.pageCount, 2);
  assert.equal(blobGets.length, 1);
});

test("desktop sqlite FTS MATCH returns name and tag subsets", () => {
  const assets = [
    { id: "a", name: "hero.png", tags: ["角色"] },
    { id: "b", name: "villain.png", tags: ["反派"] },
    { id: "c", name: "heroic.png", tags: ["草稿"] },
  ];
  assert.deepEqual(
    sqliteQueryAssets(assets, "hero").map((item) => item.id),
    ["a"],
  );
  assert.deepEqual(
    sqliteQueryAssets(assets, "her*").map((item) => item.id).sort(),
    ["a", "c"],
  );
  assert.deepEqual(
    sqliteQueryAssets(assets, "角色").map((item) => item.id),
    ["a"],
  );
});

test("desktop mindmap bytes are documented JSON", () => {
  let doc = createMindDoc("根");
  doc = addMindChild(doc, doc.root.id, "一层");
  doc = addMindChild(doc, doc.root.children[0]!.id, "二层");
  const parsed = parseMindDocOnDesktop(encodeMindDoc(doc));
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.root.children[0]?.children[0]?.text, "二层");
  assert.equal(JSON.parse(new TextDecoder().decode(encodeMindDoc(doc))).schemaVersion, 1);
});
