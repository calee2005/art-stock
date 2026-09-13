import { encodeJson, decodeJson } from "./json.ts";
import { libraryTreeKey, objectMetaKey } from "./keys.ts";
import { createHlcClock, tickHlc, type HlcClock } from "./hlc.ts";
import {
  withRemoteLock,
  type RemoteLockTarget,
  type WithRemoteLockOptions,
} from "./lock.ts";
import {
  addToOrSet,
  emptyOrSet,
  mergeOrSets,
  orSetFromTags,
  removeFromOrSet,
  valuesOfOrSet,
} from "./orset.ts";
import type { OrSet } from "./types.ts";
import { readTree } from "./tree.ts";
import { SCHEMA_VERSION, type ObjectMeta, type TreeNode } from "./types.ts";

const lockOpts = (options?: WithRemoteLockOptions): WithRemoteLockOptions => ({
  probe: false,
  scheduleHeartbeat: () => () => {},
  ...options,
});

export type TagWriteOptions = WithRemoteLockOptions & {
  clock?: HlcClock;
  nowMs?: number;
};

function trimTag(tag: string): string {
  const trimmed = tag.trim();
  if (!trimmed) {
    throw new Error("Tag must not be empty");
  }
  return trimmed;
}

const HYDRATE = { ts: 0, c: 0, deviceId: "hydrate" };

export function tagSetOf(node: { tags: string[]; tagSet?: OrSet }): OrSet {
  if (node.tagSet) {
    return node.tagSet;
  }
  return node.tags.length > 0 ? orSetFromTags(node.tags, HYDRATE) : emptyOrSet();
}

export function applyTagSet<T extends { tags: string[]; tagSet?: OrSet }>(
  entity: T,
  set: OrSet,
): T {
  return { ...entity, tagSet: set, tags: valuesOfOrSet(set) };
}

export function mergeEntityTags<T extends { tags: string[]; tagSet?: OrSet }>(
  local: T,
  remote: T,
): T {
  return applyTagSet(local, mergeOrSets(tagSetOf(local), tagSetOf(remote)));
}

export function nodesWithTag(nodes: TreeNode[], tag: string): TreeNode[] {
  const wanted = tag.trim();
  if (!wanted) {
    return nodes;
  }
  return nodes.filter((node) => node.tags.includes(wanted));
}

export function nodesMatchingTags(nodes: TreeNode[], tags: string[]): TreeNode[] {
  const wanted = tags.map((item) => item.trim()).filter(Boolean);
  if (wanted.length === 0) {
    return nodes;
  }
  return nodes.filter((node) => wanted.every((tag) => node.tags.includes(tag)));
}

async function writeNodeTag(
  remote: RemoteLockTarget,
  libraryId: string,
  nodeId: string,
  tag: string,
  op: "add" | "remove",
  options?: TagWriteOptions,
): Promise<TreeNode> {
  const value = trimTag(tag);
  const prefix = remote.prefix ?? "";
  const clock = options?.clock ?? createHlcClock(remote.deviceId);
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const current = await readTree(remote.store, prefix, libraryId);
      if (!current) {
        throw new Error(`Library tree not found: ${libraryId}`);
      }
      const nodes = current.tree.nodes.map((node) => ({ ...node }));
      const node = nodes.find((item) => item.id === nodeId);
      if (!node) {
        throw new Error(`Node not found: ${nodeId}`);
      }
      const hlc = tickHlc(clock, options?.nowMs ?? Date.now());
      const nextSet =
        op === "add"
          ? addToOrSet(tagSetOf(node), value, hlc)
          : removeFromOrSet(tagSetOf(node), value, hlc);
      const updated = applyTagSet(node, nextSet);
      updated.updatedAt = new Date().toISOString();
      const index = nodes.findIndex((item) => item.id === nodeId);
      nodes[index] = updated;
      await remote.store.put(
        libraryTreeKey(prefix, libraryId),
        encodeJson({ schemaVersion: SCHEMA_VERSION, nodes }),
        { contentType: "application/json", ifMatch: current.etag },
      );
      if (updated.kind === "file" && updated.objectId) {
        const key = objectMetaKey(prefix, updated.objectId);
        const got = await remote.store.get(key);
        if (got) {
          const meta = decodeJson(got.body) as ObjectMeta;
          const metaSet =
            op === "add"
              ? addToOrSet(tagSetOf(meta), value, hlc)
              : removeFromOrSet(tagSetOf(meta), value, hlc);
          const nextMeta = applyTagSet(meta, metaSet);
          nextMeta.updatedAt = updated.updatedAt;
          await remote.store.put(key, encodeJson(nextMeta), {
            contentType: "application/json",
            ifMatch: got.etag,
          });
        }
      }
      return updated;
    },
    lockOpts(options),
  );
}

export async function addNodeTag(
  remote: RemoteLockTarget,
  libraryId: string,
  nodeId: string,
  tag: string,
  options?: TagWriteOptions,
): Promise<TreeNode> {
  return writeNodeTag(remote, libraryId, nodeId, tag, "add", options);
}

export async function removeNodeTag(
  remote: RemoteLockTarget,
  libraryId: string,
  nodeId: string,
  tag: string,
  options?: TagWriteOptions,
): Promise<TreeNode> {
  return writeNodeTag(remote, libraryId, nodeId, tag, "remove", options);
}
