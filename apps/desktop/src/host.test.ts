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
} from "@art-stock/core";
import {
  createDesktopFileWatch,
  createLibraryOnDesktop,
  desktopLockTarget,
  listLibrariesOnDesktop,
  loadDesktopRemote,
  saveDesktopRemote,
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
