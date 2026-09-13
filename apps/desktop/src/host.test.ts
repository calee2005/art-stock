import assert from "node:assert/strict";
import { test } from "node:test";
import { createLibrary, listLibraries, MemoryObjectStore } from "@art-stock/core";
import {
  createLibraryOnDesktop,
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
