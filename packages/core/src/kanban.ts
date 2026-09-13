import { encodeJson, decodeJson } from "./json.ts";
import {
  kanbanBoardMetaKey,
  kanbanIndexKey,
  kanbanItemKey,
  kanbanItemsPrefix,
  kanbanListKey,
  kanbanListsPrefix,
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
  type KanbanChecklistItem,
  type KanbanIndex,
  type KanbanItem,
  type KanbanList,
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

export const DEFAULT_KANBAN_LIST_NAMES = ["待办", "进行中", "完成"] as const;

function newList(
  boardId: string,
  name: string,
  order: number,
  at: string,
): KanbanList {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    boardId,
    name,
    order,
    updatedAt: at,
  };
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
      for (const [order, listName] of DEFAULT_KANBAN_LIST_NAMES.entries()) {
        const list = newList(id, listName, order, at);
        await remote.store.put(kanbanListKey(prefix, id, list.id), encodeJson(list), {
          contentType: "application/json",
          ifNoneMatch: "*",
          forbidOverwrite: true,
        });
      }
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

export async function listLists(
  store: ObjectStore,
  prefix: string,
  boardId: string,
): Promise<KanbanList[]> {
  const listed = await store.list(kanbanListsPrefix(prefix, boardId));
  const lists: KanbanList[] = [];
  for (const object of listed.keys) {
    const got = await store.get(object.key);
    if (!got) {
      continue;
    }
    lists.push(decodeJson(got.body) as KanbanList);
  }
  return lists.sort((a, b) => a.order - b.order);
}

export async function getList(
  store: ObjectStore,
  prefix: string,
  boardId: string,
  listId: string,
): Promise<KanbanList | null> {
  const got = await store.get(kanbanListKey(prefix, boardId, listId));
  if (!got) {
    return null;
  }
  return decodeJson(got.body) as KanbanList;
}

export async function createList(
  remote: RemoteLockTarget,
  boardId: string,
  name: string,
  options?: WithRemoteLockOptions,
): Promise<KanbanList> {
  const label = trimName(name, "List");
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const board = await getBoard(remote.store, prefix, boardId);
      if (!board) {
        throw new Error(`Board not found: ${boardId}`);
      }
      const existing = await listLists(remote.store, prefix, boardId);
      const list = newList(boardId, label, existing.length, nowIso());
      await remote.store.put(kanbanListKey(prefix, boardId, list.id), encodeJson(list), {
        contentType: "application/json",
        ifNoneMatch: "*",
        forbidOverwrite: true,
      });
      return list;
    },
    lockOpts(options),
  );
}

export type CreateItemInput = {
  boardId: string;
  listId: string;
  title: string;
  descriptionMarkdown?: string;
  dueAt?: string;
  checklist?: KanbanChecklistItem[];
  labelIds?: string[];
  coverAssetId?: string;
  attachmentObjectIds?: string[];
};

export type UpdateItemPatch = {
  title?: string;
  descriptionMarkdown?: string;
  dueAt?: string | null;
  checklist?: KanbanChecklistItem[];
  labelIds?: string[];
  coverAssetId?: string | null;
  attachmentObjectIds?: string[];
  listId?: string;
  order?: number;
  archivedAt?: string | null;
};

function trimTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error("Item title must not be empty");
  }
  return trimmed;
}

export async function getItem(
  store: ObjectStore,
  prefix: string,
  itemId: string,
): Promise<KanbanItem | null> {
  const got = await store.get(kanbanItemKey(prefix, itemId));
  if (!got) {
    return null;
  }
  return decodeJson(got.body) as KanbanItem;
}

export async function listItems(
  store: ObjectStore,
  prefix: string,
  listId?: string,
): Promise<KanbanItem[]> {
  const listed = await store.list(kanbanItemsPrefix(prefix));
  const items: KanbanItem[] = [];
  for (const object of listed.keys) {
    const got = await store.get(object.key);
    if (!got) {
      continue;
    }
    const item = decodeJson(got.body) as KanbanItem;
    if (listId && item.listId !== listId) {
      continue;
    }
    items.push(item);
  }
  return items.sort((a, b) => a.order - b.order);
}

export async function createItem(
  remote: RemoteLockTarget,
  input: CreateItemInput,
  options?: WithRemoteLockOptions,
): Promise<KanbanItem> {
  const title = trimTitle(input.title);
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const list = await getList(remote.store, prefix, input.boardId, input.listId);
      if (!list) {
        throw new Error(`List not found: ${input.listId}`);
      }
      const siblings = await listItems(remote.store, prefix, input.listId);
      const at = nowIso();
      const item: KanbanItem = {
        schemaVersion: SCHEMA_VERSION,
        id: crypto.randomUUID(),
        listId: input.listId,
        title,
        order: siblings.length,
        updatedAt: at,
      };
      if (input.descriptionMarkdown != null) {
        item.descriptionMarkdown = input.descriptionMarkdown;
      }
      if (input.dueAt != null) {
        item.dueAt = input.dueAt;
      }
      if (input.checklist != null) {
        item.checklist = input.checklist;
      }
      if (input.labelIds != null) {
        item.labelIds = input.labelIds;
      }
      if (input.coverAssetId != null) {
        item.coverAssetId = input.coverAssetId;
      }
      if (input.attachmentObjectIds != null) {
        item.attachmentObjectIds = input.attachmentObjectIds;
      }
      await remote.store.put(kanbanItemKey(prefix, item.id), encodeJson(item), {
        contentType: "application/json",
        ifNoneMatch: "*",
        forbidOverwrite: true,
      });
      return item;
    },
    lockOpts(options),
  );
}

export async function updateItem(
  remote: RemoteLockTarget,
  itemId: string,
  patch: UpdateItemPatch,
  options?: WithRemoteLockOptions,
): Promise<KanbanItem> {
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const key = kanbanItemKey(prefix, itemId);
      const got = await remote.store.get(key);
      if (!got) {
        throw new Error(`Item not found: ${itemId}`);
      }
      const item = decodeJson(got.body) as KanbanItem;
      if (patch.title != null) {
        item.title = trimTitle(patch.title);
      }
      if (patch.descriptionMarkdown != null) {
        item.descriptionMarkdown = patch.descriptionMarkdown;
      }
      if (patch.dueAt === null) {
        delete item.dueAt;
      } else if (patch.dueAt != null) {
        item.dueAt = patch.dueAt;
      }
      if (patch.checklist != null) {
        item.checklist = patch.checklist;
      }
      if (patch.labelIds != null) {
        item.labelIds = patch.labelIds;
      }
      if (patch.coverAssetId === null) {
        delete item.coverAssetId;
      } else if (patch.coverAssetId != null) {
        item.coverAssetId = patch.coverAssetId;
      }
      if (patch.attachmentObjectIds != null) {
        item.attachmentObjectIds = patch.attachmentObjectIds;
      }
      if (patch.listId != null) {
        item.listId = patch.listId;
      }
      if (patch.order != null) {
        item.order = patch.order;
      }
      if (patch.archivedAt === null) {
        delete item.archivedAt;
      } else if (patch.archivedAt != null) {
        item.archivedAt = patch.archivedAt;
      }
      item.updatedAt = nowIso();
      await remote.store.put(key, encodeJson(item), {
        contentType: "application/json",
        ifMatch: got.etag,
      });
      return item;
    },
    lockOpts(options),
  );
}
