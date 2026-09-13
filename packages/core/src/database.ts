import { encodeJson, decodeJson } from "./json.ts";
import { formatHlcStamp, compareHlc, createHlcClock, tickHlc, type HlcClock } from "./hlc.ts";
import { oplogKey } from "./keys.ts";
import {
  withRemoteLock,
  type RemoteLockTarget,
  type WithRemoteLockOptions,
} from "./lock.ts";
import { SCHEMA_VERSION, type Hlc, type OplogEntry, type OplogOp } from "./types.ts";
import { commitSnapshot, readBranchBytes, type CommitSnapshotOptions } from "./versions.ts";
import type { ObjectStore } from "./store.ts";

const lockOpts = (options?: WithRemoteLockOptions): WithRemoteLockOptions => ({
  probe: false,
  scheduleHeartbeat: () => () => {},
  ...options,
});

export type ColumnType =
  | "text"
  | "number"
  | "bool"
  | "date"
  | "select"
  | "ref-asset"
  | "ref-object";

export type DatabaseColumn = {
  id: string;
  name: string;
  type: ColumnType;
  options?: string[];
  updatedHlc?: Hlc;
  tombstone?: boolean;
};

export type DatabaseRow = {
  id: string;
  cells: Record<string, unknown>;
  updatedHlc: Hlc;
  tombstone?: boolean;
};

export type DatabaseView = {
  id: string;
  name: string;
  filters: unknown;
};

export type DatabaseDoc = {
  schemaVersion: 1;
  columns: DatabaseColumn[];
  rows: DatabaseRow[];
  views?: DatabaseView[];
};

export type DatabaseWriteOptions = WithRemoteLockOptions & {
  clock?: HlcClock;
  nowMs?: number;
};

export type CellConflict = {
  rowId: string;
  columnId: string;
  local: unknown;
  remote: unknown;
};

const emptyHlc: Hlc = { ts: 0, c: 0, deviceId: "" };

export function isDatabaseName(name: string): boolean {
  return /\.(database|db\.json)$/i.test(name);
}

export function createDatabaseDoc(
  columns: { name: string; type: ColumnType }[] = [
    { name: "标题", type: "text" },
  ],
): DatabaseDoc {
  return {
    schemaVersion: SCHEMA_VERSION,
    columns: columns.map((column) => ({
      id: crypto.randomUUID(),
      name: column.name,
      type: column.type,
    })),
    rows: [],
    views: [],
  };
}

export function encodeDatabaseDoc(doc: DatabaseDoc): Uint8Array {
  return encodeJson(doc);
}

export function parseDatabaseDoc(bytes: Uint8Array): DatabaseDoc {
  const raw = decodeJson(bytes) as DatabaseDoc;
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.columns) || !Array.isArray(raw.rows)) {
    throw new Error("DatabaseDoc must be schemaVersion 1 JSON");
  }
  return raw;
}

export function liveColumns(doc: DatabaseDoc): DatabaseColumn[] {
  return doc.columns.filter((column) => !column.tombstone);
}

export function liveRows(doc: DatabaseDoc): DatabaseRow[] {
  return doc.rows.filter((row) => !row.tombstone);
}

export function addDatabaseColumn(
  doc: DatabaseDoc,
  name: string,
  type: ColumnType,
  hlc: Hlc,
  options?: string[],
): DatabaseDoc {
  const column: DatabaseColumn = {
    id: crypto.randomUUID(),
    name,
    type,
    updatedHlc: hlc,
  };
  if (options) {
    column.options = options;
  }
  return { ...doc, columns: [...doc.columns, column] };
}

export function addDatabaseRow(
  doc: DatabaseDoc,
  cells: Record<string, unknown>,
  hlc: Hlc,
): DatabaseDoc {
  const row: DatabaseRow = { id: crypto.randomUUID(), cells: { ...cells }, updatedHlc: hlc };
  return { ...doc, rows: [...doc.rows, row] };
}

export function setDatabaseCell(
  doc: DatabaseDoc,
  rowId: string,
  columnId: string,
  value: unknown,
  hlc: Hlc,
): DatabaseDoc {
  return {
    ...doc,
    rows: doc.rows.map((row) =>
      row.id === rowId
        ? {
            ...row,
            cells: { ...row.cells, [columnId]: value },
            updatedHlc: hlc,
          }
        : row,
    ),
  };
}

export function tombstoneDatabaseRow(
  doc: DatabaseDoc,
  rowId: string,
  hlc: Hlc,
): DatabaseDoc {
  return {
    ...doc,
    rows: doc.rows.map((row) =>
      row.id === rowId ? { ...row, tombstone: true, updatedHlc: hlc } : row,
    ),
  };
}

