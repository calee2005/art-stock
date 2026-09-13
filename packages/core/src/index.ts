export { SCHEMA_VERSION } from "./types.ts";
export type {
  AssetCachePolicy,
  AssetIndex,
  AssetIndexEntry,
  AssetItem,
  AssetRating,
  BranchPointer,
  DeviceId,
  EinkConfig,
  EinkSummary,
  EinkSummaryRecentFile,
  EinkSummaryTodo,
  Hlc,
  Iso8601,
  KanbanBoardLabel,
  KanbanBoardMeta,
  KanbanChecklistItem,
  KanbanIndex,
  KanbanIndexWorkspace,
  KanbanItem,
  KanbanList,
  KanbanWorkspaceMeta,
  LibraryMeta,
  LibraryTree,
  LockDocument,
  LockPurpose,
  Manifest,
  ManifestLibraryRef,
  ObjectMeta,
  ObjectType,
  OplogEntry,
  OplogOp,
  OrSet,
  OrSetDot,
  RemoteConfig,
  RemoteMode,
  ReplicaStatus,
  SchemaVersion,
  Sha256Hex,
  Snapshot,
  SnapshotPolicy,
  TreeNode,
  TreeNodeKind,
  Uuid,
} from "./types.ts";

export {
  DEFAULT_REMOTE_PREFIX,
  normalizePrefix,
} from "./prefix.ts";

export {
  PROTOCOL_DIR,
  assetIndexKey,
  assetItemMetaKey,
  assetThumbKey,
  blobKey,
  clockKey,
  defaultRemoteConfig,
  einkConfigKey,
  einkSummaryKey,
  kanbanBoardMetaKey,
  kanbanIndexKey,
  kanbanItemKey,
  kanbanItemsPrefix,
  kanbanListKey,
  kanbanListsPrefix,
  kanbanWorkspaceMetaKey,
  libraryMetaKey,
  libraryTreeKey,
  lockKey,
  manifestKey,
  objectBranchKey,
  objectBranchesPrefix,
  objectKey,
  objectMetaKey,
  objectSnapshotKey,
  objectSnapshotsPrefix,
  oplogKey,
  protocolRoot,
} from "./keys.ts";

export { StoreError, isStoreError, type StoreErrorCode } from "./store-error.ts";
export {
  MemoryObjectStore,
  type DeleteOptions,
  type HeadResult,
  type ListObject,
  type ListOptions,
  type ListResult,
  type MemoryObjectStoreOptions,
  type ObjectBody,
  type ObjectStore,
  type PutConditions,
  type PutOptions,
} from "./store.ts";

export { RemoteError, isRemoteError, type RemoteErrorCode } from "./errors.ts";
export {
  LOCK_HEARTBEAT_MS,
  LOCK_TTL_MS,
  PROBE_RELATIVE_KEY,
  probeConditionalWrites,
  readRemoteLock,
  withRemoteLock,
  type LockFnContext,
  type RemoteLockTarget,
  type WithRemoteLockOptions,
} from "./lock.ts";

export {
  createLibrary,
  listLibraries,
  readManifest,
  renameLibrary,
} from "./libraries.ts";

export {
  createBoard,
  createItem,
  createList,
  createWorkspace,
  DEFAULT_KANBAN_LIST_NAMES,
  getBoard,
  getItem,
  getList,
  listItems,
  listLists,
  listWorkspaces,
  readKanbanIndex,
  updateItem,
  moveItem,
  type CreateItemInput,
  type UpdateItemPatch,
} from "./kanban.ts";

export {
  createFolder,
  folderDepth,
  moveNode,
  readTree,
  subtreeIds,
  wouldCreateCycle,
} from "./tree.ts";

export { compareHlc, createHlcClock, formatHlcStamp, tickHlc, type HlcClock } from "./hlc.ts";
export {
  addToOrSet,
  emptyOrSet,
  mergeOrSets,
  orSetFromTags,
  removeFromOrSet,
  valuesOfOrSet,
} from "./orset.ts";
export {
  addNodeTag,
  applyTagSet,
  mergeEntityTags,
  nodesMatchingTags,
  nodesWithTag,
  removeNodeTag,
  tagSetOf,
  type TagWriteOptions,
} from "./tags.ts";
export { sha256Hex } from "./hash.ts";
export {
  enqueueImport,
  flushImportQueue,
  getObjectMeta,
  importObjectNow,
  inferObjectType,
  type ImportObjectInput,
  type ImportQueue,
  type QueuedImport,
} from "./import.ts";

export {
  cacheObjectMeta,
  cacheThumb,
  createSyncState,
  enqueueSyncImport,
  pendingCount,
  pushSync,
  setSyncPaused,
  type PushSyncResult,
  type SyncJob,
  type SyncState,
} from "./sync.ts";

export {
  CONFLICT_BRANCH_PREFIX,
  commitSnapshot,
  conflictBranchName,
  createBranch,
  deleteBranch,
  getBranch,
  isConflictBranch,
  listBranches,
  listConflictBranches,
  listSnapshots,
  rollbackBranch,
  switchDefaultBranch,
  validateBranchName,
  type CommitSnapshotOptions,
} from "./versions.ts";

export {
  DEFAULT_SNAPSHOT_POLICY,
  createAutoSnapshotController,
  createManualClock,
  type AutoSnapshotResult,
  type ClockScheduler,
} from "./auto-snapshot.ts";

export {
  DEFAULT_ASSET_CACHE_POLICY,
  PLACEHOLDER_WEBP,
  createDeviceAssetCache,
  getAssetMeta,
  hydrateAssetCache,
  importAsset,
  isWebp,
  listAssets,
  readPngSize,
  type DeviceAssetCache,
  type ImportAssetInput,
} from "./assets.ts";

export {
  LOCAL_PIN_STORAGE_KEY,
  addPin,
  fetchOriginalOnDemand,
  hasPin,
  isOriginalPinned,
  originalCacheKey,
  parsePins,
  pinEquals,
  purgeUnpinnedOriginals,
  removePin,
  serializePins,
  type LocalOriginalCache,
  type OriginalRef,
  type Pin,
  type PinScope,
} from "./pin.ts";
