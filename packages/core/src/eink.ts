import { encodeJson, decodeJson } from "./json.ts";
import { einkConfigKey, einkSummaryKey, lockKey } from "./keys.ts";
import {
  withRemoteLock,
  type RemoteLockTarget,
  type WithRemoteLockOptions,
} from "./lock.ts";
import { listLibraries } from "./libraries.ts";
import { readTree } from "./tree.ts";
import {
  getBoard,
  listItems,
  listLists,
  listWorkspaces,
} from "./kanban.ts";
import {
  SCHEMA_VERSION,
  type EinkConfig,
  type EinkSummary,
  type EinkSummaryRecentFile,
  type EinkSummaryTodo,
  type LockDocument,
} from "./types.ts";
import type { ObjectStore } from "./store.ts";

const lockOpts = (options?: WithRemoteLockOptions): WithRemoteLockOptions => ({
  probe: false,
  scheduleHeartbeat: () => () => {},
  ...options,
});

/** Firmware must stay under this; drop oldest rows if needed. */
export const EINK_SUMMARY_MAX_BYTES = 32 * 1024;

export const DEFAULT_EINK_CONFIG: EinkConfig = {
  schemaVersion: SCHEMA_VERSION,
  refreshIntervalMinutes: 120,
  todo: {
    workspaceId: "",
    boardId: null,
    listNames: ["待办", "进行中"],
    maxItems: 8,
  },
};

const SECRET_RE = /secretAccessKey|accessKeyId|secret_access_key|aws_secret/i;

export function einkJsonHasSecrets(value: unknown): boolean {
  return SECRET_RE.test(JSON.stringify(value));
}

export function assertEinkNoSecrets(value: unknown): void {
  if (einkJsonHasSecrets(value)) {
    throw new Error("eink JSON must not contain credentials");
  }
}

export function defaultEinkConfig(todo?: Partial<EinkConfig["todo"]>): EinkConfig {
  return {
    ...DEFAULT_EINK_CONFIG,
    todo: { ...DEFAULT_EINK_CONFIG.todo, ...todo },
  };
}

async function putLockedJson(
  remote: RemoteLockTarget,
  key: string,
  value: unknown,
  options?: WithRemoteLockOptions,
): Promise<void> {
  assertEinkNoSecrets(value);
  const prefix = remote.prefix ?? "";
  await withRemoteLock(
    remote,
    "eink-summary",
    async () => {
      const lock = await remote.store.get(lockKey(prefix));
      if (!lock) {
        throw new Error("eink PUT requires an active lock.json");
      }
      const doc = decodeJson(lock.body) as LockDocument;
      if (doc.purpose !== "eink-summary") {
        throw new Error("eink PUT must run with purpose eink-summary");
      }
      await remote.store.put(key, encodeJson(value), {
        contentType: "application/json",
      });
    },
    lockOpts(options),
  );
}

export async function writeEinkConfig(
  remote: RemoteLockTarget,
  config: EinkConfig,
  options?: WithRemoteLockOptions,
): Promise<EinkConfig> {
  const next: EinkConfig = {
    schemaVersion: SCHEMA_VERSION,
    refreshIntervalMinutes: config.refreshIntervalMinutes || 120,
    todo: {
      workspaceId: config.todo.workspaceId,
      boardId: config.todo.boardId,
      listNames: [...config.todo.listNames],
      maxItems: config.todo.maxItems || 8,
    },
  };
  await putLockedJson(remote, einkConfigKey(remote.prefix ?? ""), next, options);
  return next;
}

function trimSummary(summary: EinkSummary): EinkSummary {
  const next: EinkSummary = {
    ...summary,
    recentFiles: [...summary.recentFiles],
    todos: [...summary.todos],
  };
  while (
    encodeJson(next).byteLength > EINK_SUMMARY_MAX_BYTES &&
    (next.recentFiles.length > 0 || next.todos.length > 0)
  ) {
    if (next.recentFiles.length >= next.todos.length) {
      next.recentFiles.pop();
    } else {
      next.todos.pop();
    }
  }
  if (encodeJson(next).byteLength > EINK_SUMMARY_MAX_BYTES) {
    throw new Error("eink summary exceeds 32KB");
  }
  return next;
}

