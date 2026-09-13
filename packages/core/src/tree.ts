import { encodeJson, decodeJson } from "./json.ts";
import { libraryTreeKey } from "./keys.ts";
import {
  withRemoteLock,
  type RemoteLockTarget,
  type WithRemoteLockOptions,
} from "./lock.ts";
import { SCHEMA_VERSION, type LibraryTree, type TreeNode } from "./types.ts";
import type { ObjectStore } from "./store.ts";

const lockOpts = (options?: WithRemoteLockOptions): WithRemoteLockOptions => ({
  probe: false,
  scheduleHeartbeat: () => () => {},
  ...options,
});

function nowIso(): string {
  return new Date().toISOString();
}

function trimName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Folder name must not be empty");
  }
  return trimmed;
}

export function wouldCreateCycle(
  nodes: TreeNode[],
  nodeId: string,
  newParentId: string | null,
): boolean {
  if (newParentId == null) {
    return false;
  }
  if (newParentId === nodeId) {
    return true;
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  let current: string | null = newParentId;
  while (current) {
    if (current === nodeId) {
      return true;
    }
    if (seen.has(current)) {
      return true;
    }
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

export function subtreeIds(nodes: TreeNode[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let growing = true;
  while (growing) {
    growing = false;
    for (const node of nodes) {
      if (node.parentId != null && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id);
        growing = true;
      }
    }
  }
  return ids;
}

export function folderDepth(nodes: TreeNode[], nodeId: string): number {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let depth = 1;
  let current = byId.get(nodeId);
  const seen = new Set<string>();
  while (current?.parentId) {
    if (seen.has(current.id)) {
      break;
    }
    seen.add(current.id);
    depth += 1;
    current = byId.get(current.parentId);
  }
  return depth;
}

export async function readTree(
  store: ObjectStore,
  prefix: string,
  libraryId: string,
): Promise<{ tree: LibraryTree; etag: string } | null> {
  const got = await store.get(libraryTreeKey(prefix, libraryId));
  if (!got) {
    return null;
  }
  return { tree: decodeJson(got.body) as LibraryTree, etag: got.etag };
}

async function commitTree(
  remote: RemoteLockTarget,
  libraryId: string,
  mutate: (tree: LibraryTree) => void,
  options?: WithRemoteLockOptions,
): Promise<LibraryTree> {
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const current = await readTree(remote.store, prefix, libraryId);
      if (!current) {
        throw new Error(`Library tree not found: ${libraryId}`);
      }
      const tree: LibraryTree = {
        schemaVersion: SCHEMA_VERSION,
        nodes: current.tree.nodes.map((node) => ({ ...node })),
      };
      mutate(tree);
      await remote.store.put(libraryTreeKey(prefix, libraryId), encodeJson(tree), {
        contentType: "application/json",
        ifMatch: current.etag,
      });
      return tree;
    },
    lockOpts(options),
  );
}

export async function createFolder(
  remote: RemoteLockTarget,
  libraryId: string,
  parentId: string | null,
  name: string,
  options?: WithRemoteLockOptions,
): Promise<TreeNode> {
  const label = trimName(name);
  let created: TreeNode | undefined;
  await commitTree(
    remote,
    libraryId,
    (tree) => {
      if (parentId != null && !tree.nodes.some((node) => node.id === parentId)) {
        throw new Error(`Parent folder not found: ${parentId}`);
      }
      const siblings = tree.nodes.filter((node) => node.parentId === parentId);
      const at = nowIso();
      created = {
        id: crypto.randomUUID(),
        parentId,
        kind: "folder",
        name: label,
        tags: [],
        updatedAt: at,
        order: siblings.length,
      };
      tree.nodes.push(created);
    },
    options,
  );
  if (!created) {
    throw new Error("Failed to create folder");
  }
  return created;
}

export async function moveNode(
  remote: RemoteLockTarget,
  libraryId: string,
  nodeId: string,
  newParentId: string | null,
  order?: number,
  options?: WithRemoteLockOptions,
): Promise<TreeNode> {
  let moved: TreeNode | undefined;
  await commitTree(
    remote,
    libraryId,
    (tree) => {
      const node = tree.nodes.find((item) => item.id === nodeId);
      if (!node) {
        throw new Error(`Node not found: ${nodeId}`);
      }
      if (newParentId != null && !tree.nodes.some((item) => item.id === newParentId)) {
        throw new Error(`Parent folder not found: ${newParentId}`);
      }
      if (wouldCreateCycle(tree.nodes, nodeId, newParentId)) {
        throw new Error("Move would create a cycle");
      }
      node.parentId = newParentId;
      node.order = order ?? node.order;
      node.updatedAt = nowIso();
      moved = node;
    },
    options,
  );
  if (!moved) {
    throw new Error("Failed to move node");
  }
  return moved;
}
