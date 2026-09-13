import assert from "node:assert/strict";
import { test } from "node:test";
import { createLibrary } from "./libraries.ts";
import { importObjectNow } from "./import.ts";
import { createBoard, createItem, createWorkspace, listLists } from "./kanban.ts";
import { MemoryObjectStore } from "./store.ts";
import { einkConfigKey, einkSummaryKey, lockKey } from "./keys.ts";
import { decodeJson } from "./json.ts";
import {
  DEFAULT_EINK_CONFIG,
  EINK_SUMMARY_MAX_BYTES,
  assertEinkNoSecrets,
  buildEinkSummary,
  einkJsonHasSecrets,
  fetchEinkForFirmware,
  refreshEinkSummary,
  writeEinkConfig,
} from "./eink.ts";
import type { LockDocument } from "./types.ts";
import type { ObjectStore } from "./index.ts";

function device(store: ObjectStore, deviceId = "desk-eink") {
  return { store, deviceId, deviceName: deviceId, prefix: "" };
}

test("client writes config and summary under eink-summary lock without secrets", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const lib = await createLibrary(remote, "角色设定");
  await importObjectNow(remote, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "主角-立绘.clip",
    bytes: new TextEncoder().encode("art"),
    type: "artwork",
  });
  const ws = await createWorkspace(remote, "工作室");
  const board = await createBoard(remote, ws.id, "当前项目");
  const lists = await listLists(store, "", board.id);
  const todoList = lists.find((item) => item.name === "待办") ?? lists[0]!;
  await createItem(remote, {
    boardId: board.id,
    listId: todoList.id,
    title: "修手部结构",
  });

  const purposes: string[] = [];
  const origPut = store.put.bind(store);
  store.put = async (key, body, options) => {
    if (key === lockKey("")) {
      purposes.push((decodeJson(body) as LockDocument).purpose);
    }
    if (key === einkSummaryKey("") || key === einkConfigKey("")) {
      assert.ok(await store.get(lockKey("")), "PUT eink JSON while lock held");
    }
    return origPut(key, body, options);
  };

  const config = await writeEinkConfig(remote, {
    ...DEFAULT_EINK_CONFIG,
    todo: {
      workspaceId: ws.id,
      boardId: board.id,
      listNames: ["待办", "进行中"],
      maxItems: 8,
    },
  });
  const summary = await refreshEinkSummary(remote, config);
  assert.equal(summary.libraryCount, 1);
  assert.ok(summary.recentFiles.some((item) => item.name === "主角-立绘.clip"));
  assert.ok(summary.todos.some((item) => item.title === "修手部结构"));
  assert.ok(encodeJsonSize(summary) < EINK_SUMMARY_MAX_BYTES);
  assert.equal(einkJsonHasSecrets(summary), false);
  assertEinkNoSecrets(summary);
  assert.ok(purposes.includes("eink-summary"));
  assert.equal(
    JSON.stringify(summary).includes("secretAccessKey"),
    false,
  );
});

test("firmware fetch GETs only config and summary; never lists or locks", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  await writeEinkConfig(remote, DEFAULT_EINK_CONFIG);
  await refreshEinkSummary(remote, DEFAULT_EINK_CONFIG);

  const gets: string[] = [];
  const lists: string[] = [];
  const puts: string[] = [];
  const origGet = store.get.bind(store);
  store.get = async (key) => {
    gets.push(key);
    return origGet(key);
  };
  const origList = store.list.bind(store);
  store.list = async (prefix, options) => {
    lists.push(prefix);
    return origList(prefix, options);
  };
  const origPut = store.put.bind(store);
  store.put = async (key, body, options) => {
    puts.push(key);
    return origPut(key, body, options);
  };

  const fetched = await fetchEinkForFirmware(store, "");
  assert.equal(fetched.config?.refreshIntervalMinutes, 120);
  assert.ok(fetched.summary);
  assert.deepEqual(lists, []);
  assert.deepEqual(puts, []);
  assert.ok(gets.every((key) => key.includes("device/eink/")));
  assert.equal(gets.some((key) => key.endsWith("lock.json")), false);
});

test("buildEinkSummary rejects embedding credentials", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  await createLibrary(remote, "库");
  const summary = await buildEinkSummary(store, "", "dev");
  assert.throws(() =>
    assertEinkNoSecrets({ ...summary, secretAccessKey: "wJalr" }),
  );
});

function encodeJsonSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
