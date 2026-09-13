# Agent 约定

本仓库的实现以 `docs/` 为准，不以聊天里的口头描述为准。冲突时 **先改文档再改代码**。

## 你是谁、做什么

你在实现「艺术资产管理中心」。先读：

1. [docs/00-overview.md](docs/00-overview.md)
2. [docs/01-architecture.md](docs/01-architecture.md)
3. [docs/02-storage-protocol.md](docs/02-storage-protocol.md)
4. [docs/04-roadmap.md](docs/04-roadmap.md)

然后从 [docs/FEATURES.json](docs/FEATURES.json) 领取任务。

## 领取任务

1. 打开 `docs/FEATURES.json`，选一条 `status: "todo"`，且其 `dependsOn` 中每个 id 都是 `done`。
2. 把该条改为 `doing`（同一时间只允许一条 `doing`）。
3. 阅读该条的 `designDoc` 以及协议里被引用的章节。
4. 实现、测试、满足 `acceptance`。
5. 将 `status` 改为 `done`。无法做完则改为 `blocked` 并在 `notes` 写原因。
6. 不要一次实现多个 FEATURES 项，除非用户明确要求。

## 硬性约束

- **零后端。** 禁止加「同步服务器」来绕过 S3 协议。
- **写入必须走** `packages/core` 的 `withRemoteLock()`。禁止无条件覆盖 `lock.json`，禁止 GET+PUT 当锁。不支持条件写的远端必须判定不合格。
- **协议实现以 TypeScript `packages/core` 为规范。** Rust 只做 I/O 与系统集成。
- **画稿版本是快照+命名分支**，不是 Git。
- **看板四层：** Workspace → Board → List → Item。不要做成单层 Board。
- **Android Pad 是一等端。** 不要用「请用手机浏览器打开 Pages」代替 Pad 任务。
- **墨水屏：** 必须先 subtree 拉取 https://github.com/calee2005/youn-ink-fourcolor-firmware 到 `apps/eink` 并刷机验证启动。禁止新建平行 `apps/firmware` 从零重写。未亮屏前不准删驱动、不准换 UI 框架。上游 `server/` 与 `frontend/` 不要删。固件只 GET，不持写锁、不 List 全桶。
- **密钥：** 不上 Git、不进 Pages、不进 eink summary、不进 MCP 返回值、不进日志。
- **不要改** 用户未要求的计划文件（`.cursor/plans`）。

## 代码风格

- 改动范围只覆盖当前 FEATURE。不要顺手重构无关模块。
- 用户未要求不要加大量 README；协议与功能说明已在 `docs/`。
- 测试：锁、合并、看板索引必须有单测（mock S3）。

## 完成后

更新 `docs/FEATURES.json` 与必要时 `docs/FEATURES.md` 勾选状态，使其一致。
