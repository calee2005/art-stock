import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createLibrary,
  importObjectNow,
  inferObjectType,
  MemoryObjectStore,
} from "@art-stock/core";
import { desktopLockTarget } from "./host.ts";
import {
  assertPluginApiHasNoSecrets,
  createPluginHost,
  examplePubManifestJson,
} from "./plugins.ts";

test("example plugin registers .vpub, writeBlob uses the lock, and secrets stay off the API", async () => {
  const store = new MemoryObjectStore();
  const remote = desktopLockTarget(store, "", "desk-plug", "desk-plug");
  const lib = await createLibrary(remote, "库");
  const bytes = new TextEncoder().encode("vpub-body");
  const imported = await importObjectNow(remote, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "issue.vpub",
    bytes,
    type: "binary",
  });
  const host = createPluginHost({ remote });
  const fixture = readFileSync(
    new URL("../plugins/com.example.pub/manifest.json", import.meta.url),
    "utf8",
  );
  host.loadManifest(fixture);
  assert.equal(host.inferType("issue.vpub"), "publication");
  assert.deepEqual(host.registeredTypes(), ["publication"]);
  const opened = await host.open("publication", imported.object.id);
  assert.equal(opened.byteLength, bytes.byteLength);

  const putKeys: string[] = [];
  const origPut = store.put.bind(store);
  store.put = async (key, body, options) => {
    putKeys.push(key);
    return origPut(key, body, options);
  };
  await host.api.writeBlob(
    imported.object.id,
    new TextEncoder().encode("vpub-body-2"),
  );
  assert.ok(putKeys.some((key) => key.endsWith("lock.json")));
  assertPluginApiHasNoSecrets(host.api);
  assert.equal("secretAccessKey" in host.api, false);
  assert.match(host.api.getAssetUrl("asset-1"), /^artstock:\/\/asset\//);

  const pad = createPluginHost({ remote, allowThirdParty: false });
  pad.loadManifest(examplePubManifestJson(), true);
  assert.equal(pad.registeredTypes().length, 0);
  assert.equal(inferObjectType("notes.md"), "markdown");
});
