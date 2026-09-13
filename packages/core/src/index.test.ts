import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_REMOTE_PREFIX,
  PROTOCOL_DIR,
  SCHEMA_VERSION,
  blobKey,
  defaultRemoteConfig,
  kanbanBoardMetaKey,
  kanbanIndexKey,
  kanbanItemKey,
  kanbanListKey,
  kanbanWorkspaceMetaKey,
  libraryMetaKey,
  libraryTreeKey,
  lockKey,
  manifestKey,
  normalizePrefix,
  objectBranchKey,
  objectKey,
  objectMetaKey,
  objectSnapshotKey,
  protocolRoot,
} from "./index.ts";
import type {
  KanbanIndex,
  LibraryMeta,
  LockDocument,
  Manifest,
  ObjectMeta,
  RemoteConfig,
} from "./index.ts";

test("SCHEMA_VERSION is 1", () => {
  assert.equal(SCHEMA_VERSION, 1);
});

test("DEFAULT_REMOTE_PREFIX is empty (bucket root)", () => {
  assert.equal(DEFAULT_REMOTE_PREFIX, "");
  assert.equal(normalizePrefix(undefined), "");
  assert.equal(normalizePrefix(null), "");
  assert.equal(normalizePrefix(""), "");
  assert.equal(normalizePrefix("   "), "");
  assert.equal(normalizePrefix("/"), "");
});

test("normalizePrefix makes non-empty values end with a single slash", () => {
  assert.equal(normalizePrefix("art"), "art/");
  assert.equal(normalizePrefix("art/"), "art/");
  assert.equal(normalizePrefix("/art/"), "art/");
  assert.equal(normalizePrefix("  art//"), "art/");
  assert.equal(normalizePrefix("home/stock"), "home/stock/");
  assert.equal(normalizePrefix("home/stock/"), "home/stock/");
});

test("defaultRemoteConfig prefix defaults to empty and is normalized", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "nas",
    endpoint: "https://minio.local",
    bucket: "art",
    accessKeyId: "AK",
    secretAccessKey: "SK",
    forcePathStyle: true,
    mode: "readwrite" as const,
  };
  const empty = defaultRemoteConfig(base);
  assert.equal(empty.prefix, "");
  const art = defaultRemoteConfig({ ...base, prefix: "art" });
  assert.equal(art.prefix, "art/");
});

test("protocol root is {prefix}.artstock/v1/ and is not stored in prefix", () => {
  assert.equal(PROTOCOL_DIR, ".artstock/v1/");
  assert.equal(protocolRoot(""), ".artstock/v1/");
  assert.equal(protocolRoot("art/"), "art/.artstock/v1/");
  assert.notEqual(DEFAULT_REMOTE_PREFIX, PROTOCOL_DIR);
  assert.notEqual(DEFAULT_REMOTE_PREFIX, ".artstock/v1");
});

test("objectKey covers empty prefix and art/", () => {
  assert.equal(objectKey("", "lock.json"), ".artstock/v1/lock.json");
  assert.equal(objectKey("art/", "lock.json"), "art/.artstock/v1/lock.json");
  assert.equal(objectKey("art", "manifest.json"), "art/.artstock/v1/manifest.json");
  assert.equal(
    objectKey("", "/blobs/abc"),
    ".artstock/v1/blobs/abc",
  );
});

test("lock and manifest keys", () => {
  assert.equal(lockKey(""), ".artstock/v1/lock.json");
  assert.equal(lockKey("art/"), "art/.artstock/v1/lock.json");
  assert.equal(manifestKey(""), ".artstock/v1/manifest.json");
  assert.equal(manifestKey("art/"), "art/.artstock/v1/manifest.json");
});

test("blob keys use lowercase sha256 under blobs/", () => {
  const sha =
    "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855";
  assert.equal(
    blobKey("", sha),
    `.artstock/v1/blobs/${sha.toLowerCase()}`,
  );
  assert.equal(
    blobKey("art/", sha),
    `art/.artstock/v1/blobs/${sha.toLowerCase()}`,
  );
});

