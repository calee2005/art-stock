import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createFolder,
  createLibrary,
  folderDepth,
  listLibraries,
  moveNode,
  protocolRoot,
  readTree,
  renameLibrary,
  enqueueImport,
  flushImportQueue,
  importObjectNow,
  inferObjectType,
  addNodeTag,
  removeNodeTag,
  nodesMatchingTags,
  createSyncState,
  enqueueSyncImport,
  pendingCount,
  pushSync,
  setSyncPaused,
  createWorkspace,
  createBoard,
  listWorkspaces,
  listLists,
  listItems,
  createItem,
  moveItem,
  commitSnapshot,
  createBranch,
  deleteBranch,
  getObjectMeta,
  listBranches,
  listSnapshots,
  rollbackBranch,
  switchDefaultBranch,
  readBranchBytes,
  markdownToHtml,
  htmlToMarkdown,
  markdownToc,
  insertAssetEmbed,
  encodeMinimalPdf,
  extractPdfPageText,
  goToPdfPage,
  isPdfName,
  loadPdfOriginal,
  preparePdfViewer,
  writeObjectPageCount,
  type PdfViewer,
  assetThumbKey,
  importAsset,
  listAssets,
  listAssetFolders,
  createAssetFolder,
  addAssetTag,
  removeAssetTag,
  setAssetRating,
  assetsMatchingTags,
  searchAssets,
  addMindChild,
  createMindDoc,
  encodeMindDoc,
  isMindmapName,
  parseMindDoc,
  setMindNodeText,
  type MindDoc,
  type MindNode,
  addDatabaseColumn,
  addDatabaseRow,
  applyCellChoice,
  createDatabaseDoc,
  diffDatabaseCells,
  encodeDatabaseDoc,
  isDatabaseName,
  liveColumns,
  liveRows,
  loadDatabase,
  saveDatabase,
  setDatabaseCell,
  type CellConflict,
  type DatabaseDoc,
  createHlcClock,
  tickHlc,
  conflictBadgeCount,
  countUnresolvedConflicts,
  resolveConflictBranch,
  DEFAULT_EINK_CONFIG,
  refreshEinkSummary,
  writeEinkConfig,
  type EinkSummary,
  PLACEHOLDER_WEBP,
  LOCAL_PIN_STORAGE_KEY,
  WIFI_ONLY_ORIGINAL,
  addPin,
  defaultOriginalDownloadPolicy,
  fetchOriginalOnDemand,
  hasPin,
  parsePins,
  purgeUnpinnedOriginals,
  removePin,
  serializePins,
  type ImportQueue,
  type SyncState,
  type TreeNode,
  type KanbanIndexWorkspace,
  type KanbanList,
  type KanbanItem,
  type Snapshot,
  type BranchPointer,
  type AssetItem,
  type AssetFolder,
  type Pin,
  type SnapshotPolicy,
} from "@art-stock/core";
import {
  TabletShell,
  pickAppShell,
  tabletChrome,
  type NavId,
} from "@art-stock/ui";
import {
  deviceIdentity,
  emptyRemoteForm,
  formToConfig,
  getManifest,
  hasCredentials,
  listProtocolKeys,
  probeReadwrite,
  putWithGlobalLock,
  type RemoteForm,
} from "./session.ts";
import {
  activeStore,
  applyPadE2eConfig,
  importInboxToAssets,
  isAndroidPad,
  listPadInbox,
  loadInboxScanState,
  loadInboxScanStateHost,
  loadPadE2eConfig,
  loadPadScanE2eConfig,
  loadPadShareE2eConfig,
  localStorageHasSecret,
  persistRemoteForm,
  redactSecrets,
  reportPadE2e,
  reportPadSafE2e,
  reportPadScanE2e,
  reportPadShareE2e,
  restoreRemoteForm,
  runPadBrowseAndUpload,
  saveInboxScanStateHost,
  scanPadInboxNow,
  loadPadSafE2eConfig,
  tauriInvokeFn,
  waitForTauriInvoke,
} from "./pad-host.ts";
import {
  CORS_ERROR_MESSAGE,
  checkBucketCors,
  corsExampleJson,
  describeCorsFailure,
  isCorsFailure,
} from "./cors.ts";

const storage: Storage = window.localStorage;
const padHost = isAndroidPad();

