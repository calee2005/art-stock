# F05 同步策略

## 目标

本地是缓存。用户可钉选资料库、文件夹或单文件以保留原件；默认同步元数据+缩略图；可暂停同步；可清理未钉选缓存。**所有上传必须经全局写锁。**

## 本机模型

```ts
type Pin = { scope: "library" | "folder" | "object" | "asset"; id: string }
type SyncState = {
  paused: boolean
  queue: QueueItem[]          // 未提交变更
  lastCursor: Record<string, string>  // remoteId → 已消费 oplog HLC
}
```

Pin **不上 S3**，每台设备自己的。

## 行为

1. **拉**：无锁。拉取 manifest、树、object meta、缩略图、oplog。
2. **推**：`withRemoteLock(remote, "sync"|"upload")`。合并 → PUT blob/meta/oplog → 可选写 eink summary → 释放。
3. **暂停**：不推不拉（用户仍可只读已缓存）。
4. **按需取回**：打开未缓存原文件时 GET blob，可选「同时钉选」。
5. **仅 Wi-Fi 下载原文件**：Pad 默认建议开启，桌面可选。
6. **清理**：删除未钉选原文件，保留 meta/thumb。

队列在本地 SQLite/IDB，崩溃不丢。

获锁失败：指数退避，UI 显示占用者 `deviceName` 与剩余 TTL。见协议 §4。

## UI

- 状态栏：同步中 / 暂停 / 锁等待 / 离线待提交条数。
- 库与文件夹右键「钉选 / 取消钉选 / 立即同步」。
- 缓存占用数字 + 「清理未钉选」。
- 锁等待可展开看 lock.json 摘要（deviceName、purpose、expiresAt）。强制解锁走确认框。

## 验收

- 未钉选库：本地无原图，有缩略图；钉选后原图出现。
- 暂停期间远端被另一端更新，恢复后能拉到。
- 上传过程中可观察到锁文件存在，结束后消失（或 TTL 内心跳）。
- 模拟锁占用：本机不盲写，队列增长。
- 清理后未钉选原文件消失，文件仍能从远端打开。

## 非目标

- 部分文件块级 rsync。
- 后台在 Android 上不受限制地常驻（见 Pad 设计）。
