# F17 墨水屏固件

四色墨水屏展示资料库摘要与看板待办。刷新一屏 ≥10s，默认 **120 分钟** 一次。配置可远程改。

**禁止从空白 ESP-IDF 重写。** 必须先纳入已能启动的上游工程。

## 上游初始化

- 仓库：https://github.com/calee2005/youn-ink-fourcolor-firmware
- 纳入：`git subtree add --prefix=apps/eink <url> <default-branch> --squash`
- 写 `apps/eink/UPSTREAM.md`：来源 URL、分支、日期、`subtree pull` 命令
- 用 subtree 不用 submodule，便于 Agent 在本仓库改固件
- 本地 `D:\Projects\youn-ink-fourcolor-firmware` 仅对照，**纳入来源是 GitHub**

### 第一项任务 F-eink-bootstrap

按上游 README 配 ESP-IDF、编译、刷入 ZecTrix ESP32-S3 4.2 寸四色屏。

验收：RawDraw 主界面亮屏；WiFi / 设置页可进。

**未通过前：** 不得删驱动、不得换 UI 框架、不得「简化重写」平行工程。

## 保留 / 停用 / 新增

**必须保留：** `firmware/`、`boards/zectrix-s3-epaper-4.2`、EPD/SSD2683、RawDraw、NVS Settings、WiFi、刷屏/局刷、分区表、sdkconfig 基线。

**保留但本产品不启动：** 上游 `server/`（Python 语音/TTS）、`frontend/`。不要删。构建说明写清 art-stock 不依赖它们。

**启动成功后新增：**

1. S3 兼容 **GET**（禁止 List 全桶）：`device/eink/config.json`、`device/eink/summary.json`
2. NVS 登记多个远端（endpoint、bucket、**全局 prefix**、密钥、path-style）。GET 的 key 为 `{prefix}.artstock/v1/device/eink/config.json` 与 `summary.json`，prefix 含义与桌面相同，不要把 `.artstock/v1` 填进 prefix
3. 应用 config：`refreshIntervalMinutes`（默认 120）
4. 页面：库数量、最近文件、看板待办（数据来自 summary，不是本地算全桶）
5. 周期：休眠 → 唤醒 → 拉 config+summary → 全刷 → 再睡
6. 沿用 400x300 与四色 theme token，只加 RawDraw 页面/renderer

固件 **不持写锁、不 PUT**。summary 由桌面/Pad/Web 持锁写入。

## 远程配置

用户在客户端改刷新间隔、待办来源 Workspace/Board/List 名称，持锁 PUT `config.json`。设备下一周期 GET 即生效。NVS 可缓存上次成功 config，网络失败仍显示旧 summary。

## Agent 约束

- 不得新建 `apps/firmware` 平行工程
- 「清理无用代码」必须在刷机验证之后，单独任务，默认不删
- 改 UI 只用 RawDraw，不用 LVGL 替换主路径

## 验收

1. Bootstrap：上游功能能启动。
2. 配一个 OSS 远端（设备端），桶上放好 summary，两小时逻辑可用「设置里临时改成数分钟」验证刷新。
3. 断网：显示缓存摘要，不崩溃。
4. summary 不含密钥（固件日志脱敏）。

## 非目标

- 语音、TTS、聊天、天气（上游有也不在 art-stock 主路径依赖）。
- 在屏上编辑看板。
- 把 JPG 当 summary（只 JSON 文本页；相册推送不是本功能）。