function MindTree(props: {
  node: MindNode;
  depth: number;
  selectedId: string;
  onSelect: (id: string) => void;
  onRename: (id: string, text: string) => void;
}): ReactNode {
  return (
    <li style={{ marginLeft: props.depth * 16 }}>
      <button
        type="button"
        data-testid={`mind-node-${props.depth}`}
        onClick={() => props.onSelect(props.node.id)}
        onDoubleClick={() => {
          const next = window.prompt("节点文本", props.node.text);
          if (next != null) {
            props.onRename(props.node.id, next);
          }
        }}
        style={{
          fontWeight: props.selectedId === props.node.id ? 700 : 400,
          minHeight: 44,
        }}
      >
        {props.node.text}
      </button>
      {props.node.children.length > 0 ? (
        <ul>
          {props.node.children.map((child) => (
            <MindTree
              key={child.id}
              node={child}
              depth={props.depth + 1}
              selectedId={props.selectedId}
              onSelect={props.onSelect}
              onRename={props.onRename}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function App() {
  const [form, setForm] = useState<RemoteForm>(() => emptyRemoteForm());
  const [xssDismissed, setXssDismissed] = useState(
    () => sessionStorage.getItem("art-stock.xss-ok") === "1",
  );
  const [status, setStatus] = useState("未连接。空密钥不会请求任何桶。");
  const [corsBlocked, setCorsBlocked] = useState(false);
  const corsJson = useMemo(() => corsExampleJson(), []);
  const [keys, setKeys] = useState<string[]>([]);
  const [libraries, setLibraries] = useState<{ id: string; name: string }[]>([]);
  const [newLibraryName, setNewLibraryName] = useState("");
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderParentId, setFolderParentId] = useState("");
  const [movingNodeId, setMovingNodeId] = useState("");
  const [moveParentId, setMoveParentId] = useState("");
  const [importQueue, setImportQueue] = useState<ImportQueue>([]);
  const [sync, setSync] = useState<SyncState>(() => createSyncState());
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [workspaces, setWorkspaces] = useState<KanbanIndexWorkspace[]>([]);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [newBoardName, setNewBoardName] = useState("");
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [lists, setLists] = useState<KanbanList[]>([]);
  const [items, setItems] = useState<KanbanItem[]>([]);
  const [itemTitle, setItemTitle] = useState("");
  const [itemDesc, setItemDesc] = useState("");
  const [itemDue, setItemDue] = useState("");
  const [itemChecklist, setItemChecklist] = useState("");
  const [itemLabels, setItemLabels] = useState("");
  const [itemCover, setItemCover] = useState("");
  const [itemAttachments, setItemAttachments] = useState("");
  const [itemListId, setItemListId] = useState("");
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [branches, setBranches] = useState<BranchPointer[]>([]);
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [activeBranch, setActiveBranch] = useState("main");
  const [newBranchName, setNewBranchName] = useState("alt");
  const [snapshotMessage, setSnapshotMessage] = useState("commit");
  const [snapshotBody, setSnapshotBody] = useState("");
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1024 : window.innerWidth,
    height: typeof window === "undefined" ? 768 : window.innerHeight,
  }));
  const [pane, setPane] = useState<NavId>("library");
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [assetFolders, setAssetFolders] = useState<AssetFolder[]>([]);
  const [newAssetFolderName, setNewAssetFolderName] = useState("");
  const [assetFolderId, setAssetFolderId] = useState("");
  const [assetTagDraft, setAssetTagDraft] = useState("");
  const [assetTagFilter, setAssetTagFilter] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [inboxItems, setInboxItems] = useState<{ name: string; size: number; mimeGuess?: string }[]>([]);
  const [inboxScan, setInboxScan] = useState(() => loadInboxScanState(storage));
  const [safAuthorized, setSafAuthorized] = useState(false);
  const [safLabel, setSafLabel] = useState("");
  const scanPolicyRef = useRef<SnapshotPolicy | undefined>(undefined);
  const scanInboxRef = useRef<() => Promise<void>>(async () => undefined);
  const [wifiOnlyOriginals, setWifiOnlyOriginals] = useState(
    () => defaultOriginalDownloadPolicy(padHost).wifiOnly,
  );
  const [networkKind, setNetworkKind] = useState<
    "wifi" | "cellular" | "other" | "offline"
  >("wifi");
  const [mdSource, setMdSource] = useState("");
  const [mdHtml, setMdHtml] = useState("");
  const [mdEditorKey, setMdEditorKey] = useState(0);
  const [pdfViewer, setPdfViewer] = useState<PdfViewer | null>(null);
  const [pdfZoom, setPdfZoom] = useState(1);
  const [pdfSwipeX, setPdfSwipeX] = useState<number | null>(null);
  const [mindDoc, setMindDoc] = useState<MindDoc | null>(null);
  const [mindSelectedId, setMindSelectedId] = useState("");
  const [dbDoc, setDbDoc] = useState<DatabaseDoc | null>(null);
  const [dbRemote, setDbRemote] = useState<DatabaseDoc | null>(null);
  const [dbConflicts, setDbConflicts] = useState<CellConflict[]>([]);
  const [conflictCount, setConflictCount] = useState(0);
  const [keepBothName, setKeepBothName] = useState("kept");
  const [einkSummary, setEinkSummary] = useState<EinkSummary | null>(null);
  const dbClock = useMemo(() => createHlcClock("web-local"), []);
  const [pins, setPins] = useState<Pin[]>(() => {
    try {
      const raw = storage.getItem(LOCAL_PIN_STORAGE_KEY);
      return raw ? parsePins(raw) : [];
    } catch {
      return [];
    }
  });
  const [originalCache] = useState(() => new Map<string, Uint8Array>());
  const device = useMemo(
    () => deviceIdentity(storage, padHost ? "pad" : "web"),
    [],
  );
  const preview = useMemo(
    () => protocolRoot(form.prefix),
    [form.prefix],
  );
  const canWrite = form.mode === "readwrite";
  const pdfObjectUrl = useMemo(() => {
    if (!pdfViewer?.bytes) {
      return null;
    }
    return URL.createObjectURL(
      new Blob([Uint8Array.from(pdfViewer.bytes)], { type: "application/pdf" }),
    );
  }, [pdfViewer?.bytes]);

  useEffect(() => {
    return () => {
      if (pdfObjectUrl) {
        URL.revokeObjectURL(pdfObjectUrl);
      }
    };
  }, [pdfObjectUrl]);

  useEffect(() => {
    const sync = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const invoke = padHost ? await waitForTauriInvoke() : null;
      const restored = await restoreRemoteForm(storage, invoke);
      if (cancelled) {
        return;
      }
      setForm(restored);
      if (!padHost) {
        return;
      }
      try {
        const e2e = await loadPadE2eConfig(invoke);
        let current = restored;
        if (e2e && !cancelled) {
          current = applyPadE2eConfig(restored, e2e);
          setForm(current);
          await persistRemoteForm(storage, current, invoke);
          const result = await runPadBrowseAndUpload({
            store: activeStore(current),
            form: current,
            deviceId: device.deviceId,
            deviceName: "pad",
            libraryName: e2e.libraryName ?? "Pad库",
            uploadBody: "from pad",
            uploadName: e2e.uploadName,
          });
          if (cancelled) {
            return;
          }
          setLibraries(result.libraryNames.map((name, index) => ({ id: `lib-${index}`, name })));
          await refreshLibrariesFrom(current);
          const chrome = tabletChrome(window.innerWidth, window.innerHeight);
          const statusText = result.lockSeenDuringPut
            ? `Pad 已持锁上传（token ${result.fencingToken}）`
            : "Pad 上传完成但未看到锁";
          setStatus(statusText);
          await reportPadE2e(
            {
              ok: true,
              libraries: result.libraryNames,
              lockSeenDuringPut: result.lockSeenDuringPut,
              fencingToken: result.fencingToken,
              putKey: result.putKey,
              chrome,
              width: window.innerWidth,
              height: window.innerHeight,
              secretsInLocalStorage: localStorageHasSecret(storage, current.secretAccessKey),
              tabletShell: true,
            },
            invoke,
          );
        }
        if (!invoke || cancelled) {
          return;
        }
        try {
          const kind = String((await invoke("network_kind")) ?? "wifi");
          if (
            kind === "wifi" ||
            kind === "cellular" ||
            kind === "other" ||
            kind === "offline"
          ) {
            setNetworkKind(kind);
          }
        } catch {
          setNetworkKind("wifi");
        }
        const listed = await listPadInbox(invoke);
        setInboxItems(listed);
        const share = await loadPadShareE2eConfig(invoke);
        if (share?.importTo === "assets" && listed[0]) {
          const imported = await importInboxToAssets({
            invoke,
            remote: {
              store: activeStore(current),
              prefix: formToConfig(current).prefix,
              deviceId: device.deviceId,
              deviceName: "pad",
            },
            name: listed[0].name,
            mimeType: listed[0].mimeGuess,
          });
          setInboxItems(await listPadInbox(invoke));
          setStatus(`分享已导入素材库 ${imported.name}`);
          await reportPadShareE2e(
            {
              ok: true,
              inbox: listed.map((item) => item.name),
              assetId: imported.assetId,
              importedTo: "assets",
            },
            invoke,
          );
        }
        const wifiE2e = (await invoke("pad_wifi_e2e_config")) as {
          network?: string;
        } | null;
        if (wifiE2e) {
          const json = JSON.stringify(wifiE2e);
          if (json.toLowerCase().includes("secretaccesskey") || json.includes("super-secret")) {
            throw new Error("pad-wifi-e2e.json must not contain secrets");
          }
          const simulated = (wifiE2e.network ?? "cellular") as
            | "wifi"
            | "cellular"
            | "other"
            | "offline";
          let assetsListed = await listAssets(
            activeStore(current),
            formToConfig(current).prefix,
          );
          if (assetsListed.length === 0) {
            await importAsset(
              {
                store: activeStore(current),
                prefix: formToConfig(current).prefix,
                deviceId: device.deviceId,
                deviceName: "pad",
              },
              {
                name: "meta-only.png",
                bytes: PLACEHOLDER_WEBP,
                mimeType: "image/webp",
              },
            );
            assetsListed = await listAssets(
              activeStore(current),
              formToConfig(current).prefix,
            );
          }
          const first = assetsListed[0];
          if (!first) {
            throw new Error("wifi e2e needs at least one asset for metadata");
          }
          let blocked = false;
          try {
            await fetchOriginalOnDemand(
              activeStore(current),
              formToConfig(current).prefix,
              originalCache,
              {
                kind: "asset",
                id: first.id,
                blobSha256: first.blobSha256,
                folderId: first.folderId,
              },
              pins,
              { wifiOnly: true, network: simulated },
            );
          } catch (error) {
            blocked =
              error instanceof Error && error.message.includes(WIFI_ONLY_ORIGINAL);
          }
          const metadataStill = await listAssets(
            activeStore(current),
            formToConfig(current).prefix,
          );
          const payload = {
            ok: blocked && metadataStill.length > 0,
            blocked,
            network: simulated,
            metadataCount: metadataStill.length,
            wifiOnly: true,
          };
          const raw = JSON.stringify(payload);
          if (raw.toLowerCase().includes("secretaccesskey")) {
            throw new Error("pad-wifi-e2e-status must not contain secrets");
          }
          await invoke("pad_wifi_e2e_report", { status: payload });
          if (blocked) {
            setStatus("蜂窝网络下已拦截原图下载，元数据仍可浏览");
          }
        }
        const scanE2e = await loadPadScanE2eConfig(invoke);
        if (scanE2e) {
          scanPolicyRef.current = scanE2e.snapshotPolicy;
          const listedLibs = await listLibraries(
            activeStore(current),
            formToConfig(current).prefix,
          );
          const library =
            listedLibs.find((item) => item.id === scanE2e.libraryId) ??
            listedLibs.find((item) => item.name === scanE2e.libraryName) ??
            listedLibs.find((item) => item.name === (e2e?.libraryName ?? "")) ??
            listedLibs[0];
          if (!library) {
            throw new Error("scan e2e needs a library");
          }
          setSelectedLibraryId(library.id);
          setLibraries(listedLibs.map((item) => ({ id: item.id, name: item.name })));
          const previous = await loadInboxScanStateHost(storage, invoke);
          const { items, result } = await scanPadInboxNow({
            invoke,
            previous,
            remote: {
              store: activeStore(current),
              prefix: formToConfig(current).prefix,
              deviceId: device.deviceId,
              deviceName: "pad",
            },
            libraryId: library.id,
            policy: scanE2e.snapshotPolicy,
          });
          setInboxItems(items);
          setInboxScan(result.state);
          await saveInboxScanStateHost(storage, invoke, result.state);
          setStatus(
            `扫描：导入 ${result.imported.length}，快照 ${result.snapshotted.length}`,
          );
          await reportPadScanE2e(
            {
              ok: true,
              imported: result.imported.length,
              snapshotted: result.snapshotted.length,
              skippedManual: result.skippedManual.length,
              files: items.map((item) => item.name),
            },
            invoke,
          );
        }
        const safE2e = await loadPadSafE2eConfig(invoke);
        if (safE2e) {
          await invoke("saf_grant_e2e");
          const scanned = (await invoke("saf_scan")) as {
            copied?: number;
            authorized?: boolean;
          };
          await invoke("saf_revoke");
          const after = (await invoke("saf_scan")) as {
            copied?: number;
            authorized?: boolean;
          };
          await invoke("reclaim_cache");
          const constraints = (await invoke("saf_constraints")) as {
            holdsLock?: boolean;
            writesRemote?: boolean;
          };
          setSafAuthorized(Boolean(after.authorized));
          setInboxItems(await listPadInbox(invoke));
          const payload = {
            ok:
              Number(scanned.copied ?? 0) >= 1 &&
              Number(after.copied ?? 0) === 0 &&
              after.authorized === false &&
              constraints.holdsLock === false &&
              constraints.writesRemote === false,
            copied: scanned.copied ?? 0,
            copiedAfterRevoke: after.copied ?? 0,
            authorizedAfterRevoke: after.authorized === true,
            holdsLock: constraints.holdsLock === true,
            writesRemote: constraints.writesRemote === true,
            reclaimRan: true,
          };
          await reportPadSafE2e(payload, invoke);
          setStatus(
            payload.ok
              ? `SAF：拷贝 ${payload.copied} 后已撤销，后台不持锁`
              : "SAF e2e 未通过",
          );
        }
      } catch (error) {
        const message = redactSecrets(
          error instanceof Error ? error.message : String(error),
          [restored.secretAccessKey, restored.accessKeyId],
        );
        setStatus(message);
        await reportPadE2e(
          { ok: false, error: message, tabletShell: true },
          invoke,
        ).catch(() => undefined);
        await reportPadShareE2e({ ok: false, error: message }, invoke).catch(
          () => undefined,
        );
        await reportPadScanE2e({ ok: false, error: message }, invoke).catch(
          () => undefined,
        );
        await reportPadSafE2e({ ok: false, error: message }, invoke).catch(
          () => undefined,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [device.deviceId]);

  useEffect(() => {
    if (!padHost) {
      return;
    }
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void scanInboxRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [padHost]);

  function update<K extends keyof RemoteForm>(key: K, value: RemoteForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    await persistRemoteForm(storage, form);
    setStatus(
      padHost
        ? "已保存。密钥写入 Android Keystore，不进 localStorage / Git。"
        : "已保存到本机。清除站点数据会丢失密钥。",
    );
  }

  async function withCorsGuard(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (isCorsFailure(error)) {
        setCorsBlocked(true);
        setStatus(describeCorsFailure(error));
        return;
      }
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function onCheckCors() {
    if (!form.endpoint.trim() || !form.bucket.trim()) {
      setStatus("请先填写 endpoint 与 bucket，再检查 CORS。空密钥打开站点不会请求用户桶。");
      return;
    }
    const result = await checkBucketCors({
      endpoint: form.endpoint,
      bucket: form.bucket,
      forcePathStyle: form.forcePathStyle,
    });
    if (!result.ok && result.cors) {
      setCorsBlocked(true);
      setStatus(result.message);
      return;
    }
    if (!result.ok) {
      setStatus(result.message);
      return;
    }
    setCorsBlocked(false);
    setStatus("浏览器可读取该桶地址（CORS 已放行，或响应可被当前源读取）。");
  }

  async function probe() {
    if (!hasCredentials(form) && form.mode === "readwrite") {
      setStatus("缺少密钥，未向远端发请求。");
      return;
    }
    await withCorsGuard(async () => {
      if (hasCredentials(form)) {
        const cors = await checkBucketCors({
          endpoint: form.endpoint,
          bucket: form.bucket,
          forcePathStyle: form.forcePathStyle,
        });
        if (!cors.ok && cors.cors) {
          setCorsBlocked(true);
          setStatus(cors.message);
          return;
        }
      }
      const result = await probeReadwrite(activeStore(form), form.prefix);
      if (!result.ok) {
        if (result.code === "CORS") {
          setCorsBlocked(true);
          setStatus(result.message);
          return;
        }
        update("mode", "readonly");
        setStatus(`${result.message}。已改为只读，禁止当读写远端。`);
        return;
      }
      setCorsBlocked(false);
      setStatus(`探测成功，协议根 ${result.protocolRoot}`);
    });
  }

  async function listKeys() {
    const listed = await listProtocolKeys(activeStore(form), form.prefix);
    setKeys(listed);
    setStatus(`list ${listed.length} 个键`);
  }

  async function loadManifest() {
    const got = await getManifest(activeStore(form), form.prefix);
    setStatus(got ? `GET manifest etag ${got.etag}` : "manifest 不存在（404 可用）");
  }

  async function putSample() {
    if (!canWrite) {
      setStatus("只读模式：写入口已禁用");
      return;
    }
    const result = await putWithGlobalLock(
      activeStore(form),
      formToConfig(form),
      { deviceId: "web-local", deviceName: "web" },
      "web-sample.txt",
      "hello from web",
    );
    setStatus(
      result.lockSeenDuringPut
        ? `PUT 完成；持锁期间观察到 lock.json（token ${result.fencingToken}）`
        : "PUT 完成但未看到锁",
    );
    await listKeys();
  }

  async function refreshLibraries() {
    await refreshLibrariesFrom(form);
  }

  async function refreshLibrariesFrom(current: RemoteForm) {
    const listed = await listLibraries(activeStore(current), formToConfig(current).prefix);
    setLibraries(listed.map((item) => ({ id: item.id, name: item.name })));
  }

  async function onCreateLibrary() {
    if (!canWrite) {
      setStatus("只读模式：写入口已禁用");
      return;
    }
    const created = await createLibrary(
      {
        store: activeStore(form),
        prefix: formToConfig(form).prefix,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
      },
      newLibraryName,
    );
    setNewLibraryName("");
    setStatus(`已创建资料库 ${created.name}`);
    await refreshLibraries();
  }

  async function onRenameLibrary(id: string, name: string) {
    if (!canWrite) {
      setStatus("只读模式：写入口已禁用");
      return;
    }
    const updated = await renameLibrary(
      {
        store: activeStore(form),
        prefix: formToConfig(form).prefix,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
      },
      id,
      name,
    );
    setStatus(`已重命名为 ${updated.name}`);
    await refreshLibraries();
  }

  function persistPins(next: Pin[]) {
    setPins(next);
    storage.setItem(LOCAL_PIN_STORAGE_KEY, serializePins(next));
  }

  function lockTarget() {
    return {
      store: activeStore(form),
      prefix: formToConfig(form).prefix,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
    };
  }

  async function onWriteEink() {
    if (!canWrite) {
      setStatus("只读模式：写入口已禁用");
      return;
    }
    try {
      const config = {
        ...DEFAULT_EINK_CONFIG,
        todo: {
          ...DEFAULT_EINK_CONFIG.todo,
          workspaceId: selectedWorkspaceId || "",
          boardId: selectedBoardId || null,
        },
      };
      await writeEinkConfig(lockTarget(), config);
      const summary = await refreshEinkSummary(lockTarget(), config);
      setEinkSummary(summary);
      setStatus(
        `已持锁写入 eink config/summary（${summary.libraryCount} 库，${summary.todos.length} 待办，无密钥）`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "写入 eink 失败");
    }
  }

  async function refreshTree(libraryId: string) {
    const current = await readTree(
      activeStore(form),
      formToConfig(form).prefix,
      libraryId,
    );
    setTreeNodes(current?.tree.nodes ?? []);
    const ids = (current?.tree.nodes ?? [])
      .map((node) => node.objectId)
      .filter((id): id is string => Boolean(id));
    const n = await countUnresolvedConflicts(
      activeStore(form),
      formToConfig(form).prefix,
      ids,
      0,
    );
    setConflictCount(n);
  }

  async function onCreateFolder() {
    if (!canWrite || !selectedLibraryId) {
      setStatus("请先选择资料库");
      return;
    }
    const parent = folderParentId === "" ? null : folderParentId;
    const created = await createFolder(
      lockTarget(),
      selectedLibraryId,
      parent,
      newFolderName,
    );
    setNewFolderName("");
    setStatus(`已创建文件夹 ${created.name}`);
    await refreshTree(selectedLibraryId);
  }

  async function onMoveFolder() {
    if (!canWrite || !selectedLibraryId || !movingNodeId) {
      return;
    }
    const parent = moveParentId === "" ? null : moveParentId;
    try {
      const moved = await moveNode(
        lockTarget(),
        selectedLibraryId,
        movingNodeId,
        parent,
      );
      setStatus(`已移动 ${moved.name}`);
      await refreshTree(selectedLibraryId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "移动失败");
    }
  }

  async function onPickFile(file: File) {
    if (!selectedLibraryId) {
      setStatus("请先打开资料库");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parent = folderParentId === "" ? null : folderParentId;
    const job = {
      libraryId: selectedLibraryId,
      parentFolderId: parent,
      name: file.name,
      bytes,
      type: inferObjectType(file.name, file.type),
      mimeType: file.type || "application/octet-stream",
    };
    if (!canWrite || sync.paused) {
      setImportQueue((current) => {
        const next = [...current];
        enqueueImport(next, job);
        return next;
      });
      setSync((current) => {
        const next = { ...current, queue: [...current.queue] };
        enqueueSyncImport(next, job);
        return next;
      });
      setStatus(`已入队离线导入 ${file.name}（待提交 ${pendingCount(sync) + 1}）`);
      return;
    }
    try {
      await importObjectNow(lockTarget(), job);
      setStatus(`已导入 ${file.name}`);
      await refreshTree(selectedLibraryId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败");
    }
  }

  async function onFlushQueue() {
    if (!canWrite) {
      setStatus("只读模式：写入口已禁用");
      return;
    }
    const pending = [...importQueue];
    setImportQueue([]);
    try {
      await flushImportQueue(lockTarget(), pending);
      setStatus(`已提交 ${pending.length} 个离线导入`);
      if (selectedLibraryId) {
        await refreshTree(selectedLibraryId);
      }
    } catch (error) {
      setImportQueue((current) => [...pending, ...current]);
      setStatus(error instanceof Error ? error.message : "提交队列失败");
    }
  }

  async function onPushSync() {
    if (!canWrite) {
      setStatus("只读模式：写入口已禁用");
      return;
    }
    const snapshot = sync;
    const result = await pushSync(lockTarget(), snapshot);
    setSync({ ...snapshot, queue: [...snapshot.queue] });
    if (result.status === "paused") {
      setStatus(`同步已暂停，待提交 ${result.pending}`);
      return;
    }
    if (result.status === "lock-held") {
      const seconds = Math.ceil(result.ttlMs / 1000);
      setStatus(
        `锁占用：${result.deviceName}，剩余约 ${seconds}s，待提交 ${result.pending}，未盲写`,
      );
      return;
    }
    setStatus(`已同步 ${result.flushed} 项，待提交 ${result.pending}`);
    if (selectedLibraryId) {
      await refreshTree(selectedLibraryId);
    }
  }

  async function onAddTag() {
    if (!canWrite || !selectedLibraryId || !selectedNodeId) {
      setStatus("请先选择节点");
      return;
    }
    const tag = tagDraft.trim();
    if (!tag) {
      return;
    }
    try {
      await addNodeTag(lockTarget(), selectedLibraryId, selectedNodeId, tag);
      setTagDraft("");
      setStatus(`已打标签 ${tag}`);
      await refreshTree(selectedLibraryId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "打标签失败");
    }
  }

  async function onRemoveTag(tag: string) {
    if (!canWrite || !selectedLibraryId || !selectedNodeId) {
      return;
    }
    try {
      await removeNodeTag(lockTarget(), selectedLibraryId, selectedNodeId, tag);
      setStatus(`已移除标签 ${tag}`);
      await refreshTree(selectedLibraryId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "移除标签失败");
    }
  }

  async function refreshSnapshots(objectId: string) {
    const prefix = formToConfig(form).prefix;
    const store = activeStore(form);
    const [listed, branchList, meta] = await Promise.all([
      listSnapshots(store, prefix, objectId),
      listBranches(store, prefix, objectId),
      getObjectMeta(lockTarget(), objectId),
    ]);
    setSnapshots(listed);
    setBranches(branchList);
    const nextDefault = meta?.defaultBranch ?? "main";
    setDefaultBranch(nextDefault);
    setActiveBranch((current) =>
      branchList.some((item) => item.name === current) ? current : nextDefault,
    );
    const n = await countUnresolvedConflicts(
      store,
      prefix,
      treeNodes.map((node) => node.objectId).filter((id): id is string => Boolean(id)),
      0,
    );
    setConflictCount(n);
  }

  async function loadMarkdown(objectId: string) {
    const prefix = formToConfig(form).prefix;
    const store = activeStore(form);
    const doc = await readBranchBytes(store, prefix, objectId);
    if (!doc) {
      setMdSource("");
      setMdHtml("");
      return;
    }
    const text = new TextDecoder().decode(doc.bytes);
    const thumbs: Record<string, string> = {};
    for (const asset of await listAssets(store, prefix)) {
      const thumb = await store.get(assetThumbKey(prefix, asset.id));
      if (thumb) {
        thumbs[asset.id] = URL.createObjectURL(
          new Blob([Uint8Array.from(thumb.body)], { type: "image/webp" }),
        );
      }
    }
    setMdSource(text);
    setMdHtml(markdownToHtml(text, (id) => thumbs[id] ?? null));
    setMdEditorKey((value) => value + 1);
  }

  async function loadPdfPlaceholder(objectId: string) {
    const prefix = formToConfig(form).prefix;
    const store = activeStore(form);
    const viewer = await preparePdfViewer(store, prefix, objectId);
    setPdfViewer(viewer);
    setPdfZoom(1);
  }

  async function onOpenPdf() {
    if (!pdfViewer || pdfViewer.bytes) {
      return;
    }
    const prefix = formToConfig(form).prefix;
    const store = activeStore(form);
    try {
      const opened = await loadPdfOriginal(store, prefix, pdfViewer);
      setPdfViewer(opened);
      setStatus(
        `已按需拉取 PDF（${opened.pageCount ?? "?"} 页），查看本身不写远端`,
      );
      if (
        canWrite &&
        opened.pageCount &&
        opened.pageCount !== pdfViewer.pageCount
      ) {
        await writeObjectPageCount(
          lockTarget(),
          opened.objectId,
          opened.pageCount,
        );
        setStatus(`已缓存 pageCount=${opened.pageCount}（持锁 LWW）`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "打开 PDF 失败");
    }
  }

  function onPdfPage(page: number) {
    if (!pdfViewer) {
      return;
    }
    setPdfViewer(goToPdfPage(pdfViewer, page));
  }

  async function loadMindmap(objectId: string) {
    const prefix = formToConfig(form).prefix;
    const store = activeStore(form);
    const doc = await readBranchBytes(store, prefix, objectId);
    if (!doc) {
      setMindDoc(null);
      return;
    }
    try {
      const parsed = parseMindDoc(doc.bytes);
      setMindDoc(parsed);
      setMindSelectedId(parsed.root.id);
    } catch (error) {
      setMindDoc(null);
      setStatus(error instanceof Error ? error.message : "导图 JSON 无效");
    }
  }

  async function loadDatabaseFile(objectId: string) {
    const prefix = formToConfig(form).prefix;
    const store = activeStore(form);
    try {
      const parsed = await loadDatabase(store, prefix, objectId);
      setDbDoc(parsed);
      setDbRemote(parsed);
      setDbConflicts([]);
    } catch (error) {
      setDbDoc(null);
      setStatus(error instanceof Error ? error.message : "数据表 JSON 无效");
    }
  }

  function clearVersionUi() {
    setSnapshots([]);
    setBranches([]);
    setDefaultBranch("main");
    setActiveBranch("main");
    setMdSource("");
    setMdHtml("");
    setPdfViewer(null);
    setPdfZoom(1);
    setMindDoc(null);
    setMindSelectedId("");
    setDbDoc(null);
    setDbRemote(null);
    setDbConflicts([]);
  }

  async function onCommitSnapshot() {
    const node = treeNodes.find((item) => item.id === selectedNodeId);
    if (!canWrite || !node?.objectId) {
      setStatus("请选择文件节点");
      return;
    }
    const bytes = new TextEncoder().encode(snapshotBody || `snap-${Date.now()}`);
    const snap = await commitSnapshot(
      lockTarget(),
      node.objectId,
      bytes,
      snapshotMessage,
      activeBranch,
    );
    setStatus(`已在 ${activeBranch} 提交快照 ${snap.id.slice(0, 8)}`);
    await refreshSnapshots(node.objectId);
  }

  async function onCreateBranch() {
    const node = treeNodes.find((item) => item.id === selectedNodeId);
    if (!canWrite || !node?.objectId) {
      setStatus("请选择文件节点");
      return;
    }
    try {
      const created = await createBranch(
        lockTarget(),
        node.objectId,
        newBranchName,
        activeBranch,
      );
      setStatus(
        `已从 ${activeBranch} 的当前快照建命名分支 ${created.name}（非 Git）`,
      );
      setActiveBranch(created.name);
      await refreshSnapshots(node.objectId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "建分支失败");
    }
  }

  async function onSimulateFork() {
    const node = treeNodes.find((item) => item.id === selectedNodeId);
    const current = branches.find((item) => item.name === activeBranch);
    if (!canWrite || !node?.objectId || !current) {
      setStatus("请选择文件节点");
      return;
    }
    const parentId = current.snapshotId;
    await commitSnapshot(
      lockTarget(),
      node.objectId,
      new TextEncoder().encode(`remote-${Date.now()}`),
      "remote-side",
      activeBranch,
    );
    await commitSnapshot(
      lockTarget(),
      node.objectId,
      new TextEncoder().encode(`local-${Date.now()}`),
      "local-side",
      activeBranch,
      { expectedParentSnapshotId: parentId },
    );
    setStatus("已构造离线分叉，冲突分支未丢 snapshot");
    await refreshSnapshots(node.objectId);
    if (selectedLibraryId) {
      await refreshTree(selectedLibraryId);
    }
  }

  async function onResolveConflict(
    name: string,
    action: "adopt-remote" | "adopt-local" | "keep-both",
  ) {
    const node = treeNodes.find((item) => item.id === selectedNodeId);
    if (!canWrite || !node?.objectId) {
      return;
    }
    try {
      await resolveConflictBranch(lockTarget(), node.objectId, name, action, {
        keepAs: keepBothName,
      });
      setStatus(
        action === "adopt-remote"
          ? "已采用远端，冲突分支已归档删除"
          : action === "adopt-local"
            ? "已采用本地，main 指向冲突快照"
            : `已保留双方为 ${keepBothName}`,
      );
      await refreshSnapshots(node.objectId);
      if (selectedLibraryId) {
        await refreshTree(selectedLibraryId);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "处理冲突失败");
    }
  }

  async function onSwitchDefaultBranch(name: string) {
    const node = treeNodes.find((item) => item.id === selectedNodeId);
    if (!canWrite || !node?.objectId) {
      return;
    }
    try {
      await switchDefaultBranch(lockTarget(), node.objectId, name);
      setActiveBranch(name);
      setStatus(`默认分支已切换为 ${name}`);
      await refreshSnapshots(node.objectId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "切换分支失败");
    }
  }

  async function onDeleteBranch(name: string) {
    const node = treeNodes.find((item) => item.id === selectedNodeId);
    if (!canWrite || !node?.objectId) {
      return;
    }
    try {
      await deleteBranch(lockTarget(), node.objectId, name);
      setStatus(`已删除命名分支 ${name}`);
      await refreshSnapshots(node.objectId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "删除分支失败");
    }
  }

  async function onRollback(snapshotId: string) {
    const node = treeNodes.find((item) => item.id === selectedNodeId);
    if (!canWrite || !node?.objectId) {
      return;
    }
    await rollbackBranch(lockTarget(), node.objectId, snapshotId, activeBranch);
    setStatus(`已回滚 ${activeBranch} 指针到 ${snapshotId.slice(0, 8)}，历史未删`);
    await refreshSnapshots(node.objectId);
  }

  async function refreshAssets() {
    const prefix = formToConfig(form).prefix;
    const store = activeStore(form);
    const [listed, folders] = await Promise.all([
      listAssets(store, prefix),
      listAssetFolders(store, prefix),
    ]);
    setAssets(listed);
    setAssetFolders(folders);
  }

  async function encodeWebpThumb(file: File): Promise<Uint8Array> {
    if (typeof createImageBitmap !== "function") {
      return PLACEHOLDER_WEBP.slice();
    }
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      const max = 256;
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height, 1));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return PLACEHOLDER_WEBP.slice();
      }
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", 0.8),
      );
      if (!blob) {
        return PLACEHOLDER_WEBP.slice();
      }
      return new Uint8Array(await blob.arrayBuffer());
    } catch {
      return PLACEHOLDER_WEBP.slice();
    }
  }

  async function onPickAsset(file: File) {
    if (!canWrite) {
      setStatus("只读模式：写入口已禁用");
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const thumbBytes = file.type.startsWith("image/")
        ? await encodeWebpThumb(file)
        : PLACEHOLDER_WEBP.slice();
      const created = await importAsset(lockTarget(), {
        name: file.name,
        bytes,
        mimeType: file.type || "application/octet-stream",
        folderId: assetFolderId || null,
        thumbBytes,
      });
      setStatus(`已导入素材 ${created.name}（原图在 blobs，本机默认只缓存缩略图）`);
      await refreshAssets();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "素材导入失败");
    }
  }

  async function onRefreshInbox() {
    const invoke = tauriInvokeFn();
    if (!invoke) {
      setStatus("收件箱仅 Pad 可用");
      return;
    }
    try {
      const scanned = (await invoke("saf_scan")) as { authorized?: boolean; copied?: number };
      setSafAuthorized(Boolean(scanned.authorized));
    } catch {
      // SAF optional
    }
    const itemsListed = await listPadInbox(invoke);
    setInboxItems(itemsListed);
    const previous = await loadInboxScanStateHost(storage, invoke);
    const libraryId = selectedLibraryId ?? previous.libraryId;
    if (!canWrite || !libraryId) {
      setStatus(`收件箱 ${itemsListed.length} 项`);
      return;
    }
    try {
      const { items, result } = await scanPadInboxNow({
        invoke,
        previous,
        remote: lockTarget(),
        libraryId,
        policy: scanPolicyRef.current,
      });
      setInboxItems(items);
      setInboxScan(result.state);
      await saveInboxScanStateHost(storage, invoke, result.state);
      setStatus(
        `扫描：导入 ${result.imported.length}，快照 ${result.snapshotted.length}`,
      );
      await refreshTree(libraryId);
      const scanE2e = await loadPadScanE2eConfig(invoke);
      if (scanE2e) {
        await reportPadScanE2e(
          {
            ok: true,
            imported: result.imported.length,
            snapshotted: result.snapshotted.length,
            skippedManual: result.skippedManual.length,
            files: items.map((item) => item.name),
          },
          invoke,
        );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "收件箱扫描失败");
    }
  }

  async function onImportInbox(name: string) {
    if (!canWrite) {
      setStatus("只读模式：写入口已禁用");
      return;
    }
    const invoke = tauriInvokeFn();
    if (!invoke) {
      setStatus("收件箱仅 Pad 可用");
      return;
    }
    try {
      const item = inboxItems.find((entry) => entry.name === name);
      const imported = await importInboxToAssets({
        invoke,
        remote: lockTarget(),
        name,
        mimeType: item?.mimeGuess,
      });
      setInboxItems(await listPadInbox(invoke));
      setStatus(`分享已导入素材库 ${imported.name}`);
      await refreshAssets();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "收件箱导入失败");
    }
  }

  scanInboxRef.current = onRefreshInbox;

  async function onCreateAssetFolder() {
    if (!canWrite) {
      return;
    }
    try {
      const created = await createAssetFolder(lockTarget(), newAssetFolderName);
      setNewAssetFolderName("");
      setAssetFolderId(created.id);
      setStatus(`已创建素材文件夹 ${created.name}`);
      await refreshAssets();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "创建素材文件夹失败");
    }
  }

  async function refreshKanban() {
    const listed = await listWorkspaces(activeStore(form), formToConfig(form).prefix);
    setWorkspaces(listed);
  }

  async function onCreateWorkspace() {
    if (!canWrite) {
      setStatus("只读模式：写入口已禁用");
      return;
    }
    const created = await createWorkspace(lockTarget(), newWorkspaceName);
    setNewWorkspaceName("");
    setSelectedWorkspaceId(created.id);
    setStatus(`已创建 Workspace ${created.name}`);
    await refreshKanban();
  }

  async function onCreateBoard() {
    if (!canWrite || !selectedWorkspaceId) {
      setStatus("请先选择 Workspace");
      return;
    }
    const created = await createBoard(lockTarget(), selectedWorkspaceId, newBoardName);
    setNewBoardName("");
    setStatus(`已创建 Board ${created.name}`);
    await refreshKanban();
    await openBoard(created.id);
  }

  async function openBoard(boardId: string) {
    setSelectedBoardId(boardId);
    const prefix = formToConfig(form).prefix;
    const store = activeStore(form);
    const nextLists = await listLists(store, prefix, boardId);
    setLists(nextLists);
    setItemListId(nextLists[0]?.id ?? "");
    const listIds = new Set(nextLists.map((list) => list.id));
    const nextItems = await listItems(store, prefix);
    setItems(nextItems.filter((item) => listIds.has(item.listId)));
  }

  async function onCreateItem() {
    if (!canWrite || !selectedBoardId || !itemListId) {
      setStatus("请先打开 Board 并选择 List");
      return;
    }
    const created = await createItem(lockTarget(), {
      boardId: selectedBoardId,
      listId: itemListId,
      title: itemTitle,
      descriptionMarkdown: itemDesc.trim() || undefined,
      dueAt: itemDue.trim() || undefined,
      checklist: itemChecklist
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((text) => ({ id: crypto.randomUUID(), text, done: false })),
      labelIds: itemLabels
        .split(/[,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
      coverAssetId: itemCover.trim() || undefined,
      attachmentObjectIds: itemAttachments
        .split(/[,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    });
    setItemTitle("");
    setStatus(`已创建 Item ${created.title}`);
    await openBoard(selectedBoardId);
  }

  async function onDropItem(listId: string, itemId: string) {
    if (!canWrite || !selectedBoardId) {
      return;
    }
    await moveItem(lockTarget(), itemId, listId);
    setStatus(`已移动卡片到另一列`);
    await openBoard(selectedBoardId);
  }

  const page = (
    <div
      data-testid={padHost ? "pad-root" : "app-root"}
      style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}
    >
      <h1 id="pane-remote">Art Stock Web</h1>
      <p role="status" style={{ background: "#eef2ff", padding: "0.5rem 0.75rem" }}>
        状态栏：待提交 {pendingCount(sync)}
        {sync.paused ? " · 已暂停" : " · 同步开启"}
      </p>
      <p>
        <label>
          <input
            type="checkbox"
            checked={sync.paused}
            onChange={(e) => {
              const paused = e.target.checked;
              setSyncPaused(sync, paused);
              setSync({ ...sync, paused, queue: [...sync.queue] });
            }}
          />
          暂停同步
        </label>
        <button type="button" onClick={() => void onPushSync()} disabled={!canWrite}>
          提交同步队列
        </button>
      </p>
      {!xssDismissed ? (
        <p role="alert" style={{ background: "#fff3cd", padding: "0.75rem" }}>
          密钥保存在浏览器本地。XSS 或不可信扩展可窃取密钥。优先使用短期密钥。
          <button
            type="button"
            onClick={() => {
              sessionStorage.setItem("art-stock.xss-ok", "1");
              setXssDismissed(true);
            }}
          >
            本会话不再提示
          </button>
        </p>
      ) : null}
      <p>
        桶内目录（可空）。Art Stock 使用 <code>{preview}</code>，不会占用该目录下其它文件。
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label>
          名称
          <input value={form.name} onChange={(e) => update("name", e.target.value)} />
        </label>
        <label>
          endpoint
          <input
            data-testid="pad-endpoint"
            value={form.endpoint}
            onChange={(e) => update("endpoint", e.target.value)}
          />
        </label>
        <label>
          bucket
          <input value={form.bucket} onChange={(e) => update("bucket", e.target.value)} />
        </label>
        <label>
          accessKeyId
          <input value={form.accessKeyId} onChange={(e) => update("accessKeyId", e.target.value)} autoComplete="off" />
        </label>
        <label>
          secretAccessKey
          <input
            type="password"
            value={form.secretAccessKey}
            onChange={(e) => update("secretAccessKey", e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          prefix
          <input value={form.prefix} onChange={(e) => update("prefix", e.target.value)} placeholder="可空，如 art/" />
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.forcePathStyle}
            onChange={(e) => update("forcePathStyle", e.target.checked)}
          />
          path-style（NAS/MinIO 通常勾选）
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.mode === "readonly"}
            onChange={(e) => update("mode", e.target.checked ? "readonly" : "readwrite")}
          />
          只读
        </label>
        <button type="submit" data-testid="pad-save-oss">
          保存
        </button>
      </form>
      <p>
        <a href="https://github.com/calee2005/art-stock/blob/master/docs/02-storage-protocol.md">
          CORS 需放行 If-Match / If-None-Match / x-oss-forbid-overwrite
        </a>
      </p>
      {corsBlocked ? (
        <div
          data-testid="cors-error"
          role="alert"
          style={{ background: "#fef2f2", padding: "0.75rem", marginBottom: "0.75rem" }}
        >
          <p>{CORS_ERROR_MESSAGE}</p>
        </div>
      ) : null}
      <details open={corsBlocked} data-testid="cors-help">
        <summary>
          GitHub Pages CORS 示例（含锁条件头 If-Match / If-None-Match / x-oss-forbid-overwrite）
        </summary>
        <pre data-testid="cors-json" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
          {corsJson}
        </pre>
        <p>
          <a href="./cors-oss.example.json">下载 cors-oss.example.json</a>
        </p>
      </details>
      <p>
        <button type="button" onClick={() => void probe()}>
          探测条件写
        </button>
        <button type="button" data-testid="cors-check" onClick={() => void onCheckCors()}>
          检查 CORS
        </button>
        <button type="button" onClick={() => void listKeys()}>
          List
        </button>
        <button type="button" onClick={() => void loadManifest()}>
          GET manifest
        </button>
        <button type="button" onClick={() => void putSample()} disabled={!canWrite}>
          受控 PUT
        </button>
      </p>
      <p data-testid="pad-status">
        {status}{" "}
        <span data-testid="conflict-badge">
          冲突 {conflictBadgeCount(conflictCount, 0)}
        </span>
      </p>
      <ul>
        {keys.map((key) => (
          <li key={key}>{key}</li>
        ))}
      </ul>
      <h2 id="pane-library">资料库</h2>
      <p>
        <button type="button" onClick={() => void refreshLibraries()}>
          刷新列表
        </button>
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onCreateLibrary();
        }}
      >
        <label>
          新资料库名称
          <input
            data-testid="pad-library-name"
            value={newLibraryName}
            onChange={(e) => setNewLibraryName(e.target.value)}
            placeholder="例如 角色设定"
          />
        </label>
        <button type="submit" data-testid="pad-create-library" disabled={!canWrite}>
          创建
        </button>
      </form>
      <ul data-testid="pad-libraries">
        {libraries.map((lib) => (
          <li key={lib.id}>
            <input
              aria-label={`rename-${lib.id}`}
              defaultValue={lib.name}
              disabled={!canWrite}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== lib.name) {
                  void onRenameLibrary(lib.id, next);
                }
              }}
            />
            <code>{lib.id}</code>
            <button
              type="button"
              onClick={() => {
                setSelectedLibraryId(lib.id);
                void refreshTree(lib.id);
              }}
            >
              打开
            </button>
            <button
              type="button"
              onClick={() => {
                const pin = { scope: "library" as const, id: lib.id };
                persistPins(
                  hasPin(pins, pin) ? removePin(pins, pin) : addPin(pins, pin),
                );
                setStatus(
                  hasPin(pins, pin)
                    ? `已取消钉选资料库 ${lib.name}（仅本机）`
                    : `已钉选资料库 ${lib.name}（不上 S3）`,
                );
              }}
            >
              {hasPin(pins, { scope: "library", id: lib.id }) ? "取消钉选" : "钉选"}
            </button>
          </li>
        ))}
      </ul>
      {selectedLibraryId ? (
        <section>
          <h2>文件夹树</h2>
          <p>当前库 {selectedLibraryId}</p>
          <ul>
            {nodesMatchingTags(
              treeNodes,
              tagFilter
                .split(/[,，\s]+/)
                .map((item) => item.trim())
                .filter(Boolean),
            )
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((node) => (
                <li key={node.id} style={{ marginLeft: (folderDepth(treeNodes, node.id) - 1) * 16 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedNodeId(node.id);
                      if (node.objectId) {
                        void refreshSnapshots(node.objectId);
                        if (/\.(md|markdown)$/i.test(node.name)) {
                          setPdfViewer(null);
                          setMindDoc(null);
                          setDbDoc(null);
                          void loadMarkdown(node.objectId);
                        } else if (isPdfName(node.name)) {
                          setMdSource("");
                          setMdHtml("");
                          setMindDoc(null);
                          setDbDoc(null);
                          void loadPdfPlaceholder(node.objectId);
                        } else if (isMindmapName(node.name)) {
                          setMdSource("");
                          setMdHtml("");
                          setPdfViewer(null);
                          setDbDoc(null);
                          void loadMindmap(node.objectId);
                        } else if (isDatabaseName(node.name)) {
                          setMdSource("");
                          setMdHtml("");
                          setPdfViewer(null);
                          setMindDoc(null);
                          void loadDatabaseFile(node.objectId);
                        } else {
                          setMdSource("");
                          setMdHtml("");
                          setPdfViewer(null);
                          setMindDoc(null);
                          setDbDoc(null);
                        }
                      } else {
                        clearVersionUi();
                      }
                    }}
                    style={{
                      fontWeight: selectedNodeId === node.id ? 700 : 400,
                    }}
                  >
                    {node.kind === "file" ? "文件" : "文件夹"} {node.name}
                  </button>{" "}
                  <code>{node.id.slice(0, 8)}</code>
                  {node.tags.length > 0 ? ` [${node.tags.join(", ")}]` : ""}
                </li>
              ))}
          </ul>
          <p>
            <label>
              按标签筛选
              <input
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                placeholder="多个标签为空格分隔，需同时具备"
              />
            </label>
          </p>
          <p>
            <label>
              给选中节点打标签
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                placeholder="例如 角色"
              />
            </label>
            <button type="button" onClick={() => void onAddTag()} disabled={!canWrite}>
              打标签
            </button>
          </p>
          {selectedNodeId ? (
            <p>
              当前标签{" "}
              {treeNodes
                .find((node) => node.id === selectedNodeId)
                ?.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => void onRemoveTag(tag)}
                    disabled={!canWrite}
                  >
                    {tag} ×
                  </button>
                ))}
            </p>
          ) : null}
          {treeNodes.find((node) => node.id === selectedNodeId)?.objectId ? (
            <section>
              <h3>命名分支（快照指针，不是 Git）</h3>
              <p>
                默认 <code>{defaultBranch}</code>；提交/回滚目标{" "}
                <select
                  value={activeBranch}
                  onChange={(e) => setActiveBranch(e.target.value)}
                >
                  {branches.map((branch) => (
                    <option key={branch.name} value={branch.name}>
                      {branch.name} → {branch.snapshotId.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </p>
              <ul>
                {branches.map((branch) => (
                  <li key={branch.name}>
                    {branch.name} <code>{branch.snapshotId.slice(0, 8)}</code>
                    <button
                      type="button"
                      disabled={!canWrite}
                      onClick={() => void onSwitchDefaultBranch(branch.name)}
                    >
                      设为默认
                    </button>
                    {branch.name !== "main" ? (
                      <button
                        type="button"
                        disabled={!canWrite}
                        onClick={() => void onDeleteBranch(branch.name)}
                      >
                        删除
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <label>
                新分支名
                <input
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="alt"
                />
              </label>
              <button type="button" onClick={() => void onCreateBranch()} disabled={!canWrite}>
                从当前快照建分支
              </button>
              <h3>冲突</h3>
              <p>
                徽章 {conflictCount}。处理写操作走锁，未处理不丢 snapshot。
              </p>
              <button
                type="button"
                data-testid="simulate-fork"
                disabled={!canWrite}
                onClick={() => void onSimulateFork()}
              >
                模拟离线分叉
              </button>
              <label>
                保留双方名称
                <input
                  data-testid="keep-both-name"
                  value={keepBothName}
                  onChange={(e) => setKeepBothName(e.target.value)}
                />
              </label>
              <ul data-testid="conflict-list">
                {branches
                  .filter((branch) => branch.name.startsWith("conflict/"))
                  .map((branch) => (
                    <li key={branch.name}>
                      {branch.name} <code>{branch.snapshotId.slice(0, 8)}</code>
                      <button
                        type="button"
                        data-testid="conflict-adopt-remote"
                        disabled={!canWrite}
                        onClick={() =>
                          void onResolveConflict(branch.name, "adopt-remote")
                        }
                      >
                        采用远端
                      </button>
                      <button
                        type="button"
                        data-testid="conflict-adopt-local"
                        disabled={!canWrite}
                        onClick={() =>
                          void onResolveConflict(branch.name, "adopt-local")
                        }
                      >
                        采用本地
                      </button>
                      <button
                        type="button"
                        data-testid="conflict-keep-both"
                        disabled={!canWrite}
                        onClick={() =>
                          void onResolveConflict(branch.name, "keep-both")
                        }
                      >
                        保留双方
                      </button>
                    </li>
                  ))}
              </ul>
              <h3>快照</h3>
              <label>
                message
                <input
                  value={snapshotMessage}
                  onChange={(e) => setSnapshotMessage(e.target.value)}
                />
              </label>
              <label>
                新内容
                <input
                  value={snapshotBody}
                  onChange={(e) => setSnapshotBody(e.target.value)}
                  placeholder="写入新 blob 文本"
                />
              </label>
              <button type="button" onClick={() => void onCommitSnapshot()} disabled={!canWrite}>
                提交快照
              </button>
              <ul>
                {snapshots.map((snap) => (
                  <li key={snap.id}>
                    [{snap.branch}] {snap.message} <code>{snap.id.slice(0, 8)}</code>
                    <button
                      type="button"
                      disabled={!canWrite}
                      onClick={() => void onRollback(snap.id)}
                    >
                      回滚到此
                    </button>
                  </li>
                ))}
              </ul>
              {/\.(md|markdown)$/i.test(
                treeNodes.find((node) => node.id === selectedNodeId)?.name ?? "",
              ) ? (
                <div>
                  <h3>Markdown</h3>
                  <nav aria-label="文稿目录">
                    {markdownToc(mdSource).map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() =>
                          document.getElementById(entry.id)?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          })
                        }
                      >
                        {entry.text}
                      </button>
                    ))}
                  </nav>
                  <div
                    key={mdEditorKey}
                    contentEditable
                    suppressContentEditableWarning
                    dangerouslySetInnerHTML={{ __html: mdHtml }}
                    onBlur={(event) => {
                      const next = htmlToMarkdown(event.currentTarget.innerHTML);
                      setMdSource(next);
                    }}
                    style={{
                      minHeight: 120,
                      border: "1px solid #ccc",
                      padding: 8,
                    }}
                  />
                  <p>
                    插入素材
                    <select
                      defaultValue=""
                      onChange={(event) => {
                        const assetId = event.target.value;
                        if (!assetId) {
                          return;
                        }
                        const asset = assets.find((item) => item.id === assetId);
                        const next = insertAssetEmbed(
                          mdSource,
                          assetId,
                          asset?.name ?? "",
                        );
                        setMdSource(next);
                        setMdHtml(markdownToHtml(next, () => null));
                        setMdEditorKey((value) => value + 1);
                        event.target.value = "";
                      }}
                    >
                      <option value="">选择素材</option>
                      {assets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name}
                        </option>
                      ))}
                    </select>
                  </p>
                  <button
                    type="button"
                    disabled={!canWrite}
                    onClick={() => {
                      const node = treeNodes.find((item) => item.id === selectedNodeId);
                      if (!node?.objectId) {
                        return;
                      }
                      void commitSnapshot(
                        lockTarget(),
                        node.objectId,
                        new TextEncoder().encode(mdSource),
                        "markdown",
                        activeBranch,
                      ).then((snap) => {
                        setStatus(`已保存 Markdown 快照 ${snap.id.slice(0, 8)}`);
                        return refreshSnapshots(node.objectId!);
                      });
                    }}
                  >
                    保存 Markdown
                  </button>
                </div>
              ) : isPdfName(
                  treeNodes.find((node) => node.id === selectedNodeId)?.name ??
                    "",
                ) ? (
                <div
                  data-testid="pdf-viewer"
                  onTouchStart={(event) => {
                    const x = event.changedTouches[0]?.clientX ?? 0;
                    if (x < 24) {
                      setPdfSwipeX(null);
                      return;
                    }
                    setPdfSwipeX(x);
                  }}
                  onTouchEnd={(event) => {
                    if (pdfSwipeX == null || !pdfViewer?.bytes) {
                      setPdfSwipeX(null);
                      return;
                    }
                    const x = event.changedTouches[0]?.clientX ?? pdfSwipeX;
                    const dx = x - pdfSwipeX;
                    if (dx <= -40) {
                      onPdfPage((pdfViewer.currentPage ?? 1) + 1);
                    } else if (dx >= 40) {
                      onPdfPage((pdfViewer.currentPage ?? 1) - 1);
                    }
                    setPdfSwipeX(null);
                  }}
                >
                  <h3>PDF</h3>
                  <p>
                    未钉选先不拉原文件。Pad 滑动翻页（左缘 24px 留给返回）。
                  </p>
                  {!pdfViewer?.bytes ? (
                    <p>
                      <span data-testid="pdf-placeholder">
                        未下载原文件（{pdfViewer?.pageCount ?? "?"} 页缓存）
                      </span>
                      <button
                        type="button"
                        data-testid="pdf-download"
                        onClick={() => void onOpenPdf()}
                        disabled={!pdfViewer}
                      >
                        下载以查看
                      </button>
                    </p>
                  ) : (
                    <>
                      <p>
                        <button
                          type="button"
                          data-testid="pdf-prev"
                          onClick={() =>
                            onPdfPage((pdfViewer.currentPage ?? 1) - 1)
                          }
                        >
                          上一页
                        </button>
                        <span data-testid="pdf-page-label">
                          第 {pdfViewer.currentPage} / {pdfViewer.pageCount} 页
                        </span>
                        <button
                          type="button"
                          data-testid="pdf-next"
                          onClick={() =>
                            onPdfPage((pdfViewer.currentPage ?? 1) + 1)
                          }
                        >
                          下一页
                        </button>
                        <button
                          type="button"
                          data-testid="pdf-zoom-out"
                          onClick={() =>
                            setPdfZoom((value) => Math.max(0.5, value - 0.25))
                          }
                        >
                          缩小
                        </button>
                        <span>{Math.round(pdfZoom * 100)}%</span>
                        <button
                          type="button"
                          data-testid="pdf-zoom-in"
                          onClick={() =>
                            setPdfZoom((value) => Math.min(3, value + 0.25))
                          }
                        >
                          放大
                        </button>
                      </p>
                      <p data-testid="pdf-page-text">
                        {extractPdfPageText(
                          pdfViewer.bytes,
                          pdfViewer.currentPage,
                        )}
                      </p>
                      {pdfObjectUrl ? (
                        <iframe
                          title="PDF 预览"
                          src={`${pdfObjectUrl}#page=${pdfViewer.currentPage}`}
                          style={{
                            width: "100%",
                            minHeight: 360,
                            border: "1px solid #ccc",
                            transform: `scale(${pdfZoom})`,
                            transformOrigin: "top left",
                          }}
                        />
                      ) : null}
                    </>
                  )}
                </div>
              ) : isMindmapName(
                  treeNodes.find((node) => node.id === selectedNodeId)?.name ??
                    "",
                ) ? (
                <div data-testid="mindmap-editor">
                  <h3>思维导图</h3>
                  <p>存盘为 schemaVersion=1 的 JSON blob，不是私有二进制。Pad 双击编辑。</p>
                  {mindDoc ? (
                    <>
                      <ul data-testid="mindmap-tree">
                        <MindTree
                          node={mindDoc.root}
                          depth={0}
                          selectedId={mindSelectedId}
                          onSelect={setMindSelectedId}
                          onRename={(id, text) =>
                            setMindDoc(setMindNodeText(mindDoc, id, text))
                          }
                        />
                      </ul>
                      <button
                        type="button"
                        data-testid="mind-add-child"
                        disabled={!canWrite || !mindSelectedId}
                        onClick={() => {
                          setMindDoc(
                            addMindChild(mindDoc, mindSelectedId, "新节点"),
                          );
                        }}
                      >
                        添加子节点
                      </button>
                      <button
                        type="button"
                        data-testid="mind-save"
                        disabled={!canWrite}
                        onClick={() => {
                          const node = treeNodes.find(
                            (item) => item.id === selectedNodeId,
                          );
                          if (!node?.objectId) {
                            return;
                          }
                          void commitSnapshot(
                            lockTarget(),
                            node.objectId,
                            encodeMindDoc(mindDoc),
                            "mindmap",
                            activeBranch,
                          ).then((snap) => {
                            setStatus(
                              `已保存思维导图快照 ${snap.id.slice(0, 8)}（JSON）`,
                            );
                            return refreshSnapshots(node.objectId!);
                          });
                        }}
                      >
                        保存导图
                      </button>
                    </>
                  ) : (
                    <p>无法解析 JSON</p>
                  )}
                </div>
              ) : isDatabaseName(
                  treeNodes.find((node) => node.id === selectedNodeId)?.name ??
                    "",
                ) ? (
                <div data-testid="database-editor">
                  <h3>数据表</h3>
                  <p>权威数据是 JSON + oplog，不是 S3 上的 sqlite。</p>
                  {dbDoc ? (
                    <>
                      <table>
                        <thead>
                          <tr>
                            {liveColumns(dbDoc).map((column) => (
                              <th key={column.id}>
                                {column.name}
                                <code>{column.type}</code>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {liveRows(dbDoc).map((row) => (
                            <tr key={row.id}>
                              {liveColumns(dbDoc).map((column) => (
                                <td key={column.id}>
                                  <input
                                    data-testid={`db-cell-${row.id}-${column.id}`}
                                    value={String(row.cells[column.id] ?? "")}
                                    onChange={(event) => {
                                      setDbDoc(
                                        setDatabaseCell(
                                          dbDoc,
                                          row.id,
                                          column.id,
                                          event.target.value,
                                          tickHlc(dbClock),
                                        ),
                                      );
                                    }}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button
                        type="button"
                        data-testid="db-add-row"
                        disabled={!canWrite}
                        onClick={() => setDbDoc(addDatabaseRow(dbDoc, {}, tickHlc(dbClock)))}
                      >
                        加行
                      </button>
                      <button
                        type="button"
                        data-testid="db-add-column"
                        disabled={!canWrite}
                        onClick={() =>
                          setDbDoc(
                            addDatabaseColumn(dbDoc, "列", "text", tickHlc(dbClock)),
                          )
                        }
                      >
                        加列
                      </button>
                      <button
                        type="button"
                        data-testid="db-save"
                        disabled={!canWrite}
                        onClick={() => {
                          const node = treeNodes.find(
                            (item) => item.id === selectedNodeId,
                          );
                          if (!node?.objectId || !dbDoc) {
                            return;
                          }
                          void saveDatabase(
                            lockTarget(),
                            node.objectId,
                            dbDoc,
                            activeBranch,
                          ).then((snap) => {
                            setStatus(
                              `已保存数据表快照 ${snap.id.slice(0, 8)}（JSON+oplog）`,
                            );
                            return refreshSnapshots(node.objectId!);
                          });
                        }}
                      >
                        保存数据表
                      </button>
                      <button
                        type="button"
                        data-testid="db-compare"
                        onClick={() => {
                          if (!dbDoc || liveRows(dbDoc).length === 0) {
                            return;
                          }
                          const row = liveRows(dbDoc)[0]!;
                          const col = liveColumns(dbDoc)[0]!;
                          const remote = setDatabaseCell(
                            dbDoc,
                            row.id,
                            col.id,
                            "REMOTE",
                            tickHlc(dbClock),
                          );
                          setDbRemote(remote);
                          setDbConflicts(diffDatabaseCells(dbDoc, remote));
                        }}
                      >
                        与远端比较
                      </button>
                      {dbConflicts.map((conflict) => (
                        <p key={`${conflict.rowId}-${conflict.columnId}`}>
                          单元格冲突 本地={String(conflict.local)} 远端=
                          {String(conflict.remote)}
                          <button
                            type="button"
                            data-testid="db-pick-remote"
                            onClick={() => {
                              if (!dbDoc || !dbRemote) {
                                return;
                              }
                              setDbDoc(
                                applyCellChoice(
                                  dbDoc,
                                  dbRemote,
                                  conflict,
                                  "remote",
                                  tickHlc(dbClock),
                                ),
                              );
                              setDbConflicts([]);
                              setStatus("已选用远端单元格，结果唯一");
                            }}
                          >
                            用远端
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!dbDoc || !dbRemote) {
                                return;
                              }
                              setDbDoc(
                                applyCellChoice(
                                  dbDoc,
                                  dbRemote,
                                  conflict,
                                  "local",
                                  tickHlc(dbClock),
                                ),
                              );
                              setDbConflicts([]);
                              setStatus("已选用本地单元格，结果唯一");
                            }}
                          >
                            用本地
                          </button>
                        </p>
                      ))}
                    </>
                  ) : (
                    <p>无法解析数据表</p>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onCreateFolder();
            }}
          >
            <label>
              新文件夹
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
              />
            </label>
            <label>
              父文件夹
              <select
                value={folderParentId}
                onChange={(e) => setFolderParentId(e.target.value)}
              >
                <option value="">（根）</option>
                {treeNodes
                  .filter((node) => node.kind === "folder")
                  .map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
              </select>
            </label>
            <button type="submit" disabled={!canWrite}>
              创建文件夹
            </button>
          </form>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onMoveFolder();
            }}
          >
            <label>
              移动
              <select
                value={movingNodeId}
                onChange={(e) => setMovingNodeId(e.target.value)}
              >
                <option value="">选择节点</option>
                {treeNodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.kind === "file" ? "文件" : "文件夹"} {node.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              到
              <select
                value={moveParentId}
                onChange={(e) => setMoveParentId(e.target.value)}
              >
                <option value="">（根）</option>
                {treeNodes
                  .filter((node) => node.kind === "folder")
                  .map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
              </select>
            </label>
            <button type="submit" disabled={!canWrite}>
              移动
            </button>
          </form>
          <p>
            导入文件
            <input
              data-testid="pad-upload"
              type="file"
              disabled={!selectedLibraryId}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void onPickFile(file);
                }
                e.target.value = "";
              }}
            />
            <button type="button" onClick={() => void onFlushQueue()} disabled={!canWrite}>
              提交离线队列（{importQueue.length}）
            </button>
            <button
              type="button"
              data-testid="import-sample-pdf"
              disabled={!canWrite || !selectedLibraryId}
              onClick={() => {
                const bytes = encodeMinimalPdf(["Page One", "Page Two"]);
                const file = new File([Uint8Array.from(bytes)], "sample-two-page.pdf", {
                  type: "application/pdf",
                });
                void onPickFile(file);
              }}
            >
              导入示例双页 PDF
            </button>
            <button
              type="button"
              data-testid="import-sample-mindmap"
              disabled={!canWrite || !selectedLibraryId}
              onClick={() => {
                const bytes = encodeMindDoc(createMindDoc("根"));
                const file = new File([Uint8Array.from(bytes)], "plot.mindmap", {
                  type: "application/json",
                });
                void onPickFile(file);
              }}
            >
              新建思维导图
            </button>
            <button
              type="button"
              data-testid="import-sample-database"
              disabled={!canWrite || !selectedLibraryId}
              onClick={() => {
                const bytes = encodeDatabaseDoc(
                  createDatabaseDoc([
                    { name: "标题", type: "text" },
                    { name: "素材", type: "ref-asset" },
                  ]),
                );
                const file = new File([Uint8Array.from(bytes)], "cast.database", {
                  type: "application/json",
                });
                void onPickFile(file);
              }}
            >
              新建数据表
            </button>
          </p>
        </section>
      ) : null}
      <h2 id="pane-assets">素材</h2>
      <p>
        <label>
          <input
            type="checkbox"
            data-testid="pad-wifi-only"
            checked={wifiOnlyOriginals}
            onChange={(e) => setWifiOnlyOriginals(e.target.checked)}
          />
          仅 Wi-Fi 下载原图（Pad 默认开）
        </label>
      </p>
      {padHost ? (
        <section data-testid="pad-inbox">
          <h3>收件箱</h3>
          <p>
            分享或外部导出落到本机收件箱。前台扫描或点刷新：新文件持锁导入资料库；同名体积变化按
            snapshot 策略提交（默认 auto-on-save）。
          </p>
          <p>
            <button type="button" data-testid="pad-inbox-refresh" onClick={() => void onRefreshInbox()}>
              刷新收件箱
            </button>
            <button
              type="button"
              data-testid="pad-saf-pick"
              onClick={() => {
                const invoke = tauriInvokeFn();
                if (invoke) {
                  void invoke("saf_open_picker").then(async () => {
                    const status = (await invoke("saf_status")) as {
                      authorized?: boolean;
                      label?: string;
                    };
                    setSafAuthorized(Boolean(status.authorized));
                    setSafLabel(String(status.label ?? ""));
                  });
                }
              }}
            >
              授权导出目录
            </button>
            <button
              type="button"
              data-testid="pad-saf-revoke"
              onClick={() => {
                const invoke = tauriInvokeFn();
                if (invoke) {
                  void invoke("saf_revoke").then(() => {
                    setSafAuthorized(false);
                    setSafLabel("");
                    setStatus("已撤销 SAF 授权，停止扫描该目录");
                  });
                }
              }}
            >
              撤销授权
            </button>
          </p>
          <p data-testid="pad-saf-status">
            {safAuthorized ? `已授权目录 ${safLabel || "export"}` : "未授权 SAF 导出目录"}
          </p>
          {inboxScan.libraryId ? (
            <p data-testid="pad-inbox-scan-bound">
              已绑定 {Object.keys(inboxScan.objectIds).length} 个收件文件
            </p>
          ) : null}
          <ul data-testid="pad-inbox-list">
            {inboxItems.length === 0 ? <li>收件箱为空</li> : null}
            {inboxItems.map((item) => (
              <li key={item.name}>
                {item.name} · {item.size} B
                <button
                  type="button"
                  data-testid="pad-inbox-import"
                  disabled={!canWrite}
                  onClick={() => void onImportInbox(item.name)}
                >
                  导入素材库
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p>
        全局素材库。默认同步元数据与 thumb.webp，原图按需取回，不写入每台设备磁盘。
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onCreateAssetFolder();
        }}
      >
        <label>
          新素材文件夹
          <input
            value={newAssetFolderName}
            onChange={(e) => setNewAssetFolderName(e.target.value)}
            placeholder="例如 角色"
          />
        </label>
        <button type="submit" disabled={!canWrite}>
          创建文件夹
        </button>
      </form>
      <p>
        <label>
          导入到文件夹
          <select
            value={assetFolderId}
            onChange={(e) => setAssetFolderId(e.target.value)}
          >
            <option value="">（根）</option>
            {assetFolders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <button type="button" onClick={() => void refreshAssets()}>
          刷新素材
        </button>
        <label>
          导入图片
          <input
            type="file"
            accept="image/*"
            disabled={!canWrite}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void onPickAsset(file);
              }
              e.target.value = "";
            }}
          />
        </label>
      </p>
      <p>
        <label>
          按标签筛选
          <input
            value={assetTagFilter}
            onChange={(e) => setAssetTagFilter(e.target.value)}
            placeholder="多个标签需同时具备"
          />
        </label>
        <label>
          MiniSearch
          <input
            data-testid="asset-search"
            value={assetSearch}
            onChange={(e) => setAssetSearch(e.target.value)}
            placeholder="名称或标签"
          />
        </label>
      </p>
      <p>
        本机钉选 {pins.length} 项（不上远端）。原文件缓存 {originalCache.size}。
        <button
          type="button"
          onClick={() => {
            const refs = assets.map((asset) => ({
              kind: "asset" as const,
              id: asset.id,
              blobSha256: asset.blobSha256,
              folderId: asset.folderId,
            }));
            const removed = purgeUnpinnedOriginals(originalCache, pins, refs);
            setStatus(`已清理 ${removed} 个未钉选原文件，远端 blob 仍在`);
          }}
        >
          清理未钉选原文件
        </button>
      </p>
      <ul>
        {searchAssets(
          assetsMatchingTags(
            assets.filter((asset) =>
              assetFolderId ? asset.folderId === assetFolderId : true,
            ),
            assetTagFilter
              .split(/[,，\s]+/)
              .map((item) => item.trim())
              .filter(Boolean),
          ),
          assetSearch,
          "minisearch",
        ).map((asset) => (
          <li key={asset.id}>
            <button type="button" onClick={() => setSelectedAssetId(asset.id)}>
              {asset.name}
            </button>{" "}
            <code>{asset.thumbKey}</code>
            {asset.width && asset.height ? ` ${asset.width}×${asset.height}` : ""}
            {` ★${asset.rating}`}
            {asset.tags.length > 0 ? ` [${asset.tags.join(", ")}]` : ""}
            <button
              type="button"
              onClick={() => {
                const pin = { scope: "asset" as const, id: asset.id };
                persistPins(
                  hasPin(pins, pin) ? removePin(pins, pin) : addPin(pins, pin),
                );
              }}
            >
              {hasPin(pins, { scope: "asset", id: asset.id }) ? "取消钉选" : "钉选"}
            </button>
            <button
              type="button"
              onClick={() => {
                void fetchOriginalOnDemand(
                  activeStore(form),
                  formToConfig(form).prefix,
                  originalCache,
                  {
                    kind: "asset",
                    id: asset.id,
                    blobSha256: asset.blobSha256,
                    folderId: asset.folderId,
                  },
                  pins,
                  { wifiOnly: wifiOnlyOriginals, network: networkKind },
                )
                  .then((result) => {
                    setStatus(
                      `已按需取回 ${asset.name}（${result.bytes.byteLength} 字节）`,
                    );
                  })
                  .catch((error: unknown) => {
                    const message =
                      error instanceof Error ? error.message : String(error);
                    setStatus(
                      message.includes(WIFI_ONLY_ORIGINAL)
                        ? "蜂窝网络下已拦截原图下载，元数据仍可浏览"
                        : message,
                    );
                  });
              }}
            >
              取回原图
            </button>
          </li>
        ))}
      </ul>
      {selectedAssetId ? (
        <p>
          <label>
            给选中素材打标签
            <input
              value={assetTagDraft}
              onChange={(e) => setAssetTagDraft(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={!canWrite}
            onClick={() => {
              void addAssetTag(lockTarget(), selectedAssetId, assetTagDraft)
                .then(async () => {
                  setAssetTagDraft("");
                  await refreshAssets();
                })
                .catch((error: unknown) => {
                  setStatus(error instanceof Error ? error.message : "打标签失败");
                });
            }}
          >
            打标签
          </button>
          <label>
            评分
            <select
              value={
                assets.find((item) => item.id === selectedAssetId)?.rating ?? 0
              }
              onChange={(e) => {
                void setAssetRating(
                  lockTarget(),
                  selectedAssetId,
                  Number(e.target.value),
                )
                  .then(() => refreshAssets())
                  .catch((error: unknown) => {
                    setStatus(error instanceof Error ? error.message : "评分失败");
                  });
              }}
            >
              {[0, 1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          {(assets.find((item) => item.id === selectedAssetId)?.tags ?? []).map(
            (tag) => (
              <button
                key={tag}
                type="button"
                disabled={!canWrite}
                onClick={() => {
                  void removeAssetTag(lockTarget(), selectedAssetId, tag).then(
                    () => refreshAssets(),
                  );
                }}
              >
                {tag} ×
              </button>
            ),
          )}
        </p>
      ) : null}
      <h2 id="pane-kanban">看板</h2>
      <p>
        <button type="button" onClick={() => void refreshKanban()}>
          刷新 Workspace
        </button>
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onCreateWorkspace();
        }}
      >
        <label>
          新 Workspace
          <input
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            placeholder="例如 工作室"
          />
        </label>
        <button type="submit" disabled={!canWrite}>
          创建 Workspace
        </button>
      </form>
      <ul>
        {workspaces.map((ws) => (
          <li key={ws.id}>
            <button type="button" onClick={() => setSelectedWorkspaceId(ws.id)}>
              {ws.name}
            </button>
            <code>{ws.id.slice(0, 8)}</code>
            {ws.boardIds.map((boardId) => (
              <button
                key={boardId}
                type="button"
                onClick={() => {
                  setSelectedWorkspaceId(ws.id);
                  void openBoard(boardId);
                }}
              >
                Board {boardId.slice(0, 8)}
              </button>
            ))}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onCreateBoard();
        }}
      >
        <label>
          新 Board
          <input
            value={newBoardName}
            onChange={(e) => setNewBoardName(e.target.value)}
            placeholder="例如 开发"
          />
        </label>
        <button type="submit" disabled={!canWrite}>
          创建 Board
        </button>
      </form>
      {selectedBoardId ? (
        <section>
          <h3>Board {selectedBoardId.slice(0, 8)}（四层：Workspace → Board → List → Item）</h3>
          <p>拖拽卡片到其它 List；窄屏横向滑列，点卡片开全屏详情。</p>
          <div className="kanban-lists">
            {lists.map((list) => (
              <div
                key={list.id}
                className="kanban-list"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const itemId = event.dataTransfer.getData("text/plain");
                  if (itemId) {
                    void onDropItem(list.id, itemId);
                  }
                }}
              >
                <strong>{list.name}</strong>
                <ul>
                  {items
                    .filter((item) => item.listId === list.id)
                    .map((item) => (
                      <li
                        key={item.id}
                        draggable={canWrite}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", item.id);
                        }}
                      >
                        <button type="button" onClick={() => setDetailItemId(item.id)}>
                          {item.title}
                        </button>
                        {item.dueAt ? ` · ${item.dueAt.slice(0, 10)}` : ""}
                        {item.coverAssetId ? " · 封面" : ""}
                        {item.attachmentObjectIds?.length
                          ? ` · 附件${item.attachmentObjectIds.length}`
                          : ""}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
          {detailItemId ? (
            <div className="kanban-detail" role="dialog">
              <h4>Item 详情</h4>
              <p>{items.find((item) => item.id === detailItemId)?.title}</p>
              <p>{items.find((item) => item.id === detailItemId)?.descriptionMarkdown}</p>
              <label>
                移到
                <select
                  value={items.find((item) => item.id === detailItemId)?.listId ?? ""}
                  onChange={(event) => {
                    const listId = event.target.value;
                    if (listId) {
                      void onDropItem(listId, detailItemId);
                    }
                  }}
                >
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={() => setDetailItemId(null)}>
                关闭
              </button>
            </div>
          ) : null}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onCreateItem();
            }}
          >
            <label>
              List
              <select value={itemListId} onChange={(e) => setItemListId(e.target.value)}>
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              标题
              <input value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} required />
            </label>
            <label>
              描述
              <input value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} />
            </label>
            <label>
              截止
              <input
                type="datetime-local"
                value={itemDue}
                onChange={(e) => setItemDue(e.target.value)}
              />
            </label>
            <label>
              清单（一行一项）
              <textarea value={itemChecklist} onChange={(e) => setItemChecklist(e.target.value)} />
            </label>
            <label>
              标签 id
              <input value={itemLabels} onChange={(e) => setItemLabels(e.target.value)} />
            </label>
            <label>
              封面素材 id
              <input value={itemCover} onChange={(e) => setItemCover(e.target.value)} />
            </label>
            <label>
              附件 object id
              <input
                value={itemAttachments}
                onChange={(e) => setItemAttachments(e.target.value)}
              />
            </label>
            <button type="submit" disabled={!canWrite}>
              创建 Item
            </button>
          </form>
        </section>
      ) : null}
      <h2 id="pane-eink">墨水屏摘要</h2>
      <p>
        客户端持锁写 <code>device/eink/config.json</code> 与{" "}
        <code>summary.json</code>。固件只 GET 这两键，不持写锁、不 List 全桶。
      </p>
      <p>
        <button
          type="button"
          data-testid="eink-write"
          disabled={!canWrite}
          onClick={() => void onWriteEink()}
        >
          写入 config 与 summary
        </button>
      </p>
      {einkSummary ? (
        <div data-testid="eink-summary">
          <p>libraryCount {einkSummary.libraryCount}</p>
          <ul>
            {einkSummary.recentFiles.map((file) => (
              <li key={`${file.libraryName}-${file.name}`}>
                {file.name}（{file.libraryName}）
              </li>
            ))}
          </ul>
          <ul>
            {einkSummary.todos.map((todo) => (
              <li key={todo.title}>
                {todo.title} · {todo.boardName}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <style>{`
        label { display: block; margin: 0.4rem 0; }
        input[type="text"], input:not([type]), input[type="password"] { width: 100%; }
        button { margin-right: 0.5rem; min-height: 44px; }
        .kanban-lists { display: flex; gap: 1rem; overflow-x: auto; }
        .kanban-list { min-width: 180px; border: 1px solid #ccc; padding: 0.5rem; flex: 0 0 220px; }
        .kanban-detail { margin-top: 1rem; padding: 1rem; border: 1px solid #333; background: #fafafa; }
        @media (max-width: 720px) {
          .kanban-lists { scroll-snap-type: x mandatory; }
          .kanban-list { min-width: 80vw; scroll-snap-align: start; }
          .kanban-detail { position: fixed; inset: 0; z-index: 5; overflow: auto; }
        }
      `}</style>
    </div>
  );

  if (pickAppShell(viewport.width, padHost) === "tablet") {
    return (
      <TabletShell
        chrome={tabletChrome(viewport.width, viewport.height)}
        active={pane}
        onNavigate={(id) => {
          setPane(id);
          document.getElementById(`pane-${id}`)?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }}
      >
        {page}
      </TabletShell>
    );
  }
  return page;
}
