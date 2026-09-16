# F16 Android Pad（一等端）

Pad 与桌面同等优先级，不是缩小窗口。通勤与外出创作的主设备之一。

## 产品定位

- 单位/路上以 **OSS** 为主；能连 NAS 时也可当桥（少见）。
- 默认元数据 + 缩略图在线；原图按钉选或点开下载。**仅 Wi-Fi 下载原文件** 默认开。
- 主场景：浏览、标注、看板、文稿、素材检索、轻编辑。重型绘画在 CSP 等外部 App；Pad 负责收件、快照、同步。

## 工程形态

- 与桌面共用 `apps/desktop` Tauri 工程。
- `lib.rs`：`#[cfg_attr(mobile, tauri::mobile_entry_point)]`。
- Android 工程：`src-tauri/gen/android`。
- `packages/ui` **Tablet shell**：横屏左侧图标轨（总览 / 工作区 / 素材库 / 看板，底齿轮）+ 内容；竖屏底栏四项 + 全宽；触控热区 ≥ 44px。手写笔 hover/按下能检测则用，否则触摸。`data-nav="library"` 仍指向工作区。
- 权限：`capabilities/mobile.json` 与 desktop 分开。
- 条件编译：`#[cfg(desktop)]` / `#[cfg(mobile)]`。

### 工具链（写入构建说明，实现时锁定版本号）

锁定（F-021 验证环境）：

- JDK 21、Android SDK Platform 34/36、Build-Tools 34.0.0 / 36.0.0
- NDK **27.2.12479018**、CMake 3.22.1、Emulator 37.1.11、platform-tools 37.0.1
- Gradle 8.14.3、Android Gradle Plugin 8.11.0、Kotlin 1.9.25
- `rustup target add aarch64-linux-android x86_64-linux-android`（模拟器 x86_64）
- 命令：`cd apps/desktop && pnpm exec tauri android init --ci`（已生成 `src-tauri/gen/android`）；`pnpm exec tauri android build --debug --target x86_64`

密钥：Android Keystore 中的 AES-GCM 主密钥包装 `secretAccessKey` / `accessKeyId`；SharedPreferences 只存密文，禁止明文裸存。

## 交互与导入

1. **系统分享接收**：其它 App 分享图片/PDF/文件 → 应用「收件箱」→ 用户归档到资料库或素材库。
2. **SAF 授权目录**：用户指定导出收件夹（CSP/ibisPaint 等）。前台扫描新增文件；可手动「刷新收件箱」。**不承诺**桌面级无限 file watch。
3. **用外部应用打开**：把 object 落到临时文件，返回后检测 mtime/hash，按策略 snapshot。
4. 不做：MCP、任意代码插件、托盘、全局拖放监视。

收件箱中的新文件按绑定 object 的 `SnapshotPolicy` 自动或手动 commit。

## 本地存储与同步

- 密钥：Keystore / EncryptedSharedPreferences（Tauri 插件或自写 command）。
- SQLite 在应用沙箱（`getDatabasePath("metadata.db")` / `filesDir/metadata.sqlite`）；缓存目录用系统 `cacheDir`（可被回收）；**钉选目录**为应用私有 `filesDir/pinned/`，`reclaim_cache` 不得删除。
- 后台：遵守 Android 限制；同步在前台，或充电+Wi-Fi 时尽力而为。不承诺常驻监视。
- `deviceId` 独立。写远端走同一把全局锁。
- 冲突与桌面相同；通勤双开走冲突分支。

### 后台尽力同步限制（F-092）

- WorkManager 仅在 **充电 + 非计费网络（Wi-Fi / 以太网）** 时运行；系统最短周期约 15 分钟。
- 后台只把 SAF 授权目录里的新文件拷进应用收件箱，**不**调用 `withRemoteLock()`、不写 OSS、不启动 WebView。
- 持锁上传与 snapshot 只在前台 Pad 扫描（F-045）。未充电、蜂窝、或进程被杀则本周期跳过。
- **不承诺**桌面级无限 file watch 或常驻同步。
- `reclaim_cache` 只清理 `cacheDir`，不得删除 `filesDir/pinned/`。

## 功能可用性

**全量：** 远端配置、资料库浏览/上下载、素材检索、Markdown 轻编辑、PDF 翻页、看板四层、思维导图、冲突处理、钉选、eink summary 写入。

**降级：** 文件监视 → 收件箱扫描；拖拽 → 分享/选择器；插件 → 内置类型；MCP → 无。

**多维表：** 查看与行编辑；复杂筛选桌面更完整。

## 构建与验收

不以「用手机浏览器打开 Pages」代替 Pad 完成。

验收（横屏+竖屏，真机或平板模拟器）：

1. 配置 OSS 密钥（进 Keystore）。
2. 浏览资料库与素材缩略图。
3. 从分享导入一张图到素材库或收件箱。
4. 钉选一文件夹，飞行模式打开已缓存项。
5. 编辑看板 Item 并同步（持锁）。
6. 仅蜂窝网络时原图下载被策略拦住（若开启仅 Wi-Fi）。

## 非目标

- iOS。
- 把 Pad 做成绘画板（无压感绘画引擎）。
- 后台无限同步。
