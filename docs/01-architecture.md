# 架构文档

| 相关 | [概要](00-overview.md) · [存储协议](02-storage-protocol.md) · [路线图](04-roadmap.md) |
| --- | --- |

## 1. 设计原则

1. **协议在对象上，不在服务器上。** S3 布局、锁、oplog 就是多端契约。
2. **TypeScript `packages/core` 是规范实现。** 桌面/Pad 的 Rust 只做 I/O 加速与系统集成，不另搞一套合并算法。
3. **本地是缓存。** 任何端都可以清空本地后从远端重建元数据索引。
4. **写入必须持锁。** 所有 PUT/DELETE/multipart 走 `withRemoteLock()`。
5. **能力按端降级，不按端分叉协议。** Pad 没有文件监视，但快照对象格式与桌面相同。

## 2. 逻辑架构

```text
┌─────────────────────────────────────────────────────────────┐
│  apps/web          apps/desktop (Win/macOS/Android)         │
│  packages/ui （React 壳：Desktop shell / Tablet shell）      │
│  packages/mcp （仅桌面进程）                                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    packages/core
                    packages/s3
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
           NAS S3       OSS S3     （只读 GET）
                                        │
                                        ▼
                                  apps/eink
```

## 3. Monorepo 目标结构

实现阶段再建仓库，但包边界现在锁定：

```text
art-stock/
  AGENTS.md
  docs/
  packages/
    core/          # 对象键、锁、oplog 合并、类型、索引派生
    s3/            # S3 适配：path-style、OSS/MinIO、条件写
    ui/            # 共享 React 组件、路由壳、设计 token
    mcp/           # stdio MCP Server，调用 core
  apps/
    web/           # Vite SPA → GitHub Pages
    desktop/       # Tauri 2；同一工程出 Win / macOS / Android
    eink/          # subtree：youn-ink-fourcolor-firmware
  crates/
    native/        # 缩略图、文件监视、安全存储、SQLite、multipart
```

### 3.1 为什么 core 用 TypeScript

Web 必须在浏览器里跑完整协议（含锁）。若规范实现在 Rust，还要再编一份 WASM 并保证行为一致。TS 一套代码覆盖 Web、Tauri webview、MCP。

Rust（`crates/native`）负责：

- 系统钥匙串 / Android Keystore
- 桌面文件监视（notify）
- 缩略图与哈希（大图）
- SQLite FTS 本地索引
- 大文件 multipart 与磁盘缓存路径

Rust 调用的「该写哪个 key、锁的 JSON 长什么样」仍以 core 的类型与函数为准。桌面可以把 core 跑在 webview，通过 IPC 把 `putObject(key, bytes, { ifMatch })` 交给 Rust。

### 3.2 Tauri 工程

- `src-tauri/src/main.rs` 只做薄入口。
- 全部 command / state 在 `lib.rs`，并使用 `#[cfg_attr(mobile, tauri::mobile_entry_point)]`。
- 权限：`capabilities/desktop.json` 与 `capabilities/mobile.json` 分开。
- Android 工程：`src-tauri/gen/android`。

### 3.3 墨水屏

`apps/eink` 是上游固件的完整树，不与 TS 包链接。契约只有两个小对象：`device/eink/config.json` 与 `device/eink/summary.json`。详见 [03-features/17-eink.md](03-features/17-eink.md)。

## 4. 技术栈

| 层 | 选择 |
| --- | --- |
| 语言 | TypeScript（协议与 UI）、Rust（原生）、C++/ESP-IDF（固件） |
| UI | React + 共享 `packages/ui` |
| 桌面/Pad | Tauri 2 |
| Web | Vite，静态部署 GitHub Pages |
| 本地索引 | 桌面/Pad：SQLite FTS；Web：MiniSearch + OPFS/IndexedDB |
| 对象存储 | S3 兼容 API |
| 固件 UI | 上游 RawDraw，400x300 四色 BWRY |
| 包管理 | pnpm workspace + Turbo；Cargo workspace；固件独立 IDF |

## 5. 关键数据流

### 5.1 浏览（读）

1. 客户端用已存凭证列出/读取 `{prefix}.artstock/v1/manifest.json`（无锁）。`prefix` 是远端配置的桶内全局根，可空。
2. 拉取元数据与缩略图到本地缓存。
3. 用户打开原文件时按 Pin 策略 GET blob。

### 5.2 变更（写）

1. 先写入本地缓存与待同步队列（可离线）。
2. 上线后 `withRemoteLock(remote)`：
   - 条件 PUT `lock.json`
   - 拉 oplog / 索引，与本地队列合并（LWW / OR-Set / 冲突分支）
   - PUT blobs 与元数据（持锁 + 心跳）
   - 可选更新 `device/eink/summary.json`
   - 条件 DELETE 锁
3. 获锁失败：队列保留，UI 提示占用者与 TTL，指数退避。

### 5.3 多远端复制

能同时访问两个远端的客户端按 `remoteId` 字典序取锁，再复制缺失 blob/对象。外出只有 OSS 时只写 OSS；回家后桌面补 NAS。

### 5.4 墨水屏

