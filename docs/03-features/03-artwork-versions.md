# F03 画稿版本与分支

## 目标

一个画稿可有多个方向：不可变快照 + 命名分支。用户可：

- 配置监听文件变化，每次保存自动产生快照；或关闭自动、仅手动 commit。
- 手动创建分支、切换分支、回滚到历史快照。

不做二进制 diff，不做 Git 协议。

## 对象模型

见协议 §3.3。每个 artwork object：

- `defaultBranch`（通常 `main`）
- `branches/{name}.json` → `snapshotId`
- `snapshots/{snapId}.json` → `blobSha256` + `parentSnapshotId`

快照策略（本机，可按 object 覆盖，默认可按库）：

```ts
type SnapshotPolicy = {
  mode: "auto-on-save" | "manual"
  minIntervalMs: number    // 自动模式下防抖，默认 5000
}
```

## UI

- 工作区选中画稿后三栏：左树、中 **快照 DAG**（命名分支标签，如「主线」「尝试A」；当前快照高亮）、右预览。
- 右侧主按钮文案：「上传新版本」（提交快照）、「创建分支」（从当前 snapshot 分出）。其下为图像信息 / 直方图占位（无像素分析时显示空框）。
- 分支下拉、回滚（只改指针不删历史）、冲突横幅仍可用；存在 `conflict/*` 时入口到 [11-conflicts](11-conflicts.md)。
- 策略开关：自动 / 手动，展示于文件页与配置模态。

桌面：监视已打开或已 Pin 的外部文件（如 `.clip` 导出副本）。Pad：无稳定 watch，见 [16-android-pad](16-android-pad.md) 收件箱扫描。

## 同步

- 新 blob 先本地哈希；持锁后 PUT `blobs/{sha}`（已存在则跳过）、再写 snapshot 与 branch 指针。
- 两设备在同一分支各自 commit：后同步者不得快进；创建 `conflict/{deviceId}-{hlc}`，保留远端分支；UI 必提示。
- 自动快照在离线时只落本地队列。

## 验收

- 手动 commit 两次产生两个 snapshot，可切换回滚。
- 自动模式：保存被监视文件后出现新 snapshot（防抖生效，连存不刷爆）。
- 建分支 `alt`，在 alt 上 commit 不影响 main 指针。
- 模拟两端分叉：出现 conflict 分支，原文件不被覆盖。
- 所有相关 PUT 发生在持锁窗口内。

## 非目标

- merge / rebase / cherry-pick 二进制。
- 与系统 Git 互操作。
- 快照内容差异可视化（可后置哈希对比）。
