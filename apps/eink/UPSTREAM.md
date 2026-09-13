# 上游固件来源

Art Stock 墨水屏固件来自 subtree，**不是**从空白 ESP-IDF 重写。

| 项 | 值 |
| --- | --- |
| 来源 | https://github.com/calee2005/youn-ink-fourcolor-firmware |
| 默认分支 | `2bp` |
| 纳入方式 | `git subtree add --prefix=apps/eink <url> 2bp --squash` |
| 首次纳入日期 | 2026-09-14 |
| 首次纳入上游提交 | `51812e4`（squash 记录在 `119a9e6`） |
| 本地对照（非来源） | `D:\Projects\youn-ink-fourcolor-firmware` |

## 更新（subtree pull）

在仓库根目录：

```text
git fetch https://github.com/calee2005/youn-ink-fourcolor-firmware.git 2bp
git subtree pull --prefix=apps/eink https://github.com/calee2005/youn-ink-fourcolor-firmware.git 2bp --squash
```

## 构建与刷机

固件在 `apps/eink/firmware/`，独立 ESP-IDF（不进 pnpm/Turbo）。需要 IDF **≥ 5.4.0**。本机约定 IDF 源码为 **`C:\esp\v6.0.3\esp-idf\`**（`tools/cmake/version.cmake` 确认 `6.0.3`）。优先读环境变量 `IDF_PATH`；未设置时构建脚本回退到该路径。不要使用 `C:\Users\calee\esp\v5.4.2` 或其它 v5.x。

本机由 EIM 安装：工具链在 `C:\Espressif\tools`（`IDF_TOOLS_PATH`），Python venv 在 `C:\Espressif\tools\python\v6.0.3\venv`。单独执行 `. C:\esp\v6.0.3\esp-idf\export.ps1` 会误找 `%USERPROFILE%\.espressif` 的 v5 布局并失败。应先激活 EIM profile：

```powershell
. C:\Espressif\tools\Microsoft.v6.0.3.PowerShell_profile.ps1
cd apps/eink/firmware
idf.py set-target esp32s3
idf.py -p COM3 build flash monitor
```

或：

```powershell
cd apps/eink/firmware
.\build_windows.ps1
```

默认板型 `zectrix-s3-epaper-4.2`，四色 `CONFIG_ZECTRIX_EPD_PANEL_4COLOR_SSD2683=y`。主 UI 为 RawDraw（见 `firmware/main/rawdraw/` 与 `ui/rawdraw_ui_manager.cc`）。

## 保留约定

- **必须保留：** `firmware/`、`firmware/main/boards/zectrix-s3-epaper-4.2`、EPD/SSD2683、RawDraw、NVS Settings、WiFi、刷屏、分区表、`sdkconfig.defaults*`。
- **保留但 art-stock 不启动：** 上游 `server/`（Python 语音/TTS）。本快照的 `2bp` 分支**没有** `frontend/` 目录；未删除任何上游目录。
- **禁止：** 新建平行 `apps/firmware`；未亮屏前删驱动或换 UI 框架。
- 固件只 GET `device/eink/config.json` 与 `summary.json`，不持写锁、不 List 全桶（F-082）。

构建产物 `firmware/build/`、`firmware/managed_components/`、`firmware/sdkconfig` 已由上游 `.gitignore` 排除。