function pickLww<T extends { updatedHlc?: Hlc; tombstone?: boolean }>(
  a: T,
  b: T,
): T {
  return compareHlc(a.updatedHlc ?? emptyHlc, b.updatedHlc ?? emptyHlc) >= 0 ? a : b;
}

export function mergeDatabaseDocs(a: DatabaseDoc, b: DatabaseDoc): DatabaseDoc {
  const columns = new Map<string, DatabaseColumn>();
  for (const column of [...a.columns, ...b.columns]) {
    const current = columns.get(column.id);
    columns.set(column.id, current ? pickLww(current, column) : column);
  }
  const rows = new Map<string, DatabaseRow>();
  for (const row of [...a.rows, ...b.rows]) {
    const current = rows.get(row.id);
    rows.set(row.id, current ? pickLww(current, row) : row);
  }
  return {
    schemaVersion: 1,
    columns: [...columns.values()],
    rows: [...rows.values()],
    views: a.views ?? b.views,
  };
}

export function diffDatabaseCells(
  local: DatabaseDoc,
  remote: DatabaseDoc,
): CellConflict[] {
  const remoteRows = new Map(remote.rows.map((row) => [row.id, row]));
  const conflicts: CellConflict[] = [];
  for (const localRow of local.rows) {
    const remoteRow = remoteRows.get(localRow.id);
    if (!remoteRow || localRow.tombstone || remoteRow.tombstone) {
      continue;
    }
    const keys = new Set([
      ...Object.keys(localRow.cells),
      ...Object.keys(remoteRow.cells),
    ]);
    for (const columnId of keys) {
      const lv = localRow.cells[columnId];
      const rv = remoteRow.cells[columnId];
      if (JSON.stringify(lv) !== JSON.stringify(rv)) {
        conflicts.push({ rowId: localRow.id, columnId, local: lv, remote: rv });
      }
    }
  }
  return conflicts;
}

export function applyCellChoice(
  local: DatabaseDoc,
  remote: DatabaseDoc,
  conflict: CellConflict,
  side: "local" | "remote",
  hlc: Hlc,
): DatabaseDoc {
  const value = side === "local" ? conflict.local : conflict.remote;
  const merged = mergeDatabaseDocs(local, remote);
  return setDatabaseCell(merged, conflict.rowId, conflict.columnId, value, hlc);
}

function rowOps(objectId: string, doc: DatabaseDoc): OplogOp[] {
  return liveRows(doc).map((row) => ({
    op: "upsert" as const,
    entity: "database.row",
    id: row.id,
    fields: {
      objectId,
      cells: row.cells,
      updatedHlc: row.updatedHlc,
    },
  }));
}

export async function saveDatabase(
  remote: RemoteLockTarget,
  objectId: string,
  doc: DatabaseDoc,
  branch?: string,
  options?: DatabaseWriteOptions & CommitSnapshotOptions,
) {
  const snap = await commitSnapshot(
    remote,
    objectId,
    encodeDatabaseDoc(doc),
    "database",
    branch,
    options,
  );
  const clock = options?.clock ?? createHlcClock(remote.deviceId);
  const hlc = tickHlc(clock, options?.nowMs ?? Date.now());
  const year = new Date(hlc.ts).getUTCFullYear();
  const entry: OplogEntry = {
    schemaVersion: SCHEMA_VERSION,
    hlc,
    deviceId: remote.deviceId,
    ops: [
      { op: "put", key: `objects/${objectId}/snapshots/${snap.id}.json`, blobSha256: snap.blobSha256 },
      ...rowOps(objectId, doc),
    ],
  };
  await withRemoteLock(
    remote,
    "sync",
    async () => {
      await remote.store.put(
        oplogKey(remote.prefix ?? "", year, formatHlcStamp(hlc), remote.deviceId),
        encodeJson(entry),
        { contentType: "application/json", ifNoneMatch: "*", forbidOverwrite: true },
      );
    },
    lockOpts(options),
  );
  return snap;
}

export async function loadDatabase(
  store: ObjectStore,
  prefix: string,
  objectId: string,
): Promise<DatabaseDoc | null> {
  const got = await readBranchBytes(store, prefix, objectId);
  if (!got) {
    return null;
  }
  return parseDatabaseDoc(got.bytes);
}

export function databaseUsesSqlite(keys: readonly string[]): boolean {
  return keys.some((key) => key.toLowerCase().includes(".sqlite"));
}
