import assert from "node:assert/strict";
import { test } from "node:test";
import { lockKey } from "./keys.ts";
import { MemoryObjectStore } from "./store.ts";
import {
  createBoard,
  createItem,
  createWorkspace,
  DEFAULT_KANBAN_LIST_NAMES,
  getBoard,
  getItem,
  listItems,
  listLists,
  listWorkspaces,
  readKanbanIndex,
  updateItem,
  moveItem,
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

test("new board gets the default three lists and items store per layer", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const ws = await createWorkspace(remote, "项目");
  const board = await createBoard(remote, ws.id, "开发");
  const lists = await listLists(store, "", board.id);
  assert.deepEqual(
    lists.map((list) => list.name),
    [...DEFAULT_KANBAN_LIST_NAMES],
  );
  for (const list of lists) {
    assert.equal(list.boardId, board.id);
    const listed = await store.list("");
    assert.ok(
      listed.keys.some((object) =>
        object.key.endsWith(`/kanban/boards/${board.id}/lists/${list.id}.json`),
      ),
    );
  }
  const todo = lists[0];
  assert.ok(todo);
  const item = await createItem(remote, {
    boardId: board.id,
    listId: todo.id,
    title: "画封面",
    descriptionMarkdown: "主视觉",
    dueAt: "2026-10-01T00:00:00.000Z",
    checklist: [{ id: crypto.randomUUID(), text: "线稿", done: false }],
    labelIds: ["label-a"],
    coverAssetId: "asset-1",
    attachmentObjectIds: ["object-1"],
  });
  assert.equal(item.title, "画封面");
  assert.equal(item.descriptionMarkdown, "主视觉");
  assert.equal(item.dueAt, "2026-10-01T00:00:00.000Z");
  assert.equal(item.checklist?.length, 1);
  assert.deepEqual(item.labelIds, ["label-a"]);
  assert.equal(item.coverAssetId, "asset-1");
  assert.deepEqual(item.attachmentObjectIds, ["object-1"]);
  const itemKey = (await store.list(".artstock/v1/kanban/items/")).keys[0];
  assert.ok(itemKey?.key.endsWith(`/kanban/items/${item.id}.json`));
  assert.ok(!itemKey?.key.includes(`/boards/${board.id}/`));
  const updated = await updateItem(remote, item.id, { title: "画封面 v2" });
  assert.equal(updated.title, "画封面 v2");
  const loaded = await getItem(store, "", item.id);
  assert.equal(loaded?.title, "画封面 v2");
  assert.equal((await listItems(store, "", todo.id)).length, 1);
});

test("item writes go through the lock", async () => {
  const inner = new MemoryObjectStore();
  const lockOnItem: boolean[] = [];
  const store: ObjectStore = {
    get: (key) => inner.get(key),
    head: (key) => inner.head(key),
    list: (prefix, options) => inner.list(prefix, options),
    delete: (key, options) => inner.delete(key, options),
    put: async (key, body, options?: PutOptions) => {
      if (key.includes("/kanban/items/")) {
        lockOnItem.push((await inner.get(lockKey(""))) != null);
      }
      return inner.put(key, body, options);
    },
  };
  const remote = device(store);
  const ws = await createWorkspace(remote, "项目");
  const board = await createBoard(remote, ws.id, "开发");
  const lists = await listLists(store, "", board.id);
  const todo = lists[0];
  assert.ok(todo);
  await createItem(remote, { boardId: board.id, listId: todo.id, title: "任务" });
  assert.ok(lockOnItem.every(Boolean));
  assert.equal(lockOnItem.length, 1);
  assert.equal(await inner.get(lockKey("")), null);
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

test("moving an item to another list survives reload", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const ws = await createWorkspace(remote, "项目");
  const board = await createBoard(remote, ws.id, "开发");
  const lists = await listLists(store, "", board.id);
  const todo = lists[0];
  const doing = lists[1];
  assert.ok(todo && doing);
  const item = await createItem(remote, {
    boardId: board.id,
    listId: todo.id,
    title: "可拖卡片",
  });
  await moveItem(remote, item.id, doing.id);
  const after = await getItem(store, "", item.id);
  assert.equal(after?.listId, doing.id);
  assert.equal((await listItems(store, "", todo.id)).length, 0);
  assert.equal((await listItems(store, "", doing.id))[0]?.title, "可拖卡片");
});
