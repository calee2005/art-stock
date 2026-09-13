import { useMemo, useState } from "react";
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
  type ImportQueue,
  type SyncState,
  type ObjectStore,
  type TreeNode,
  type KanbanIndexWorkspace,
} from "@art-stock/core";
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
  const device = useMemo(() => deviceIdentity(storage), []);
  const preview = useMemo(
    () => protocolRoot(form.prefix),
    [form.prefix],
  );
  const canWrite = form.mode === "readwrite";

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
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Art Stock Web</h1>
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
      <h2>资料库</h2>
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
                    onClick={() => setSelectedNodeId(node.id)}
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
      <h2>看板</h2>
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
            看板 {ws.boardIds.length}
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
      <style>{`
        label { display: block; margin: 0.4rem 0; }
        input[type="text"], input:not([type]), input[type="password"] { width: 100%; }
        button { margin-right: 0.5rem; min-height: 44px; }
      `}</style>
    </div>
  );
}
