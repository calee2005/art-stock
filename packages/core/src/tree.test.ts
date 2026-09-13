import assert from "node:assert/strict";
import { test } from "node:test";
import { createLibrary } from "./libraries.ts";
import { lockKey, libraryTreeKey } from "./keys.ts";
import { MemoryObjectStore } from "./store.ts";
import {
  createFolder,
  folderDepth,
  moveNode,
  readTree,
  subtreeIds,
  wouldCreateCycle,
} from "./tree.ts";
import type { ObjectStore, PutOptions, TreeNode } from "./index.ts";

function device(store: ObjectStore, id = "dev-a", prefix = "") {
  return { store, deviceId: id, deviceName: id, prefix };
}

test("create three folder levels and persist tree.json under lock", async () => {
  const inner = new MemoryObjectStore();
  const lockOnTreePut: boolean[] = [];
  const store: ObjectStore = {
    get: (key) => inner.get(key),
    head: (key) => inner.head(key),
    list: (prefix, options) => inner.list(prefix, options),
    delete: (key, options) => inner.delete(key, options),
    put: async (key, body, options?: PutOptions) => {
      if (key.includes("/tree.json")) {
        lockOnTreePut.push((await inner.get(lockKey(""))) != null);
      }
      return inner.put(key, body, options);
    },
  };
  const lib = await createLibrary(device(store), "设定");
  const root = await createFolder(device(store), lib.id, null, "角色");
  const mid = await createFolder(device(store), lib.id, root.id, "主角");
  const leaf = await createFolder(device(store), lib.id, mid.id, "立绘");
  assert.equal(folderDepth((await readTree(store, "", lib.id))!.tree.nodes, leaf.id), 3);
  assert.ok(lockOnTreePut.every(Boolean));
  assert.equal(await inner.get(lockKey("")), null);
  assert.ok(await inner.get(libraryTreeKey("", lib.id)));
});

test("moving a folder keeps children and rejects cycles", async () => {
  const store = new MemoryObjectStore();
  const lib = await createLibrary(device(store), "库");
  const a = await createFolder(device(store), lib.id, null, "A");
  const b = await createFolder(device(store), lib.id, a.id, "B");
  const c = await createFolder(device(store), lib.id, b.id, "C");
  const other = await createFolder(device(store), lib.id, null, "Other");

  await moveNode(device(store), lib.id, a.id, other.id);
  const nodes = (await readTree(store, "", lib.id))!.tree.nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  assert.equal(byId.get(a.id)?.parentId, other.id);
  assert.equal(byId.get(b.id)?.parentId, a.id);
  assert.equal(byId.get(c.id)?.parentId, b.id);
  assert.deepEqual([...subtreeIds(nodes, a.id)].sort(), [a.id, b.id, c.id].sort());

  await assert.rejects(
    () => moveNode(device(store), lib.id, other.id, c.id),
    /cycle/,
  );
  const after = (await readTree(store, "", lib.id))!.tree.nodes;
  assert.equal(after.find((node) => node.id === other.id)?.parentId, null);
});

test("wouldCreateCycle detects self and ancestor loops", () => {
  const nodes: TreeNode[] = [
    {
      id: "1",
      parentId: null,
      kind: "folder",
      name: "a",
      tags: [],
      updatedAt: "t",
      order: 0,
    },
    {
      id: "2",
      parentId: "1",
      kind: "folder",
      name: "b",
      tags: [],
      updatedAt: "t",
      order: 0,
    },
  ];
  assert.equal(wouldCreateCycle(nodes, "1", "1"), true);
  assert.equal(wouldCreateCycle(nodes, "1", "2"), true);
  assert.equal(wouldCreateCycle(nodes, "2", null), false);
});
