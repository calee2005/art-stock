# 功能清单

Agent 以 [FEATURES.json](FEATURES.json) 为任务源，本文件为可读勾选视图。状态：`todo` / `doing` / `done` / `blocked`。

领取规则见 [AGENTS.md](../AGENTS.md)。阶段说明见 [04-roadmap.md](04-roadmap.md)。

当前进度：P0 已完成；P1 **F-010**–**F-014** 已完成。完成一项后请同步改 JSON 的 `status`，并把下面相应行改为 `[x]`。

## P0 骨架

- [x] **F-000** Monorepo 骨架（pnpm/Turbo/Cargo） — [18-monorepo](03-features/18-monorepo.md)
- [x] **F-001** core 类型与对象键生成 — [协议](02-storage-protocol.md)（依赖 F-000）；prefix 默认空，协议根固定 `.artstock/v1/`
- [x] **F-002** S3 适配接口 + mock — [01-remotes](03-features/01-remotes.md)（F-001）
- [x] **F-003** 全局写锁 `withRemoteLock` — [协议](02-storage-protocol.md)（F-002）
- [x] **F-004** Web：远端配置、探测、list/get、受控 PUT — [14-web](03-features/14-web.md)（F-003）
- [x] **F-005** Tauri 空壳 desktop + Android 目标 — [15-desktop](03-features/15-desktop.md)（F-000）

## P1 资料库 MVP

- [x] **F-010** 资料库 CRUD 与 manifest — [02-libraries](03-features/02-libraries.md)（F-004）
- [x] **F-011** 多层文件夹树（F-010）
- [x] **F-012** 文件导入与 object meta（F-011）
- [x] **F-013** 标签 OR-Set（F-012）
- [x] **F-014** 桌面接入同一 core（F-005, F-010）
- [ ] **F-015** 元数据/缩略图缓存与同步队列 — [05-sync](03-features/05-sync.md)（F-012）

## P2 Tablet + Android 通路

- [ ] **F-020** Tablet shell 横屏/竖屏 — [16-android-pad](03-features/16-android-pad.md)
- [ ] **F-021** Android Keystore 存密钥（F-005, F-004）
- [ ] **F-022** 沙箱 SQLite 与 pinned/缓存分离（F-021, F-015）
- [ ] **F-023** Pad 真机：OSS 浏览与上传（F-020, F-022, F-010）

## P3 素材库

- [ ] **F-030** 导入与缩略图 — [04-assets](03-features/04-assets.md)（F-012）
- [ ] **F-031** 文件夹、标签、评分（F-030）
- [ ] **F-032** FTS / MiniSearch（F-031）
- [ ] **F-033** Pad 分享导入（F-023, F-030）

## P4 快照、冲突、钉选

- [ ] **F-040** 手动 snapshot 与回滚 — [03-artwork-versions](03-features/03-artwork-versions.md)
- [ ] **F-041** 桌面监视自动快照（F-040, F-014）
- [ ] **F-042** 命名分支（F-040）
- [ ] **F-043** 分叉生成 `conflict/*`（F-042）
- [ ] **F-044** 钉选 / 按需取回 / 清理（F-015）
- [ ] **F-045** Pad 收件箱扫描（F-033, F-040）
- [ ] **F-046** Pad 仅 Wi-Fi 下载原文件（F-023, F-044）

## P5 创作工具

- [ ] **F-050** Markdown WYSIWYG / TOC / 素材 — [06-markdown](03-features/06-markdown.md)
- [ ] **F-051** PDF 翻页 — [07-pdf](03-features/07-pdf.md)
- [ ] **F-052** 思维导图 JSON — [08-mindmap](03-features/08-mindmap.md)

## P6 项目工具

- [ ] **F-060** 看板 Workspace 与 Board — [10-kanban](03-features/10-kanban.md)
- [ ] **F-061** List 与 Item CRUD（F-060）
- [ ] **F-062** 拖拽改 listId/order（F-061）
- [ ] **F-063** 多维数据表 — [09-database](03-features/09-database.md)
- [ ] **F-064** 冲突 UI — [11-conflicts](03-features/11-conflicts.md)（F-043）

## P7 扩展

- [ ] **F-070** 桌面插件宿主 — [12-plugins](03-features/12-plugins.md)
- [ ] **F-071** MCP stdio — [13-mcp](03-features/13-mcp.md)（F-050, F-061）

## P8 墨水屏

- [ ] **F-080** subtree 拉取上游并刷机验证启动 — [17-eink](03-features/17-eink.md)（无代码依赖，但未完成前禁止改驱动）
- [ ] **F-081** 客户端写 config/summary（F-010, F-061, F-003）
- [ ] **F-082** 固件 GET 与 art-stock 页面（F-080, F-081）

## P9 多端加固

- [ ] **F-090** 多远端复制（排序加锁）
- [ ] **F-091** GitHub Pages 与 CORS
- [ ] **F-092** Android SAF 与后台尽力同步

## JSON 字段说明

每条 FEATURES.json 记录：

- `id` / `name` / `phase` / `status`
- `dependsOn`：必须全部 `done` 才可领取
- `apps`：涉及端
- `designDoc`：必读设计
- `acceptance`：完成标准
- `notes`：阻塞原因或补充