export async function buildEinkSummary(
  store: ObjectStore,
  prefix: string,
  generatedBy: string,
  config: EinkConfig = DEFAULT_EINK_CONFIG,
): Promise<EinkSummary> {
  const libraries = await listLibraries(store, prefix);
  const recentFiles: EinkSummaryRecentFile[] = [];
  for (const lib of libraries) {
    const tree = await readTree(store, prefix, lib.id);
    for (const node of tree?.tree.nodes ?? []) {
      if (node.kind !== "file") {
        continue;
      }
      recentFiles.push({
        name: node.name,
        libraryName: lib.name,
        updatedAt: node.updatedAt,
      });
    }
  }
  recentFiles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const todos = await collectTodos(store, prefix, config);
  const summary: EinkSummary = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    generatedBy,
    libraryCount: libraries.length,
    recentFiles: recentFiles.slice(0, 12),
    todos,
  };
  assertEinkNoSecrets(summary);
  return trimSummary(summary);
}

async function collectTodos(
  store: ObjectStore,
  prefix: string,
  config: EinkConfig,
): Promise<EinkSummaryTodo[]> {
  const workspaceId = config.todo.workspaceId?.trim();
  if (!workspaceId) {
    return [];
  }
  const workspaces = await listWorkspaces(store, prefix);
  const space = workspaces.find((item) => item.id === workspaceId);
  if (!space) {
    return [];
  }
  const boardIds = config.todo.boardId
    ? [config.todo.boardId]
    : space.boardIds;
  const wanted = new Set(config.todo.listNames.map((name) => name.trim()).filter(Boolean));
  const todos: EinkSummaryTodo[] = [];
  for (const boardId of boardIds) {
    const board = await getBoard(store, prefix, boardId);
    if (!board) {
      continue;
    }
    const lists = await listLists(store, prefix, boardId);
    for (const list of lists) {
      if (wanted.size > 0 && !wanted.has(list.name)) {
        continue;
      }
      const items = await listItems(store, prefix, list.id);
      for (const item of items) {
        if (item.archivedAt) {
          continue;
        }
        todos.push({
          title: item.title,
          dueAt: item.dueAt ?? null,
          boardName: board.name,
        });
        if (todos.length >= config.todo.maxItems) {
          return todos;
        }
      }
    }
  }
  return todos;
}

export async function writeEinkSummary(
  remote: RemoteLockTarget,
  summary: EinkSummary,
  options?: WithRemoteLockOptions,
): Promise<EinkSummary> {
  const trimmed = trimSummary(summary);
  assertEinkNoSecrets(trimmed);
  await putLockedJson(
    remote,
    einkSummaryKey(remote.prefix ?? ""),
    trimmed,
    options,
  );
  return trimmed;
}

export async function refreshEinkSummary(
  remote: RemoteLockTarget,
  config?: EinkConfig,
  options?: WithRemoteLockOptions,
): Promise<EinkSummary> {
  const prefix = remote.prefix ?? "";
  const used =
    config ??
    (await readEinkConfig(remote.store, prefix)) ??
    DEFAULT_EINK_CONFIG;
  const summary = await buildEinkSummary(
    remote.store,
    prefix,
    remote.deviceId,
    used,
  );
  return writeEinkSummary(remote, summary, options);
}

/** Firmware GET path: config only, never List, never lock. */
export async function readEinkConfig(
  store: ObjectStore,
  prefix: string,
): Promise<EinkConfig | null> {
  const got = await store.get(einkConfigKey(prefix));
  if (!got) {
    return null;
  }
  return decodeJson(got.body) as EinkConfig;
}

/** Firmware GET path: summary only, never List, never lock. */
export async function readEinkSummary(
  store: ObjectStore,
  prefix: string,
): Promise<EinkSummary | null> {
  const got = await store.get(einkSummaryKey(prefix));
  if (!got) {
    return null;
  }
  return decodeJson(got.body) as EinkSummary;
}

/** Device wake cycle: GET two keys. Must not call list() or withRemoteLock. */
export async function fetchEinkForFirmware(
  store: ObjectStore,
  prefix: string,
): Promise<{ config: EinkConfig | null; summary: EinkSummary | null }> {
  const config = await readEinkConfig(store, prefix);
  const summary = await readEinkSummary(store, prefix);
  return { config, summary };
}
