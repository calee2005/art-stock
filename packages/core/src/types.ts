/** Current on-wire schema. Incompatible changes must bump this and migrate. */
export const SCHEMA_VERSION = 1 as const;
export type SchemaVersion = typeof SCHEMA_VERSION;

export type Iso8601 = string;
export type DeviceId = string;
export type Uuid = string;
export type Sha256Hex = string;

export type ReplicaStatus = "ok" | "pending" | "missing";

export type Hlc = {
  ts: number;
  c: number;
  deviceId: DeviceId;
};

export type OrSetDot = {
  value: string;
  hlc: Hlc;
};

export type OrSet = {
  adds: OrSetDot[];
  removes: OrSetDot[];
};

export type ManifestLibraryRef = {
  id: Uuid;
  name: string;
  updatedAt: Iso8601;
};

export type Manifest = {
  schemaVersion: SchemaVersion;
  updatedAt: Iso8601;
  updatedBy: DeviceId;
  libraries: ManifestLibraryRef[];
  assetLibrary: { id: string; updatedAt: Iso8601 };
  kanbanIndex: string;
};

export type ObjectType =
  | "artwork"
  | "markdown"
  | "pdf"
  | "audio"
  | "video"
  | "mindmap"
  | "database"
  | "binary"
  | "folder";

export type ObjectMeta = {
  schemaVersion: SchemaVersion;
  id: Uuid;
  libraryId: Uuid;
  parentFolderId: Uuid;
  name: string;
  type: ObjectType;
  tags: string[];
  tagSet?: OrSet;
  createdAt: Iso8601;
  updatedAt: Iso8601;
  defaultBranch: string;
  replicas?: Record<string, ReplicaStatus>;
};

export type BranchPointer = {
  name: string;
  snapshotId: Uuid;
  updatedAt: Iso8601;
  updatedBy: DeviceId;
};

export type Snapshot = {
  id: Uuid;
  parentSnapshotId: Uuid | null;
  branch: string;
  blobSha256: Sha256Hex;
  byteSize: number;
  mimeType: string;
  message: string;
  createdAt: Iso8601;
  createdBy: DeviceId;
};

/** Local snapshot policy (per object or library). Not stored on the remote. */
export type SnapshotPolicy = {
  mode: "auto-on-save" | "manual";
  minIntervalMs: number;
};

export type AssetRating = 0 | 1 | 2 | 3 | 4 | 5;

export type AssetItem = {
  schemaVersion: SchemaVersion;
  id: Uuid;
  name: string;
  folderId: Uuid | null;
  tags: string[];
  tagSet?: OrSet;
  rating: AssetRating;
  ratingHlc?: Hlc;
  width?: number;
  height?: number;
  mimeType: string;
  blobSha256: Sha256Hex;
  thumbKey: string;
  sourceObjectId?: Uuid;
  createdAt: Iso8601;
  updatedAt: Iso8601;
};

export type AssetFolder = {
  id: Uuid;
  name: string;
  parentId: Uuid | null;
  order: number;
};

export type AssetIndexEntry = {
  id: Uuid;
  name: string;
  folderId: Uuid | null;
  thumbKey: string;
};

export type AssetIndex = {
  schemaVersion: SchemaVersion;
  updatedAt: Iso8601;
  updatedBy: DeviceId;
  folders: AssetFolder[];
  items: AssetIndexEntry[];
};

/** Local cache policy. Originals stay remote unless pinned or opened. */
export type AssetCachePolicy = {
  cacheOriginals: boolean;
};

export type LockPurpose =
  | "sync"
  | "upload"
  | "replicate"
  | "eink-summary"
  | "force-unlock";

export type LockDocument = {
  schemaVersion: SchemaVersion;
  fencingToken: number;
  deviceId: DeviceId;
  deviceName: string;
  purpose: LockPurpose;
  acquiredAt: Iso8601;
  heartbeatAt: Iso8601;
  expiresAt: Iso8601;
};

export type RemoteMode = "readwrite" | "readonly";