固件定时唤醒 → GET config → GET summary → 全刷 → 休眠。不 List、不写、不抢锁。

## 6. 平台能力矩阵

| 能力 | Web | Desktop | Android Pad | Eink | MCP |
| --- | --- | --- | --- | --- | --- |
| 配置远端 / 读对象 | 是 | 是 | 是 | 仅 config+summary | 是 |
| 写对象（经锁） | 是 | 是 | 是 | 否 | 是 |
| 元数据+缩略图缓存 | OPFS/IDB | 应用目录+SQLite | 沙箱+SQLite | 无 | 用桌面缓存 |
| 钉选原文件 | 受配额限制 | 是 | 是（沙箱/SAF） | 否 | 否 |
| 文件监视自动快照 | 否 | 是 | 收件箱扫描 | 否 | 否 |
| 拖拽导入 | 有限 | 是 | 分享/选择器 | 否 | 否 |
| 缩略图生成 | Canvas（小图） | Rust | Rust | 否 | 否 |
| 密钥存储 | 浏览器存储（有 XSS 风险，需提示） | OS 安全存储 | Keystore | NVS | 读桌面已存凭证 |
| Markdown / PDF / 思维导图 | 是 | 是 | 是（触控） | 否 | 读写 MD 文本 |
| 看板四层 | 是 | 是 | 是 | 只显示待办摘要 | 是 |
| 多维表 | 基本 | 完整体验 | 查看+行编辑 | 否 | 后置 |
| 插件（任意文件类型） | 沙箱/降级 | 是 | 仅内置类型 | 否 | 否 |
| MCP Server | 否 | 是 | 否 | 否 | 自身 |
| 写 eink summary | 是 | 是 | 是 | 否 | 可 |

## 7. UI 壳

`packages/ui` 提供两套壳，业务页面同一套。视觉以深色桌面原型为准（圆角卡片、窄图标轨）。

主导航四项 + 独立配置入口（齿轮，不是第五个业务页）：

| id | 文案 | 主区 |
| --- | --- | --- |
| `overview` | 总览 | 资料库/素材库计数、远端卡片、活动热力图、事件时间线 |
| `library` | 工作区 | 左：资料库下拉 + 文件夹树；中：画稿快照 DAG；右：预览与「上传新版本 / 创建分支」 |
| `assets` | 素材库 | 左：智能文件夹 + 文件夹树 + 标签；右：格式筛选、检索、缩略图网格 |
| `kanban` | 看板 | 顶栏 Workspace 下拉；横向 List 列；列底快速添加 Item；右侧 + 新增 List |

配置为模态：左侧树（基本 / 资料库 / 通用），右侧表单。远端、视觉模型、墨水屏摘要、CORS 说明都进该模态，不占主导航。

- **Desktop shell**：左侧窄图标轨（上四项、底齿轮）+ 主区。
- **Tablet shell**：横屏同一图标轨；竖屏底栏四项导航，配置入口仍可用；触控热区 ≥ 44px；看板 Board 内横向滑列，Item 全屏详情。`data-nav` 仍用上表 id（工作区为 `library`，兼容 Pad 既有选择器）。

Web 宽屏用 Desktop shell，窄屏用 Tablet shell。

## 8. 安全

- 密钥不上 Git、不进 Pages 构建产物、不进 eink summary。
- 文档要求：RAM/子账号 + 最小策略，建议只授 `{prefix}.artstock/v1/*`，不是整个 bucket。`prefix` 是用户填的全局根。
- Web：密钥在浏览器，XSS 即可被盗。CSP 收紧；提示用户不要在不可信扩展下使用；优先短期密钥。
- GitHub Pages 源站必须出现在 bucket CORS 里，且放行锁所需条件头：`If-Match`、`If-None-Match`、`x-oss-forbid-overwrite`，方法含 PUT/DELETE。
- 桌面走 OS 凭证库；Android 走 Keystore。
- 固件密钥在 NVS；丢失设备需在 OSS/NAS 轮换密钥。
- 只读远端配置：永不取锁、永不写。

## 9. 错误与可观测性

core 统一错误码，UI 映射文案：

| 码 | 含义 |
| --- | --- |
| `REMOTE_LOCK_HELD` | 锁被其他设备持有 |
| `REMOTE_LOCK_LOST` | 心跳失败或 fencingToken 已变 |
| `REMOTE_UNSUPPORTED` | 条件写探测失败，不合格远端 |
| `CONFLICT_BRANCH` | 已创建冲突分支，需用户处理 |
| `CACHE_MISS` | 原文件未钉选且离线 |

桌面可写本地诊断日志（不含密钥）。固件写串口日志。

## 10. 构建与 CI 边界

- 应用与协议：pnpm + Turbo；Rust clippy/test。
- 固件：ESP-IDF，不并入 Turbo 默认流水线；文档单独说明刷机。
- Pages：只构建 `apps/web`。
- Android：需 JDK / SDK / NDK / `aarch64-linux-android` target，版本写在 [03-features/16-android-pad.md](03-features/16-android-pad.md) 与 [18-monorepo.md](03-features/18-monorepo.md)。
