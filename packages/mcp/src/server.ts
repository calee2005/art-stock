import {
  commitSnapshot,
  createItem,
  getBoard,
  importObjectNow,
  isRemoteError,
  listAssets,
  listItems,
  listLibraries,
  listLists,
  listSnapshots,
  listWorkspaces,
  moveItem,
  parseMindDoc,
  readBranchBytes,
  readTree,
  searchAssets,
  updateItem,
  type ObjectStore,
  type RemoteLockTarget,
} from "@art-stock/core";

export type McpRemotePublic = {
  id: string;
  name: string;
  mode: "readonly" | "readwrite";
};

export type McpSession = {
  remotes: McpRemotePublic[];
  store: ObjectStore;
  prefix: string;
  deviceId: string;
  deviceName: string;
};

const TOOLS = [
  { name: "list_remotes", description: "List remotes without secrets" },
  { name: "list_libraries", description: "List libraries" },
  { name: "list_folder", description: "List a library folder tree" },
  { name: "search_assets", description: "Search assets by name/tags" },
  { name: "read_object_text", description: "Read markdown or mindmap JSON" },
  { name: "write_markdown", description: "Create or snapshot markdown" },
  { name: "kanban_list_workspaces", description: "List kanban workspaces" },
  { name: "kanban_list_boards", description: "List boards in a workspace" },
  { name: "kanban_list_items", description: "List items" },
  { name: "kanban_create_item", description: "Create a kanban item" },
  { name: "kanban_move_item", description: "Move an item to another list" },
  { name: "kanban_update_item", description: "Update an item" },
] as const;

export function listMcpTools() {
  return TOOLS.map((tool) => ({ name: tool.name, description: tool.description }));
}

export function lockTarget(session: McpSession): RemoteLockTarget {
  return {
    store: session.store,
    prefix: session.prefix,
    deviceId: session.deviceId,
    deviceName: session.deviceName,
  };
}

export function assertNoSecrets(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (/secretAccessKey|secret_access_key/i.test(text)) {
    throw new Error("Refusing to return credentials");
  }
  return value;
}

function asString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`Missing ${key}`);
  }
  return value;
}

export async function callMcpTool(
  session: McpSession,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  try {
    return assertNoSecrets(await dispatch(session, name, args));
  } catch (error) {
    if (isRemoteError(error) && error.code === "REMOTE_LOCK_HELD") {
      return { error: "REMOTE_LOCK_HELD" };
    }
    throw error;
  }
}

async function dispatch(
  session: McpSession,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const remote = lockTarget(session);
  const { store, prefix } = session;
  switch (name) {
    case "list_remotes":
      return { remotes: session.remotes };
    case "list_libraries":
      return {
        libraries: (await listLibraries(store, prefix)).map((item) => ({
          id: item.id,
          name: item.name,
        })),
      };
    case "list_folder": {
      const libraryId = asString(args, "libraryId");
      const tree = await readTree(store, prefix, libraryId);
      return { nodes: tree?.tree.nodes ?? [] };
    }
    case "search_assets": {
      const query = typeof args.query === "string" ? args.query : "";
      const assets = await listAssets(store, prefix);
      return {
        assets: searchAssets(assets, query).map((item) => ({
          id: item.id,
          name: item.name,
          tags: item.tags,
        })),
      };
    }
    case "read_object_text": {
      const objectId = asString(args, "objectId");
      const got = await readBranchBytes(store, prefix, objectId);
      if (!got) {
        return { text: null };
      }
      const text = new TextDecoder().decode(got.bytes);
      try {
        return { text, mindmap: parseMindDoc(got.bytes) };
      } catch {
        return { text };
      }
    }
    case "write_markdown": {
      const text = asString(args, "text");
      const bytes = new TextEncoder().encode(text);
      if (typeof args.objectId === "string" && args.objectId) {
        const snap = await commitSnapshot(
          remote,
          args.objectId,
          bytes,
          "mcp-markdown",
        );
        return { objectId: args.objectId, snapshotId: snap.id };
      }
      const libraryId = asString(args, "libraryId");
      const imported = await importObjectNow(remote, {
        libraryId,
        parentFolderId: null,
        name: typeof args.name === "string" ? args.name : "note.md",
        bytes,
        type: "markdown",
        mimeType: "text/markdown",
      });
      const snaps = await listSnapshots(store, prefix, imported.object.id);
      return {
        objectId: imported.object.id,
        snapshotId: snaps.at(-1)?.id ?? null,
      };
    }
    case "kanban_list_workspaces":
      return { workspaces: await listWorkspaces(store, prefix) };
    case "kanban_list_boards": {
      const workspaceId = asString(args, "workspaceId");
      const spaces = await listWorkspaces(store, prefix);
      const space = spaces.find((item) => item.id === workspaceId);
      const boards = [];
      for (const boardId of space?.boardIds ?? []) {
        const board = await getBoard(store, prefix, boardId);
        if (board) {
          boards.push({ id: board.id, name: board.name, workspaceId: board.workspaceId });
        }
      }
      return { boards };
    }
    case "kanban_list_items": {
      if (typeof args.boardId === "string" && args.boardId) {
        const lists = await listLists(store, prefix, args.boardId);
        const listIds = new Set(lists.map((item) => item.id));
        const items = (await listItems(store, prefix)).filter((item) =>
          listIds.has(item.listId),
        );
        return { items, lists: lists.map((item) => ({ id: item.id, name: item.name })) };
      }
      return { items: await listItems(store, prefix) };
    }
    case "kanban_create_item": {
      const item = await createItem(remote, {
        boardId: asString(args, "boardId"),
        listId: asString(args, "listId"),
        title: asString(args, "title"),
      });
      return { item };
    }
    case "kanban_move_item": {
      const item = await moveItem(
        remote,
        asString(args, "itemId"),
        asString(args, "listId"),
        typeof args.order === "number" ? args.order : undefined,
      );
      return { item };
    }
    case "kanban_update_item": {
      const item = await updateItem(remote, asString(args, "itemId"), {
        title: typeof args.title === "string" ? args.title : undefined,
      });
      return { item };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function handleJsonRpc(
  session: McpSession,
  message: {
    jsonrpc?: string;
    id?: number | string | null;
    method?: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
  },
) {
  if (message.method === "tools/list") {
    return { jsonrpc: "2.0", id: message.id ?? null, result: { tools: listMcpTools() } };
  }
  if (message.method === "tools/call") {
    const name = message.params?.name ?? "";
    const result = await callMcpTool(session, name, message.params?.arguments ?? {});
    return {
      jsonrpc: "2.0",
      id: message.id ?? null,
      result: { content: [{ type: "text", text: JSON.stringify(result) }] },
    };
  }
  return {
    jsonrpc: "2.0",
    id: message.id ?? null,
    error: { code: -32601, message: `Unknown method ${message.method}` },
  };
}

