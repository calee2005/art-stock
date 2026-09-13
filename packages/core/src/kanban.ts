import { encodeJson, decodeJson } from "./json.ts";
import {
  kanbanBoardMetaKey,
  kanbanIndexKey,
  kanbanWorkspaceMetaKey,
} from "./keys.ts";
import {
  withRemoteLock,
  type RemoteLockTarget,
  type WithRemoteLockOptions,
} from "./lock.ts";
import {
  SCHEMA_VERSION,
  type KanbanBoardMeta,
  type KanbanIndex,
  type KanbanWorkspaceMeta,
} from "./types.ts";
import type { ObjectStore } from "./store.ts";

const lockOpts = (options?: WithRemoteLockOptions): WithRemoteLockOptions => ({
  probe: false,
  scheduleHeartbeat: () => () => {},
  ...options,
});

function nowIso(): string {
  return new Date().toISOString();
}

function trimName(name: string, kind: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error(`${kind} name must not be empty`);
  }
  return trimmed;
}

function emptyIndex(at: string): KanbanIndex {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: at, workspaces: [] };
}

export async function readKanbanIndex(
  store: ObjectStore,
  prefix = "",
): Promise<{ index: KanbanIndex | null; etag?: string }> {
  const got = await store.get(kanbanIndexKey(prefix));
  if (!got) {
    return { index: null };
  }
  return { index: decodeJson(got.body) as KanbanIndex, etag: got.etag };
}

export async function listWorkspaces(
  store: ObjectStore,
  prefix = "",
): Promise<KanbanIndex["workspaces"]> {
  const { index } = await readKanbanIndex(store, prefix);
  return index?.workspaces ?? [];
}

async function putIndex(
  store: ObjectStore,
  prefix: string,
  index: KanbanIndex,
  etag?: string,
): Promise<void> {
  await store.put(kanbanIndexKey(prefix), encodeJson(index), {
    contentType: "application/json",
    ...(etag ? { ifMatch: etag } : { ifNoneMatch: "*" as const }),
  });
}

export async function createWorkspace(
  remote: RemoteLockTarget,
  name: string,
  options?: WithRemoteLockOptions,
): Promise<KanbanWorkspaceMeta> {
  const label = trimName(name, "Workspace");
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const at = nowIso();
      const { index, etag } = await readKanbanIndex(remote.store, prefix);
      const next = index ?? emptyIndex(at);
      const id = crypto.randomUUID();
      const meta: KanbanWorkspaceMeta = {
        schemaVersion: SCHEMA_VERSION,
        id,
        name: label,
        order: next.workspaces.length,
        updatedAt: at,
      };
      await remote.store.put(kanbanWorkspaceMetaKey(prefix, id), encodeJson(meta), {
        contentType: "application/json",
        ifNoneMatch: "*",
        forbidOverwrite: true,
      });
      next.workspaces = [...next.workspaces, { id, name: label, boardIds: [] }];
      next.updatedAt = at;
      await putIndex(remote.store, prefix, next, etag);
      return meta;
    },
    lockOpts(options),
  );
}

export async function createBoard(
  remote: RemoteLockTarget,
  workspaceId: string,
  name: string,
  options?: WithRemoteLockOptions,
): Promise<KanbanBoardMeta> {
  const label = trimName(name, "Board");
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const at = nowIso();
      const { index, etag } = await readKanbanIndex(remote.store, prefix);
      if (!index) {
        throw new Error("Kanban index missing");
      }
      const workspace = index.workspaces.find((item) => item.id === workspaceId);
      if (!workspace) {
        throw new Error(`Workspace not found: ${workspaceId}`);
      }
      const id = crypto.randomUUID();
      const meta: KanbanBoardMeta = {
        schemaVersion: SCHEMA_VERSION,
        id,
        workspaceId,
        name: label,
        labels: [],
        order: workspace.boardIds.length,
        updatedAt: at,
      };
      await remote.store.put(kanbanBoardMetaKey(prefix, id), encodeJson(meta), {
        contentType: "application/json",
        ifNoneMatch: "*",
        forbidOverwrite: true,
      });
      workspace.boardIds = [...workspace.boardIds, id];
      index.updatedAt = at;
      await putIndex(remote.store, prefix, index, etag);
      return meta;
    },
    lockOpts(options),
  );
}

export async function getBoard(
  store: ObjectStore,
  prefix: string,
  boardId: string,
): Promise<KanbanBoardMeta | null> {
  const got = await store.get(kanbanBoardMetaKey(prefix, boardId));
  if (!got) {
    return null;
  }
  return decodeJson(got.body) as KanbanBoardMeta;
}
