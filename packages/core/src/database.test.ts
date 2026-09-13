import assert from "node:assert/strict";
import { test } from "node:test";
import { createLibrary } from "./libraries.ts";
import { importObjectNow } from "./import.ts";
import { MemoryObjectStore } from "./store.ts";
import {
  addDatabaseColumn,
  addDatabaseRow,
  applyCellChoice,
  createDatabaseDoc,
  databaseUsesSqlite,
  diffDatabaseCells,
  encodeDatabaseDoc,
  liveRows,
  loadDatabase,
  mergeDatabaseDocs,
  parseDatabaseDoc,
  saveDatabase,
  setDatabaseCell,
} from "./database.ts";
import { createHlcClock, tickHlc } from "./hlc.ts";
import type { ObjectStore } from "./index.ts";

function device(store: ObjectStore, deviceId = "dev-a") {
  return { store, deviceId, deviceName: deviceId, prefix: "" };
}

test("database snapshot persists columns and 10 rows as JSON not sqlite", async () => {
  const store = new MemoryObjectStore();
  const remote = device(store);
  const lib = await createLibrary(remote, "库");
  const clock = createHlcClock("dev-a");
  let doc = createDatabaseDoc([
    { name: "标题", type: "text" },
    { name: "素材", type: "ref-asset" },
  ]);
  const titleId = doc.columns[0]!.id;
  const assetId = doc.columns[1]!.id;
  for (let i = 0; i < 10; i++) {
    doc = addDatabaseRow(
      doc,
      { [titleId]: `row-${i}`, [assetId]: `asset-${i}` },
      tickHlc(clock, 1000 + i),
    );
  }
  const imported = await importObjectNow(remote, {
    libraryId: lib.id,
    parentFolderId: null,
    name: "cast.database",
    bytes: encodeDatabaseDoc(createDatabaseDoc()),
    type: "database",
    mimeType: "application/json",
  });
  await saveDatabase(remote, imported.object.id, doc, "main", { clock, nowMs: 2000 });
  const loaded = await loadDatabase(store, "", imported.object.id);
  assert.ok(loaded);
  assert.equal(liveRows(loaded).length, 10);
  assert.equal(loaded.columns.map((column) => column.type).join(), "text,ref-asset");
  const listed = await store.list(".artstock/v1/");
  assert.equal(databaseUsesSqlite(listed.keys.map((item) => item.key)), false);
  assert.ok(listed.keys.some((item) => item.key.includes("/oplog/")));
  const parsed = parseDatabaseDoc(encodeDatabaseDoc(loaded));
  assert.equal(parsed.schemaVersion, 1);
});

test("different rows from two replicas merge; same cell is resolved by choice", () => {
  const clockA = createHlcClock("a");
  const clockB = createHlcClock("b");
  let local = createDatabaseDoc([{ name: "标题", type: "text" }]);
  const col = local.columns[0]!.id;
  local = addDatabaseRow(local, { [col]: "alpha" }, tickHlc(clockA, 10));
  let remote = createDatabaseDoc([{ name: "标题", type: "text" }]);
  remote.columns = local.columns;
  remote = addDatabaseRow(remote, { [col]: "beta" }, tickHlc(clockB, 11));
  const merged = mergeDatabaseDocs(local, remote);
  assert.equal(liveRows(merged).length, 2);

  let both = createDatabaseDoc([{ name: "标题", type: "text" }]);
  const columnId = both.columns[0]!.id;
  both = addDatabaseRow(both, { [columnId]: "old" }, tickHlc(clockA, 1));
  const rowId = both.rows[0]!.id;
  const localEdit = setDatabaseCell(both, rowId, columnId, "L", tickHlc(clockA, 20));
  const remoteEdit = setDatabaseCell(both, rowId, columnId, "R", tickHlc(clockB, 21));
  const conflicts = diffDatabaseCells(localEdit, remoteEdit);
  assert.equal(conflicts.length, 1);
  const picked = applyCellChoice(
    localEdit,
    remoteEdit,
    conflicts[0]!,
    "remote",
    tickHlc(clockA, 30),
  );
  assert.equal(picked.rows.find((row) => row.id === rowId)?.cells[columnId], "R");
  assert.equal(liveRows(picked).length, 1);
});
