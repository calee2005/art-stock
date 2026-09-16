import type { FormEvent, ReactNode } from "react";
import type {
  AssetFolder,
  AssetItem,
  BranchPointer,
  KanbanIndexWorkspace,
  KanbanItem,
  KanbanList,
  Snapshot,
  TreeNode,
} from "@art-stock/core";
import {
  ActivityHeatmap,
  CloudIcon,
  FolderIcon,
  SETTINGS_NAV,
  VersionGraph,
  type NavId,
  type SettingsSection,
} from "@art-stock/ui";
import { FolderTree } from "./FolderTree.tsx";
import { searchAssets, assetsMatchingTags } from "@art-stock/core";
import { countAssetKinds, formatLabel, matchesFormat } from "./media.ts";
import type { RemoteForm } from "./session.ts";

export type TimelineEvent = {
  id: string;
  title: string;
  time: string;
  version?: string;
  tag?: string;
};

export type AppPageProps = {
  padHost: boolean;
  pane: NavId;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  onSettingsSection: (section: SettingsSection) => void;
  onCloseSettings: () => void;
  onOpenSettings: () => void;
  status: string;
  conflictCount: number;
  pending: number;
  paused: boolean;
  canWrite: boolean;
  xssDismissed: boolean;
  onDismissXss: () => void;
  corsBlocked: boolean;
  corsMessage: string;
  corsJson: string;
  libraries: { id: string; name: string }[];
  assets: AssetItem[];
  form: RemoteForm;
  remoteReady: boolean;
  timestamps: string[];
  events: TimelineEvent[];
  eventRange: "7" | "30" | "all";
  onEventRange: (range: "7" | "30" | "all") => void;
  selectedLibraryId: string | null;
  onOpenLibrary: (id: string) => void;
  newLibraryName: string;
  onNewLibraryName: (value: string) => void;
  onCreateLibrary: () => void;
  onRenameLibrary: (id: string, name: string) => void;
  treeNodes: TreeNode[];
  selectedNodeId: string;
  onSelectNode: (node: TreeNode) => void;
  snapshots: Snapshot[];
  branches: BranchPointer[];
  activeBranch: string;
  onActiveBranch: (name: string) => void;
  onCommitSnapshot: () => void;
  onCreateBranch: () => void;
  newBranchName: string;
  onNewBranchName: (value: string) => void;
  snapshotMessage: string;
  onSnapshotMessage: (value: string) => void;
  snapshotBody: string;
  onSnapshotBody: (value: string) => void;
  onRollback: (id: string) => void;
  editor: ReactNode;
  newFolderName: string;
  onNewFolderName: (value: string) => void;
  folderParentId: string;
  onFolderParentId: (value: string) => void;
  onCreateFolder: () => void;
  onPickFile: (file: File) => void;
  assetFolders: AssetFolder[];
  assetFolderId: string;
  onAssetFolderId: (value: string) => void;
  newAssetFolderName: string;
  onNewAssetFolderName: (value: string) => void;
  onCreateAssetFolder: () => void;
  onPickAsset: (file: File) => void;
  assetSearch: string;
  onAssetSearch: (value: string) => void;
  assetTagFilter: string;
  onAssetTagFilter: (value: string) => void;
  assetFormat: string;
  onAssetFormat: (value: string) => void;
  smartFolder: "all" | "recent7" | "random30";
  onSmartFolder: (value: "all" | "recent7" | "random30") => void;
  selectedAssetId: string;
  onSelectAsset: (id: string) => void;
  thumbUrls: Record<string, string>;
  workspaces: KanbanIndexWorkspace[];
  selectedWorkspaceId: string;
  onSelectWorkspace: (id: string) => void;
  newWorkspaceName: string;
  onNewWorkspaceName: (value: string) => void;
  onCreateWorkspace: () => void;
  selectedBoardId: string;
  boardsOfWorkspace: { id: string; workspaceId: string }[];
  onOpenBoard: (id: string) => void;
  newBoardName: string;
  onNewBoardName: (value: string) => void;
  onCreateBoard: () => void;
  lists: KanbanList[];
  items: KanbanItem[];
  onDropItem: (listId: string, itemId: string) => void;
  onOpenItem: (id: string | null) => void;
  detailItemId: string | null;
  quickItem: Record<string, string>;
  onQuickItem: (listId: string, value: string) => void;
  onQuickAdd: (listId: string) => void;
  onCreateList: () => void;
  settingsBasic: ReactNode;
  settingsLibrary: ReactNode;
  settingsGeneral: ReactNode;
  workspaceExtra?: ReactNode;
  assetsExtra?: ReactNode;
  kanbanExtra?: ReactNode;
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function remoteKind(form: RemoteForm): "nas" | "oss" | "other" {
  const blob = `${form.name} ${form.endpoint}`.toLowerCase();
  if (blob.includes("aliyun") || blob.includes("aliyuncs") || blob.includes("oss") || form.name.includes("阿里")) {
    return "oss";
  }
  if (blob.includes("nas") || blob.includes("minio") || form.forcePathStyle) {
    return "nas";
  }
  return "other";
}

export function AppPage(props: AppPageProps) {
  const counts = countAssetKinds(props.assets);
  const selected = props.treeNodes.find((node) => node.id === props.selectedNodeId);
  const currentSnap =
    props.branches.find((branch) => branch.name === props.activeBranch)?.snapshotId ??
    props.snapshots[props.snapshots.length - 1]?.id;
  const visibleAssets = filterAssets(props);
  const tags = [...new Set(props.assets.flatMap((item) => item.tags))];
  const ws = props.workspaces.find((item) => item.id === props.selectedWorkspaceId);
  const boardIds = ws?.boardIds ?? [];

  return (
    <div className="as-app">
      <section
        className="as-pane"
        id="pane-overview"
        hidden={props.pane !== "overview"}
        data-testid="pane-overview"
      >
        <div className="as-cards">
          <article className="as-card">
            <div className="as-card-kicker">资料库</div>
            <div className="as-metrics">
              <div>
                <div className="as-metric-n">{props.libraries.length}</div>
                <div className="as-metric-l">活动</div>
              </div>
              <div>
                <div className="as-metric-n">0</div>
                <div className="as-metric-l">归档</div>
              </div>
            </div>
          </article>
          <article className="as-card">
            <div className="as-card-kicker">素材库</div>
            <div className="as-metrics">
              <div>
                <div className="as-metric-n">{counts.image}</div>
                <div className="as-metric-l">图片</div>
              </div>
              <div>
                <div className="as-metric-n">{counts.video}</div>
                <div className="as-metric-l">视频</div>
              </div>
              <div>
                <div className="as-metric-n">{counts.model}</div>
                <div className="as-metric-l">模型</div>
              </div>
              <div>
                <div className="as-metric-n">{counts.other}</div>
                <div className="as-metric-l">其他</div>
              </div>
            </div>
          </article>
          <article className="as-card">
            <div className="as-card-head">
              <span>远端</span>
              <span>
                <button type="button" className="as-link" onClick={props.onOpenSettings}>
                  管理
                </button>
                <button
                  type="button"
                  className="as-icon-btn"
                  aria-label="添加远端"
                  onClick={props.onOpenSettings}
                >
                  +
                </button>
              </span>
            </div>
            <div className="as-remote-row">
              {props.form.endpoint || props.form.name ? (
                <div className="as-remote">
                  {props.remoteReady ? <span className="as-badge-ok">✓</span> : null}
                  <div className="as-cloud">
                    <CloudIcon
                      color={remoteKind(props.form) === "oss" ? "#f59e0b" : "#22c55e"}
                    />
                  </div>
                  <span>
                    {props.form.name ||
                      (remoteKind(props.form) === "oss" ? "阿里云" : "NAS")}
                  </span>
                </div>
              ) : (
                <button type="button" className="as-link" onClick={props.onOpenSettings}>
                  添加远端
                </button>
              )}
            </div>
          </article>
        </div>
        <div className="as-section-label">活动</div>
        <ActivityHeatmap timestamps={props.timestamps} />
        <div className="as-events-head">
          <span>事件</span>
          <select
            value={props.eventRange}
            onChange={(event) =>
              props.onEventRange(event.target.value as "7" | "30" | "all")
            }
            aria-label="事件范围"
          >
            <option value="7">7天</option>
            <option value="30">30天</option>
            <option value="all">查看全部</option>
          </select>
          <button
            type="button"
            className="as-link"
            onClick={() => props.onEventRange("all")}
          >
            查看全部
          </button>
        </div>
        <ul className="as-events">
          {props.events.length === 0 ? (
            <li>
              <div className="as-event-title">暂无事件</div>
              <div className="as-event-time">连接远端并导入后会出现在这里</div>
            </li>
          ) : null}
          {props.events.map((event) => (
            <li key={event.id}>
              <div className="as-event-title">
                {event.title}
                {event.version ? (
                  <span className="as-ver"> {event.version}</span>
                ) : null}
                {event.tag ? <span className="as-tag">{event.tag}</span> : null}
              </div>
              <div className="as-event-time">{fmtTime(event.time)}</div>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="as-pane"
        id="pane-library"
        hidden={props.pane !== "library"}
      >
        <div className="as-split">
          <aside className="as-side">
            <label className="as-side-select">
              <span>
                <strong>
                  {props.libraries.find((item) => item.id === props.selectedLibraryId)
                    ?.name ?? "选择资料库"}
                </strong>
                <small>资料库</small>
              </span>
              <span aria-hidden="true">▾</span>
              <select
                aria-label="资料库"
                value={props.selectedLibraryId ?? ""}
                onChange={(event) => {
                  if (event.target.value) {
                    props.onOpenLibrary(event.target.value);
                  }
                }}
              >
                <option value="">选择资料库</option>
                {props.libraries.map((lib) => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name}
                  </option>
                ))}
              </select>
            </label>
            <FolderTree
              nodes={props.treeNodes}
              selectedId={props.selectedNodeId}
              onSelect={props.onSelectNode}
            />
            <div className="as-side-block">
              <form
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  props.onCreateFolder();
                }}
              >
                <label>
                  新文件夹
                  <input
                    value={props.newFolderName}
                    onChange={(event) => props.onNewFolderName(event.target.value)}
                  />
                </label>
                <select
                  value={props.folderParentId}
                  onChange={(event) => props.onFolderParentId(event.target.value)}
                >
                  <option value="">（根）</option>
                  {props.treeNodes
                    .filter((node) => node.kind === "folder")
                    .map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.name}
                      </option>
                    ))}
                </select>
                <button type="submit" className="as-btn" disabled={!props.canWrite}>
                  创建文件夹
                </button>
              </form>
              <p>
                导入文件
                <input
                  data-testid="pad-upload"
                  type="file"
                  disabled={!props.selectedLibraryId}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      props.onPickFile(file);
                    }
                    event.target.value = "";
                  }}
                />
              </p>
            </div>
          </aside>
          <VersionGraph
            snapshots={props.snapshots.map((item) => ({
              id: item.id,
              parentSnapshotId: item.parentSnapshotId,
              branch: item.branch,
              message: item.message,
            }))}
            branches={props.branches.map((item) => ({
              name: item.name,
              snapshotId: item.snapshotId,
            }))}
            activeSnapshotId={currentSnap}
            onSelect={props.onRollback}
          />
          <div className="as-preview">
            <div className="as-preview-head">
              <span>{selected?.name ?? "未选择文件"}</span>
            </div>
            <div className="as-preview-frame">{props.editor}</div>
            <div className="as-preview-ver">
              版本：{props.activeBranch}
              {currentSnap ? ` · ${currentSnap.slice(0, 8)}` : ""}
            </div>
            <div className="as-btn-row">
              <button
                type="button"
                className="as-btn"
                disabled={!props.canWrite || !selected?.objectId}
                onClick={props.onCommitSnapshot}
              >
                上传新版本
              </button>
              <button
                type="button"
                className="as-btn"
                disabled={!props.canWrite || !selected?.objectId}
                onClick={props.onCreateBranch}
              >
                创建分支
              </button>
            </div>
            <label>
              新分支名
              <input
                value={props.newBranchName}
                onChange={(event) => props.onNewBranchName(event.target.value)}
              />
            </label>
            <label>
              message
              <input
                value={props.snapshotMessage}
                onChange={(event) => props.onSnapshotMessage(event.target.value)}
              />
            </label>
            <label>
              新内容
              <input
                value={props.snapshotBody}
                onChange={(event) => props.onSnapshotBody(event.target.value)}
              />
            </label>
            <div className="as-placeholder">图像信息</div>
            <div className="as-placeholder">直方图</div>
            {props.snapshots.length > 0 ? (
              <ul>
                {props.snapshots.map((snap) => (
                  <li key={snap.id}>
                    [{snap.branch}] {snap.message}
                    <button
                      type="button"
                      disabled={!props.canWrite}
                      onClick={() => props.onRollback(snap.id)}
                    >
                      回滚到此
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {props.workspaceExtra}
          </div>
        </div>
      </section>

      <section
        className="as-pane"
        id="pane-assets"
        hidden={props.pane !== "assets"}
      >
        <div className="as-split-assets">
          <aside className="as-side">
            <div className="as-side-block">智能文件夹</div>
            <ul className="as-tree">
              <li>
                <button
                  type="button"
                  className={props.smartFolder === "recent7" ? "is-active" : undefined}
                  onClick={() => props.onSmartFolder("recent7")}
                >
                  <FolderIcon width={16} height={16} />
                  最近7天访问
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={props.smartFolder === "random30" ? "is-active" : undefined}
                  onClick={() => props.onSmartFolder("random30")}
                >
                  <FolderIcon width={16} height={16} />
                  随机30张
                </button>
              </li>
            </ul>
            <div className="as-side-block">文件夹</div>
            <ul className="as-tree">
              <li>
                <button
                  type="button"
                  className={!props.assetFolderId && props.smartFolder === "all" ? "is-active" : undefined}
                  onClick={() => {
                    props.onSmartFolder("all");
                    props.onAssetFolderId("");
                  }}
                >
                  全部
                </button>
              </li>
              {props.assetFolders.map((folder) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    className={props.assetFolderId === folder.id ? "is-active" : undefined}
                    onClick={() => {
                      props.onSmartFolder("all");
                      props.onAssetFolderId(folder.id);
                    }}
                  >
                    <FolderIcon width={16} height={16} />
                    {folder.name}
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="as-side-block"
              onSubmit={(event) => {
                event.preventDefault();
                props.onCreateAssetFolder();
              }}
            >
              <input
                value={props.newAssetFolderName}
                onChange={(event) => props.onNewAssetFolderName(event.target.value)}
                placeholder="新素材文件夹"
              />
              <button type="submit" className="as-btn" disabled={!props.canWrite}>
                创建
              </button>
            </form>
            <div className="as-side-block">标签</div>
            <div className="as-side-block">
              <input
                value={props.assetTagFilter}
                onChange={(event) => props.onAssetTagFilter(event.target.value)}
                placeholder="请输入检索"
              />
              <ul className="as-tree">
                {tags.map((tag) => (
                  <li key={tag}>
                    <button
                      type="button"
                      className={props.assetTagFilter === tag ? "is-active" : undefined}
                      onClick={() => props.onAssetTagFilter(tag)}
                    >
                      {tag}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
          <div>
            <div className="as-toolbar">
              <span>色彩</span>
              <span className="as-chip" style={{ background: "#3da34c" }} />
              <span>格式</span>
              <button
                type="button"
                className="as-chip"
                onClick={() =>
                  props.onAssetFormat(props.assetFormat === "JPG" ? "all" : "JPG")
                }
              >
                JPG
              </button>
              <input
                className="as-search"
                data-testid="asset-search"
                value={props.assetSearch}
                onChange={(event) => props.onAssetSearch(event.target.value)}
                placeholder="请输入检索"
              />
              <label>
                导入图片
                <input
                  type="file"
                  accept="image/*"
                  disabled={!props.canWrite}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      props.onPickAsset(file);
                    }
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            <div className="as-grid">
              {visibleAssets.map((asset) => (
                <button
                  type="button"
                  className="as-thumb"
                  key={asset.id}
                  onClick={() => props.onSelectAsset(asset.id)}
                >
                  <div className="as-thumb-frame">
                    {props.thumbUrls[asset.id] ? (
                      <img src={props.thumbUrls[asset.id]} alt="" />
                    ) : (
                      <span>🖼</span>
                    )}
                  </div>
                  <div className="as-thumb-name">{asset.name}</div>
                  <div className="as-thumb-meta">
                    {formatLabel(asset.mimeType, asset.name)}
                    {asset.width && asset.height
                      ? ` ${asset.width} * ${asset.height}`
                      : ""}
                  </div>
                </button>
              ))}
            </div>
            {props.assetsExtra}
          </div>
        </div>
      </section>

      <section
        className="as-pane"
        id="pane-kanban"
        hidden={props.pane !== "kanban"}
      >
        <div className="as-kanban-top">
          <select
            value={props.selectedWorkspaceId}
            onChange={(event) => props.onSelectWorkspace(event.target.value)}
            aria-label="Workspace"
          >
            <option value="">选择 Workspace</option>
            {props.workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        {boardIds.length > 1 ? (
          <p style={{ textAlign: "center" }}>
            {boardIds.map((boardId) => (
              <button
                key={boardId}
                type="button"
                className="as-link"
                onClick={() => props.onOpenBoard(boardId)}
              >
                {boardId === props.selectedBoardId ? "● " : ""}
                Board {boardId.slice(0, 8)}
              </button>
            ))}
          </p>
        ) : null}
        <div className="as-kanban-board kanban-lists">
          {props.lists.map((list) => (
            <div
              key={list.id}
              className="as-kanban-col kanban-list"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const itemId = event.dataTransfer.getData("text/plain");
                if (itemId) {
                  props.onDropItem(list.id, itemId);
                }
              }}
            >
              <h3>{list.name}</h3>
              <div className="as-kanban-note">列表备注</div>
              {props.items
                .filter((item) => item.listId === list.id)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="as-kanban-item"
                    draggable={props.canWrite}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", item.id);
                    }}
                    onClick={() => props.onOpenItem(item.id)}
                  >
                    <input type="checkbox" tabIndex={-1} readOnly />
                    {item.title}
                  </button>
                ))}
              <input
                className="as-kanban-add"
                placeholder="请输入添加新事项"
                value={props.quickItem[list.id] ?? ""}
                onChange={(event) => props.onQuickItem(list.id, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    props.onQuickAdd(list.id);
                  }
                }}
                disabled={!props.canWrite}
              />
            </div>
          ))}
          <button
            type="button"
            className="as-kanban-plus"
            aria-label="新增列表"
            disabled={!props.canWrite || !props.selectedBoardId}
            onClick={props.onCreateList}
          >
            +
          </button>
        </div>
        {props.detailItemId ? (
          <div className="kanban-detail" role="dialog">
            <h4>Item 详情</h4>
            <p>{props.items.find((item) => item.id === props.detailItemId)?.title}</p>
            <p>
              {props.items.find((item) => item.id === props.detailItemId)?.descriptionMarkdown}
            </p>
            <button type="button" onClick={() => props.onOpenItem(null)}>
              关闭
            </button>
          </div>
        ) : null}
        {props.kanbanExtra}
      </section>

      <div
        className="as-modal-back"
        id="pane-remote"
        hidden={!props.settingsOpen}
        data-testid="settings-modal"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            props.onCloseSettings();
          }
        }}
      >
        <div className="as-modal" role="dialog" aria-label="配置">
          <nav className="as-modal-nav">
            <h2>配置</h2>
            <input placeholder="请输入检索" aria-label="配置检索" />
            {SETTINGS_NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={props.settingsSection === item.id ? "true" : undefined}
                onClick={() => props.onSettingsSection(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="as-modal-body as-form">
            <button type="button" className="as-close" onClick={props.onCloseSettings} aria-label="关闭">
              ×
            </button>
            <h3>
              {props.settingsSection === "basic"
                ? "通用资料库配置"
                : props.settingsSection === "library"
                  ? "资料库"
                  : "通用"}
            </h3>
            {!props.xssDismissed && props.settingsSection === "basic" ? (
              <p className="as-xss" role="alert">
                密钥保存在浏览器本地。XSS 或不可信扩展可窃取密钥。优先使用短期密钥。
                <button type="button" onClick={props.onDismissXss}>
                  本会话不再提示
                </button>
              </p>
            ) : null}
            {props.corsBlocked ? (
              <div className="as-alert" data-testid="cors-error" role="alert">
                {props.corsMessage}
              </div>
            ) : null}
            <div hidden={props.settingsSection !== "basic"}>{props.settingsBasic}</div>
            <div hidden={props.settingsSection !== "library"}>{props.settingsLibrary}</div>
            <div hidden={props.settingsSection !== "general"}>{props.settingsGeneral}</div>
          </div>
        </div>
      </div>

      <p className="as-status" role="status" data-testid="pad-status">
        状态栏：待提交 {props.pending}
        {props.paused ? " · 已暂停" : " · 同步开启"} {props.status}{" "}
        <span data-testid="conflict-badge">
          冲突 {props.conflictCount}
        </span>
      </p>
    </div>
  );
}

function filterAssets(props: AppPageProps): AssetItem[] {
  const now = Date.now();
  let items = props.assets.filter((asset) =>
    matchesFormat(asset.mimeType, asset.name, props.assetFormat),
  );
  if (props.smartFolder === "recent7") {
    items = items.filter(
      (asset) => now - new Date(asset.updatedAt).getTime() < 7 * 24 * 3600 * 1000,
    );
  } else if (props.assetFolderId) {
    items = items.filter((asset) => asset.folderId === props.assetFolderId);
  }
  if (props.assetTagFilter.trim()) {
    const want = props.assetTagFilter
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    items = assetsMatchingTags(items, want);
  }
  if (props.assetSearch.trim()) {
    items = searchAssets(items, props.assetSearch, "minisearch");
  }
  if (props.smartFolder === "random30") {
    items = items.slice().sort((a, b) => a.id.localeCompare(b.id)).slice(0, 30);
  }
  return items;
}