/** Local-only remote registration. Secrets never go on S3 or into logs. */
export type RemoteConfig = {
  id: Uuid;
  name: string;
  endpoint: string;
  region?: string;
  bucket: string;
  /** Bucket-global root. Default `""`. Never store `.artstock/v1` here. */
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  mode: RemoteMode;
};

export type LibraryMeta = {
  schemaVersion: SchemaVersion;
  id: Uuid;
  name: string;
  tags: string[];
  createdAt: Iso8601;
  updatedAt: Iso8601;
};

export type TreeNodeKind = "folder" | "file";

export type TreeNode = {
  id: Uuid;
  parentId: Uuid | null;
  kind: TreeNodeKind;
  name: string;
  objectId?: Uuid;
  tags: string[];
  tagSet?: OrSet;
  updatedAt: Iso8601;
  order: number;
};

export type LibraryTree = {
  schemaVersion: SchemaVersion;
  nodes: TreeNode[];
};

export type KanbanIndexWorkspace = {
  id: Uuid;
  name: string;
  archivedAt?: Iso8601;
  boardIds: Uuid[];
};

export type KanbanIndex = {
  schemaVersion: SchemaVersion;
  updatedAt: Iso8601;
  workspaces: KanbanIndexWorkspace[];
};

export type KanbanWorkspaceMeta = {
  schemaVersion: SchemaVersion;
  id: Uuid;
  name: string;
  icon?: string;
  color?: string;
  order: number;
  archivedAt?: Iso8601;
  linkedLibraryIds?: Uuid[];
  updatedAt: Iso8601;
};

export type KanbanBoardLabel = {
  id: Uuid;
  name: string;
  color: string;
};

export type KanbanBoardMeta = {
  schemaVersion: SchemaVersion;
  id: Uuid;
  workspaceId: Uuid;
  name: string;
  background?: string;
  labels: KanbanBoardLabel[];
  defaultLibraryId?: Uuid;
  starred?: boolean;
  archivedAt?: Iso8601;
  order: number;
  updatedAt: Iso8601;
};

export type KanbanList = {
  schemaVersion: SchemaVersion;
  id: Uuid;
  boardId: Uuid;
  name: string;
  order: number;
  wipLimit?: number;
  archivedAt?: Iso8601;
  updatedAt: Iso8601;
};

export type KanbanChecklistItem = {
  id: Uuid;
  text: string;
  done: boolean;
};

export type KanbanItem = {
  schemaVersion: SchemaVersion;
  id: Uuid;
  listId: Uuid;
  title: string;
  descriptionMarkdown?: string;
  dueAt?: Iso8601;
  checklist?: KanbanChecklistItem[];
  labelIds?: Uuid[];
  coverAssetId?: Uuid;
  attachmentObjectIds?: Uuid[];
  order: number;
  archivedAt?: Iso8601;
  updatedAt: Iso8601;
};

export type EinkConfig = {
  schemaVersion: SchemaVersion;
  refreshIntervalMinutes: number;
  todo: {
    workspaceId: Uuid;
    boardId: Uuid | null;
    listNames: string[];
    maxItems: number;
  };
};

export type EinkSummaryRecentFile = {
  name: string;
  libraryName: string;
  updatedAt: Iso8601;
};

export type EinkSummaryTodo = {
  title: string;
  dueAt: Iso8601 | null;
  boardName: string;
};

export type EinkSummary = {
  schemaVersion: SchemaVersion;
  generatedAt: Iso8601;
  generatedBy: DeviceId;
  libraryCount: number;
  recentFiles: EinkSummaryRecentFile[];
  todos: EinkSummaryTodo[];
};

export type OplogOp =
  | { op: "put"; key: string; blobSha256?: Sha256Hex }
  | { op: "upsert"; entity: string; id: Uuid; fields: Record<string, unknown> }
  | { op: "add"; entity: string; target: string; value: string };

export type OplogEntry = {
  schemaVersion: SchemaVersion;
  hlc: Hlc;
  deviceId: DeviceId;
  ops: OplogOp[];
};
