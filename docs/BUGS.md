# Bug 清单

实现与测试中发现的缺陷。状态：`open` / `fixed`。

当前无未关闭项。完成某 FEATURE 验收后，穿插修复高优先级 Bug，再领取下一项。

| id | 症状 | 复现 | 影响 FEATURE | 状态 |
| --- | --- | --- | --- | --- |
| B-001 | `docs/FEATURES.json` F-081 `notes` 末尾多了一个 `]`，JSON 无法解析 | 打开 FEATURES.json 跑 `JSON.parse` | 任务领取扫描 | fixed |
| B-002 | Pad WebView `invoke(secure_store_*)` SIGABRT：`ndk-context` 未初始化（wry 不调 `initialize_android_context`） | Pixel Tablet API 34 打开 MainActivity 后立刻崩溃 | F-023 | fixed |
| B-003 | `pad_e2e_config` 读 `Context.getDataDir()/pad-e2e.json`，脚本写在 `filesDir`；e2e 静默跳过 | 模拟器有 `files/pad-e2e.json` 但无 status | F-023 | fixed |
