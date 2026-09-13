# Bug 清单

实现与测试中发现的缺陷。状态：`open` / `fixed`。

当前无未关闭项。完成某 FEATURE 验收后，穿插修复高优先级 Bug，再领取下一项。

| id | 症状 | 复现 | 影响 FEATURE | 状态 |
| --- | --- | --- | --- | --- |
| B-001 | `docs/FEATURES.json` F-081 `notes` 末尾多了一个 `]`，JSON 无法解析 | 打开 FEATURES.json 跑 `JSON.parse` | 任务领取扫描 | fixed |