test("object meta / branch / snapshot keys", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.equal(
    objectMetaKey("", id),
    `.artstock/v1/objects/${id}/meta.json`,
  );
  assert.equal(
    objectMetaKey("art/", id),
    `art/.artstock/v1/objects/${id}/meta.json`,
  );
  assert.equal(
    objectBranchKey("", id, "main"),
    `.artstock/v1/objects/${id}/branches/main.json`,
  );
  assert.equal(
    objectSnapshotKey("art/", id, "snap-1"),
    `art/.artstock/v1/objects/${id}/snapshots/snap-1.json`,
  );
});

test("library meta and tree keys", () => {
  const lib = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  assert.equal(
    libraryMetaKey("", lib),
    `.artstock/v1/libraries/${lib}/meta.json`,
  );
  assert.equal(
    libraryTreeKey("art/", lib),
    `art/.artstock/v1/libraries/${lib}/tree.json`,
  );
});

test("kanban index / workspace / board / list / item keys", () => {
  const ws = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const board = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const list = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const item = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  assert.equal(kanbanIndexKey(""), ".artstock/v1/kanban/index.json");
  assert.equal(kanbanIndexKey("art/"), "art/.artstock/v1/kanban/index.json");
  assert.equal(
    kanbanWorkspaceMetaKey("", ws),
    `.artstock/v1/kanban/workspaces/${ws}/meta.json`,
  );
  assert.equal(
    kanbanBoardMetaKey("art/", board),
    `art/.artstock/v1/kanban/boards/${board}/meta.json`,
  );
  assert.equal(
    kanbanListKey("", board, list),
    `.artstock/v1/kanban/boards/${board}/lists/${list}.json`,
  );
  assert.equal(
    kanbanItemKey("art/", item),
    `art/.artstock/v1/kanban/items/${item}.json`,
  );
});

test("JSON types serialize camelCase and include schemaVersion", () => {
  const lock: LockDocument = {
    schemaVersion: 1,
    fencingToken: 42,
    deviceId: "dev-1",
    deviceName: "studio-pc",
    purpose: "sync",
    acquiredAt: "2026-09-13T12:00:00.000Z",
    heartbeatAt: "2026-09-13T12:00:00.000Z",
    expiresAt: "2026-09-13T12:01:00.000Z",
  };
  const manifest: Manifest = {
    schemaVersion: 1,
    updatedAt: "2026-09-13T12:00:00.000Z",
    updatedBy: "dev-1",
    libraries: [{ id: "lib-1", name: "角色设定", updatedAt: "2026-09-13T12:00:00.000Z" }],
    assetLibrary: { id: "global", updatedAt: "2026-09-13T12:00:00.000Z" },
    kanbanIndex: "kanban/index.json",
  };
  const objectMeta: ObjectMeta = {
    schemaVersion: 1,
    id: "obj-1",
    libraryId: "lib-1",
    parentFolderId: "folder-1",
    name: "主角-立绘.clip",
    type: "artwork",
    tags: ["角色"],
    createdAt: "2026-09-13T12:00:00.000Z",
    updatedAt: "2026-09-13T12:00:00.000Z",
    defaultBranch: "main",
  };
  const library: LibraryMeta = {
    schemaVersion: 1,
    id: "lib-1",
    name: "角色设定",
    tags: [],
    createdAt: "2026-09-13T12:00:00.000Z",
    updatedAt: "2026-09-13T12:00:00.000Z",
  };
  const kanban: KanbanIndex = {
    schemaVersion: 1,
    updatedAt: "2026-09-13T12:00:00.000Z",
    workspaces: [{ id: "ws-1", name: "当前项目", boardIds: ["board-1"] }],
  };
  const remote: RemoteConfig = defaultRemoteConfig({
    id: "remote-1",
    name: "oss",
    endpoint: "https://oss.example",
    bucket: "bucket",
    accessKeyId: "AK",
    secretAccessKey: "SK",
    forcePathStyle: false,
    mode: "readonly",
  });

  for (const value of [lock, manifest, objectMeta, library, kanban, remote]) {
    const json = JSON.stringify(value);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    for (const key of Object.keys(parsed)) {
      assert.match(key, /^[a-z][A-Za-z0-9]*$/);
      assert.doesNotMatch(key, /_/);
    }
    if (value !== remote) {
      assert.equal(parsed.schemaVersion, 1);
    }
  }
  assert.equal(remote.prefix, "");
  assert.equal("fencingToken" in JSON.parse(JSON.stringify(lock)), true);
});
