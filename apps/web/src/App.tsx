import { useEffect, useMemo, useState } from "react";
import {
  MemoryObjectStore,
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
  type ImportQueue,
  type SyncState,
  type ObjectStore,
  type TreeNode,
  type KanbanIndexWorkspace,
  type KanbanList,
  type KanbanItem,
  type Snapshot,
  type BranchPointer,
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
  loadRemoteForm,
  probeReadwrite,
  putWithGlobalLock,
  saveRemoteForm,
  type RemoteForm,
} from "./session.ts";

const storage: Storage = window.localStorage;
const demoStore = new MemoryObjectStore();

function activeStore(_form: RemoteForm): ObjectStore {
  // Real HTTP S3 client is still stubbed (F-002). Web uses an in-memory
  // store so list/get/locked PUT can be exercised without a backend.
  return demoStore;
}

export function App() {
  const [form, setForm] = useState<RemoteForm>(
    () => loadRemoteForm(storage) ?? emptyRemoteForm(),
  );
  const [xssDismissed, setXssDismissed] = useState(
    () => sessionStorage.getItem("art-stock.xss-ok") === "1",
  );
  const [status, setStatus] = useState("未连接。空密钥不会请求任何桶。");
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
  const device = useMemo(() => deviceIdentity(storage), []);
  const preview = useMemo(
    () => protocolRoot(form.prefix),
    [form.prefix],
  );
  const canWrite = form.mode === "readwrite";

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

  function update<K extends keyof RemoteForm>(key: K, value: RemoteForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function save() {
    saveRemoteForm(storage, form);
    setStatus("已保存到本机。清除站点数据会丢失密钥。");
  }

  async function probe() {
    if (!hasCredentials(form) && form.mode === "readwrite") {
      setStatus("缺少密钥，未向远端发请求。");
      return;
    }
    const result = await probeReadwrite(activeStore(form), form.prefix);
    if (!result.ok) {
      update("mode", "readonly");
      setStatus(`${result.message}。已改为只读，禁止当读写远端。`);
      return;
    }
    setStatus(`探测成功，协议根 ${result.protocolRoot}`);
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
    const listed = await listLibraries(activeStore(form), formToConfig(form).prefix);
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

  function lockTarget() {
    return {
      store: activeStore(form),
      prefix: formToConfig(form).prefix,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
    };
  }

  async function refreshTree(libraryId: string) {
    const current = await readTree(
      activeStore(form),
      formToConfig(form).prefix,
      libraryId,
    );
    setTreeNodes(current?.tree.nodes ?? []);
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
  }

  function clearVersionUi() {
    setSnapshots([]);
    setBranches([]);
    setDefaultBranch("main");
    setActiveBranch("main");
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
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
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
          <input value={form.endpoint} onChange={(e) => update("endpoint", e.target.value)} />
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
        <button type="submit">保存</button>
      </form>
      <p>
        <a href="https://github.com/calee2005/art-stock/blob/master/docs/02-storage-protocol.md">
          CORS 需放行 If-Match / If-None-Match / x-oss-forbid-overwrite
        </a>
      </p>
      <p>
        <button type="button" onClick={() => void probe()}>
          探测条件写
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
      <p>{status}</p>
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
            value={newLibraryName}
            onChange={(e) => setNewLibraryName(e.target.value)}
            placeholder="例如 角色设定"
          />
        </label>
        <button type="submit" disabled={!canWrite}>
          创建
        </button>
      </form>
      <ul>
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
          </p>
        </section>
      ) : null}
      <h2 id="pane-assets">素材</h2>
      <p>素材库导入与缩略图见 F-030。</p>
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

  if (pickAppShell(viewport.width) === "tablet") {
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
