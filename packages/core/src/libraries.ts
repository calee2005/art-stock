import { encodeJson, decodeJson } from "./json.ts";
import {
  libraryMetaKey,
  libraryTreeKey,
  manifestKey,
} from "./keys.ts";
import { withRemoteLock, type RemoteLockTarget, type WithRemoteLockOptions } from "./lock.ts";
import { SCHEMA_VERSION, type LibraryMeta, type LibraryTree, type Manifest } from "./types.ts";
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
    throw new Error("Library name must not be empty");
  }
  return trimmed;
}

function emptyManifest(deviceId: string, at: string): Manifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: at,
    updatedBy: deviceId,
    libraries: [],
    assetLibrary: { id: "global", updatedAt: at },
    kanbanIndex: "kanban/index.json",
  };
}

function emptyTree(): LibraryTree {
  return { schemaVersion: SCHEMA_VERSION, nodes: [] };
}

export async function readManifest(
  store: ObjectStore,
  prefix = "",
): Promise<{ manifest: Manifest | null; etag?: string }> {
  const got = await store.get(manifestKey(prefix));
  if (!got) {
    return { manifest: null };
  }
  return { manifest: decodeJson(got.body) as Manifest, etag: got.etag };
}

/** GET only; does not take the write lock. */
export async function listLibraries(
  store: ObjectStore,
  prefix = "",
): Promise<Manifest["libraries"]> {
  const { manifest } = await readManifest(store, prefix);
  return manifest?.libraries ?? [];
}

async function putManifest(
  store: ObjectStore,
  prefix: string,
  manifest: Manifest,
  etag?: string,
): Promise<void> {
  await store.put(manifestKey(prefix), encodeJson(manifest), {
    contentType: "application/json",
    ...(etag ? { ifMatch: etag } : { ifNoneMatch: "*" as const }),
  });
}

export async function createLibrary(
  remote: RemoteLockTarget,
  name: string,
  options?: WithRemoteLockOptions,
): Promise<LibraryMeta> {
  const label = trimName(name);
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const at = nowIso();
      const { manifest, etag } = await readManifest(remote.store, prefix);
      const next = manifest ?? emptyManifest(remote.deviceId, at);
      const id = crypto.randomUUID();
      const meta: LibraryMeta = {
        schemaVersion: SCHEMA_VERSION,
        id,
        name: label,
        tags: [],
        createdAt: at,
        updatedAt: at,
      };
      await remote.store.put(libraryMetaKey(prefix, id), encodeJson(meta), {
        contentType: "application/json",
        ifNoneMatch: "*",
        forbidOverwrite: true,
      });
      await remote.store.put(libraryTreeKey(prefix, id), encodeJson(emptyTree()), {
        contentType: "application/json",
        ifNoneMatch: "*",
        forbidOverwrite: true,
      });
      next.libraries = [...next.libraries, { id, name: label, updatedAt: at }];
      next.updatedAt = at;
      next.updatedBy = remote.deviceId;
      await putManifest(remote.store, prefix, next, etag);
      return meta;
    },
    lockOpts(options),
  );
}

export async function renameLibrary(
  remote: RemoteLockTarget,
  libraryId: string,
  name: string,
  options?: WithRemoteLockOptions,
): Promise<LibraryMeta> {
  const label = trimName(name);
  const prefix = remote.prefix ?? "";
  return withRemoteLock(
    remote,
    "sync",
    async () => {
      const at = nowIso();
      const metaKey = libraryMetaKey(prefix, libraryId);
      const got = await remote.store.get(metaKey);
      if (!got) {
        throw new Error(`Library not found: ${libraryId}`);
      }
      const meta = decodeJson(got.body) as LibraryMeta;
      const updated: LibraryMeta = { ...meta, name: label, updatedAt: at };
      await remote.store.put(metaKey, encodeJson(updated), {
        contentType: "application/json",
        ifMatch: got.etag,
      });
      const { manifest, etag } = await readManifest(remote.store, prefix);
      const next = manifest ?? emptyManifest(remote.deviceId, at);
      next.libraries = next.libraries.map((item) =>
        item.id === libraryId ? { ...item, name: label, updatedAt: at } : item,
      );
      if (!next.libraries.some((item) => item.id === libraryId)) {
        next.libraries = [...next.libraries, { id: libraryId, name: label, updatedAt: at }];
      }
      next.updatedAt = at;
      next.updatedBy = remote.deviceId;
      await putManifest(remote.store, prefix, next, etag);
      return updated;
    },
    lockOpts(options),
  );
}
