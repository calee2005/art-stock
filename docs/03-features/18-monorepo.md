# F18 Monorepo 与构建

## 目标

pnpm workspace + Turbo 管 TS 应用；Cargo workspace 管 Rust；固件独立 ESP-IDF。Agent 能按包边界改代码而不破坏其它端。

## 仓库布局

见 [架构 §3](../01-architecture.md)。根目录：

- `package.json` / `pnpm-workspace.yaml`：`packages/*`、`apps/web`、`apps/desktop`
- `turbo.json`：`build` `lint` `test` `dev`
- `Cargo.toml` workspace：`apps/desktop/src-tauri`、`crates/native`
- `apps/eink`：**不**加入 pnpm；文档说明 IDF 构建
- `.gitignore`：密钥、`target/`、`node_modules/`、IDF 构建目录、本地 `.env`

## 脚本（约定名）

| 命令 | 作用 |
| --- | --- |
| `pnpm dev:web` | Vite |
| `pnpm dev:desktop` | Tauri dev |
| `pnpm build:web` | Pages 产物 |
| `pnpm test` | core 单测（锁、合并、看板索引） |
| `pnpm lint` | |

固件：`apps/eink/firmware` 内 `idf.py build flash monitor`（以上游为准）。

Android：`cd apps/desktop && pnpm exec tauri android init --ci`（工程在 `src-tauri/gen/android`）；`pnpm exec tauri android build --debug --target x86_64 --apk --ci`。JDK 21、NDK 27.2.12479018、SDK 34/36。

## CI

- PR：lint + `packages/core` 测试 + web 构建。
- Pages：main 上部署 web。
- 固件与 Android 不强制每 PR 编过（工具链重），但文档给出本地命令。

## 验收

- 新 clone 按文档能 `pnpm i` 后启动 web。
- core 测试覆盖：锁状态机（可用 mock S3）、冲突分支命名、kanban index 派生。
- 工作区不会把 `apps/eink/server` 的 Python 当成 Node 包误装。

## 非目标

- 把 IDF 塞进 Turbo。
- 单一巨型前端包（必须拆 core/ui/s3）。
