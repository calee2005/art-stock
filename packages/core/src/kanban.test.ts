import assert from "node:assert/strict";
import { test } from "node:test";
import { lockKey } from "./keys.ts";
import { MemoryObjectStore } from "./store.ts";
import {
  createBoard,
  createWorkspace,
  getBoard,
  listWorkspaces,
  readKanbanIndex,
} from "./kanban.ts";
import type { ObjectStore, PutOptions } from "./index.ts";

function device(store: ObjectStore) {
  return { store, deviceId: "dev-a", deviceName: "dev-a", prefix: "" };
}

test("create two workspaces and a board that belongs to one", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const wsA = await createWorkspace(remote, "项目A");
  const wsB = await createWorkspace(remote, "项目B");
  const board = await createBoard(remote, wsA.id, "开发");
  assert.equal(board.workspaceId, wsA.id);
  assert.notEqual(board.workspaceId, wsB.id);
  const listed = await listWorkspaces(store, "");
  assert.equal(listed.length, 2);
  const fromIndex = listed.find((item) => item.id === wsA.id);
  assert.deepEqual(fromIndex?.boardIds, [board.id]);
  const other = listed.find((item) => item.id === wsB.id);
  assert.deepEqual(other?.boardIds, []);
  const loaded = await getBoard(store, "", board.id);
  assert.equal(loaded?.workspaceId, wsA.id);
  const { index } = await readKanbanIndex(store, "");
  assert.ok(index?.workspaces.some((item) => item.name === "项目A"));
});

test("kanban writes go through the lock and update index.json", async () => {
  const inner = new MemoryObjectStore();
  const lockOnIndex: boolean[] = [];
  const store: ObjectStore = {
    get: (key) => inner.get(key),
    head: (key) => inner.head(key),
    list: (prefix, options) => inner.list(prefix, options),
    delete: (key, options) => inner.delete(key, options),
    put: async (key, body, options?: PutOptions) => {
      if (key.endsWith("kanban/index.json")) {
        lockOnIndex.push((await inner.get(lockKey(""))) != null);
      }
      return inner.put(key, body, options);
    },
  };
  const remote = device(store);
  await createWorkspace(remote, "侧栏");
  assert.ok(lockOnIndex.every(Boolean));
  assert.equal(await inner.get(lockKey("")), null);
});
