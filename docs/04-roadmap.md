# 开发计划（Agent 路线图）

实现顺序按依赖分层。每阶段结束必须有可运行产物，并把 [FEATURES.json](FEATURES.json) 中对应项标为 `done`。

领取任务规则见仓库根目录 [AGENTS.md](../AGENTS.md)。

## 阶段总览

| 阶段 | 名称 | 可运行产物 |
| --- | --- | --- |
| P0 | 骨架 | Monorepo；Web 配远端、list/get；**真实 PUT 必须走锁**；Tauri 空壳含 Android 目标 |
| P1 | 资料库 MVP | 库/文件夹/文件 CRUD；元数据+缩略图缓存；桌面接入 core |
| P2 | Tablet + Android 通路 | Tablet shell；Pad 安全存 key、沙箱缓存、OSS 浏览/上传 |
| P3 | 素材库 | 导入、标签、检索；Pad 分享导入 |
| P4 | 快照与同步 | 自动/手动快照、分支、冲突副本、钉选；Pad 收件箱 |
| P5 | 创作工具 | Markdown / PDF / 思维导图 |
| P6 | 项目工具 | 看板四层、多维表、冲突 UI |
| P7 | 扩展 | 插件（桌面）、MCP（桌面） |
| P8 | 墨水屏 | subtree 启动验证 → summary 写入 → 固件 S3 GET 与页面 |
| P9 | 多端加固 | 多远端复制、Pages+CORS、Android SAF/后台打磨 |

P2 不得晚于「资料库在 Pad 上不可用」。P2 与 P3 可部分并行，但 Pad 通路优先于素材库抛光。

## P0 骨架

设计：[18-monorepo](03-features/18-monorepo.md) · [01-remotes](03-features/01-remotes.md) · [协议锁](02-storage-protocol.md)

- 建 pnpm/Turbo/Cargo 边界，空 `packages/core|s3|ui`，`apps/web`，`apps/desktop`。
- core：类型、`withRemoteLock`、mock S3 单测（获取/占用/过期抢锁/心跳失败/释放）。
- Web：远端表单、list/get；任何 PUT 经锁。
- 条件写探测失败 → 拒绝当读写远端。
- Tauri 工程声明 desktop + Android，空壳能在桌面 `dev`。

**阶段验收：** mock 锁测试全绿；Web 连真实 MinIO/OSS 能 GET；一次受控 PUT 前后能观察到 `lock.json` 创建与删除。

## P1 资料库 MVP

设计：[02-libraries](03-features/02-libraries.md) · [05-sync](03-features/05-sync.md) · [15-desktop](03-features/15-desktop.md)

- 多库、树、导入、标签。
- 本地元数据缓存；桌面 IPC 接到 core。
- 队列 + 持锁提交。

**阶段验收：** 两端（或 Web+桌面）对同一远端看到同一棵树。

## P2 Tablet Shell + Android

设计：[16-android-pad](03-features/16-android-pad.md)

- Tablet shell 横竖屏。
- Keystore、沙箱 SQLite/缓存。
- Pad 上配置 OSS、浏览、上传（走锁）。

**阶段验收：** 平板模拟器或真机走通「配置 → 浏览 → 上传」；不是只靠手机浏览器。

## P3 素材库 + 检索

设计：[04-assets](03-features/04-assets.md)

- 导入、文件夹、标签、评分、缩略图。
- Desktop SQLite FTS / Web MiniSearch。
- Pad 分享导入。
- 视觉模型自动打标签（客户端直连 OpenAI 兼容接口，写 meta 走锁）。

**阶段验收：** 标签筛选可用；默认不下载原图。

## P4 快照分支 + 冲突 + 钉选

设计：[03-artwork-versions](03-features/03-artwork-versions.md) · [05-sync](03-features/05-sync.md) · [11-conflicts](03-features/11-conflicts.md)

- 手动/自动快照；分支；分叉出 `conflict/*`。
- Pin；Pad 收件箱扫描代替 watch。

**阶段验收：** 监视保存产生快照；分叉不丢内容；钉选策略符合文档。

## P5 创作工具

[06](03-features/06-markdown.md) [07](03-features/07-pdf.md) [08](03-features/08-mindmap.md)

**阶段验收：** 三种类型在 Web 与桌面打开；Pad 上 Markdown 与 PDF 可用。

## P6 项目工具

[10-kanban](03-features/10-kanban.md) [09-database](03-features/09-database.md) [11-conflicts](03-features/11-conflicts.md)

**阶段验收：** Workspace→Item 拖拽持久化；数据表行级同步；冲突页三种处理。

## P7 扩展

[12-plugins](03-features/12-plugins.md) [13-mcp](03-features/13-mcp.md)

**阶段验收：** 示例插件写 blob 走锁；MCP 能建看板 Item 与 Markdown。

## P8 墨水屏

[17-eink](03-features/17-eink.md)

严格顺序：

1. `git subtree add` 到 `apps/eink`，写 `UPSTREAM.md`，刷机验证上游 UI。
2. 客户端持锁写 `device/eink/config.json` 与 `summary.json`。
3. 固件 GET 两文件，新 RawDraw 页展示；周期默 2h（调试可改短）。

**阶段验收：** 未 bootstrap 成功不得改驱动；改完后断网仍显示缓存摘要。

## P9 多端加固

- 多远端按 `remoteId` 排序加锁复制。
- Pages 部署与 CORS 文档验证。
- Android SAF 授权夹、后台尽力同步、缓存回收 vs 钉选。

**阶段验收：** 家中客户端能把 OSS 新对象补到 NAS；Pages 无密钥；Pad 授权目录刷新收件箱可用。

## 推荐 Agent 节奏

一次只做 `FEATURES.json` 里一条 `todo` 且 `dependsOn` 均 `done` 的项。做完更新 `status`，不要一次跨两个阶段除非依赖已满足。
