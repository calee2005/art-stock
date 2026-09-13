import assert from "node:assert/strict";
import { test } from "node:test";
import { createLibrary } from "./libraries.ts";
import { createFolder } from "./tree.ts";
import { getObjectMeta, importObjectNow } from "./import.ts";
import { MemoryObjectStore } from "./store.ts";
import { lockKey } from "./keys.ts";
import { createHlcClock } from "./hlc.ts";
import {
  addNodeTag,
  mergeEntityTags,
  nodesMatchingTags,
  nodesWithTag,
  removeNodeTag,
  tagSetOf,
} from "./tags.ts";
import type { ObjectStore, PutOptions, TreeNode } from "./index.ts";

function device(store: ObjectStore, id = "dev-a") {
  return { store, deviceId: id, deviceName: id, prefix: "" };
}

test("tag folder and file then filter by tag", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const lib = await createLibrary(remote, "库");
  const folder = await createFolder(remote, lib.id, null, "角色");
  const file = await importObjectNow(remote, {
    libraryId: lib.id,
    parentFolderId: folder.id,
    name: "hero.png",
    bytes: new TextEncoder().encode("img"),
  });
  const { readTree } = await import("./tree.ts");
  const tree = await readTree(store, "", lib.id);
  const fileNode = tree?.tree.nodes.find((node) => node.objectId === file.object.id);
  assert.ok(fileNode);
  await addNodeTag(remote, lib.id, folder.id, "角色");
  await addNodeTag(remote, lib.id, fileNode.id, "立绘");
  const after = await readTree(store, "", lib.id);
  assert.ok(after);
  assert.deepEqual(
    nodesWithTag(after.tree.nodes, "角色").map((node) => node.name),
    ["角色"],
  );
  assert.deepEqual(
    nodesWithTag(after.tree.nodes, "立绘").map((node) => node.name),
    ["hero.png"],
  );
  assert.equal(nodesMatchingTags(after.tree.nodes, ["立绘", "角色"]).length, 0);
  const meta = file.object;
  const taggedFile = after.tree.nodes.find((node) => node.id === fileNode.id);
  assert.ok(taggedFile?.tags.includes("立绘"));
  const fileMeta = await getObjectMeta(remote, file.object.id);
  assert.ok(fileMeta?.tags.includes("立绘"));
});

test("tag writes go through the lock", async () => {
  const inner = new MemoryObjectStore();
  const lockSeen: boolean[] = [];
  const store: ObjectStore = {
    get: (key) => inner.get(key),
    head: (key) => inner.head(key),
    list: (prefix, options) => inner.list(prefix, options),
    delete: (key, options) => inner.delete(key, options),
    put: async (key, body, options?: PutOptions) => {
      if (key.includes("/tree.json")) {
        lockSeen.push((await inner.get(lockKey(""))) != null);
      }
      return inner.put(key, body, options);
    },
  };
  const remote = device(store);
  const lib = await createLibrary(remote, "库");
  const folder = await createFolder(remote, lib.id, null, "A");
  await addNodeTag(remote, lib.id, folder.id, "tag-a");
  assert.ok(lockSeen.every(Boolean));
  assert.equal(await inner.get(lockKey("")), null);
});

test("removeNodeTag hides the tag and merge follows OR-Set", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const lib = await createLibrary(remote, "库");
  const folder = await createFolder(remote, lib.id, null, "A");
  const clock = createHlcClock("dev-a");
  await addNodeTag(remote, lib.id, folder.id, "旧", { clock, nowMs: 10 });
  await removeNodeTag(remote, lib.id, folder.id, "旧", { clock, nowMs: 20 });
  const { readTree } = await import("./tree.ts");
  const after = await readTree(store, "", lib.id);
  const node = after?.tree.nodes.find((item) => item.id === folder.id);
  assert.ok(node);
  assert.deepEqual(node.tags, []);

  const local: TreeNode = {
    ...node,
    tags: ["角色"],
    tagSet: tagSetOf({ tags: ["角色"] }),
  };
  const merged = mergeEntityTags(local, node);
  assert.ok(merged.tags.includes("角色"));
  assert.ok(!merged.tags.includes("旧"));
});
