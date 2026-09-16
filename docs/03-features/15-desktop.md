# F15 桌面端原生

Windows / macOS。与 Pad 共用 Tauri 工程，本文件只描述 **desktop cfg** 能力。

## 目标

文件监视（自动快照）、Rust 缩略图与哈希、OS 安全存密钥、拖拽导入、SQLite FTS、大文件 multipart、可选桥接 NAS↔OSS。

## 原生 command（示意）

| command | 作用 |
| --- | --- |
| `secure_store_set/get` | 密钥 |
| `watch_start/stop` | 监视路径，事件回 webview |
| `thumb_generate` | 本地出 webp |
| `hash_file` | SHA-256 流式 |
| `cache_put/get` | 应用数据目录 |
| `sqlite_query` | FTS 检索 |
| `s3_put_multipart` | 大文件，仍由 core 决定 key 与是否已持锁 |

持锁状态在 TS core；Rust 不做锁协议。

## UI

- 壳见 [架构 §7](../01-architecture.md)：左侧图标轨 + 总览/工作区/素材库/看板；配置为齿轮模态。
- 系统拖拽到窗口导入资料库或素材库。
- 监视列表：绑定 artwork object ↔ 本地路径。
- 托盘非必须（首版可无）。

## 验收

- 保存被监视文件 → 自动 snapshot（防抖）。
- 拖入图片进入素材库并出缩略图。
- 密钥不在明文配置文件。
- 大于 multipart 阈值的文件上传成功且期间锁有心跳。

## 非目标

- Windows 资源管理器扩展。
- macOS Finder 同步文件夹伪装成 iCloud。
