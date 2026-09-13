# 存储与同步协议

本文是多端契约。实现以 `packages/core` 为准。相关：[架构](01-architecture.md) · [冲突 UI](03-features/11-conflicts.md) · [同步](03-features/05-sync.md) · [远端](03-features/01-remotes.md)

`schemaVersion` 当前为 **1**。不兼容变更必须升版本并写迁移。

## 1. 术语

| 词 | 含义 |
| --- | --- |
| prefix | 用户配置的**桶内全局根**，默认空字符串（桶根）。例：`art/`、`home/stock/`。规范化后非空必以 `/` 结尾 |
| protocolRoot | 固定为 `{prefix}.artstock/v1/`。协议对象（manifest、锁、blob、库、看板）全部在此目录下，**不是**远端配置里的 prefix 字段本身 |
| blob | 按 SHA-256 寻址的不可变字节 |
| object | 逻辑文件（画稿、文稿等），有 id、分支、快照 |
| oplog | 追加型操作记录 |
| HLC | Hybrid Logical Clock：物理时间 + 逻辑计数 + deviceId |
| fencingToken | 锁世代号，防迟写 |

所有 JSON 使用 UTF-8，键名 **camelCase**。时间一律 ISO-8601 UTC。

## 2. 对象布局

完整对象键 = `{prefix}` + `.artstock/v1/` + 相对路径。`prefix` 由远端配置提供；`.artstock/v1/` 由协议固定，客户端不可改。

例：`prefix = "art/"` → 锁在 `art/.artstock/v1/lock.json`。  
例：`prefix = ""` → 锁在 `.artstock/v1/lock.json`。

`prefix` 之下、协议根之外的键（如 `art/其它备份.zip`）**不属于** Art Stock，不得读取当库文件，也不得纳入写锁范围。

```text
{prefix}.artstock/v1/
  manifest.json
  lock.json
  blobs/{sha256}                          # 小写 hex，无扩展名
  objects/{objectId}/meta.json
  objects/{objectId}/branches/{branch}.json
  objects/{objectId}/snapshots/{snapId}.json
  libraries/{libId}/meta.json
  libraries/{libId}/tree.json
  assets/index.json                       # 可按 hash 分片，见 §8
  assets/items/{assetId}/meta.json
  settings/vision-tag.json                # 视觉打标签策略与提示词，不含 API Key
  kanban/index.json
  kanban/workspaces/{workspaceId}/meta.json
  kanban/boards/{boardId}/meta.json
  kanban/boards/{boardId}/lists/{listId}.json
  kanban/items/{itemId}.json
  oplog/{yyyy}/{hlc}-{deviceId}.json
  device/eink/config.json
  device/eink/summary.json
  clocks/{deviceId}.json
```

实现必须用同一套 `objectKey(prefix, relative)`，禁止把 `.artstock/v1` 写进 `RemoteConfig.prefix` 的默认值。

`objectId` / `libId` / `workspaceId` 等为 UUID v4（无花括号、小写）。

blob 一旦 PUT 成功视为不可变。相同内容只存一份，快照只引用 hash。

## 3. 核心 JSON 形状

### 3.1 `manifest.json`

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-09-13T12:00:00.000Z",
  "updatedBy": "device-uuid",
  "libraries": [{ "id": "...", "name": "角色设定", "updatedAt": "..." }],
  "assetLibrary": { "id": "global", "updatedAt": "..." },
  "kanbanIndex": "kanban/index.json"
}
```

### 3.2 逻辑对象 `objects/{id}/meta.json`

```json
{
  "schemaVersion": 1,
  "id": "...",
  "libraryId": "...",
  "parentFolderId": "...",
  "name": "主角-立绘.clip",
  "type": "artwork",
  "tags": ["角色", "立绘"],
  "createdAt": "...",
  "updatedAt": "...",
  "defaultBranch": "main"
}
```

`type` 枚举（可被插件扩展）：`artwork` | `markdown` | `pdf` | `audio` | `video` | `mindmap` | `database` | `binary` | `folder`（文件夹也可作节点，见资料库设计）。

### 3.3 分支与快照

`branches/{name}.json`：

```json
{
  "name": "main",
  "snapshotId": "...",
  "updatedAt": "...",
  "updatedBy": "device-uuid"
}
```

分支名：`main` 为默认；用户分支 `[A-Za-z0-9._/-]+`，长度 ≤ 64。冲突分支前缀 `conflict/`。

`snapshots/{snapId}.json`：

```json
{
  "id": "...",
  "parentSnapshotId": null,
  "branch": "main",
  "blobSha256": "...",
  "byteSize": 12345,
  "mimeType": "application/octet-stream",
  "message": "auto-save",
  "createdAt": "...",
  "createdBy": "device-uuid"
}
```

不做二进制 diff。回滚 = 把分支指针改到历史 snapshotId（持锁写入）。

### 3.4 HLC

```json
{ "ts": 1780000000000, "c": 3, "deviceId": "..." }
```

比较：先 `ts`，再 `c`，再 `deviceId` 字典序。每个设备在 `clocks/{deviceId}.json` 写入自己见过的最大 HLC，便于合并。

## 4. 全局写锁

路径：`{prefix}.artstock/v1/lock.json`。每个远端（每个 protocolRoot）一把，不是每库/每文件一把。

**未持锁不得** 对该 **protocolRoot**（`{prefix}.artstock/v1/`）下任何对象做 PUT、DELETE、POST、multipart。不要去锁整个 bucket，也不要锁 `prefix` 下与 `.artstock` 无关的键。GET / HEAD / List **不加锁**。

### 4.1 锁文档

```json
{
  "schemaVersion": 1,
  "fencingToken": 42,
  "deviceId": "...",
  "deviceName": "studio-pc",
  "purpose": "sync",
  "acquiredAt": "2026-09-13T12:00:00.000Z",
  "heartbeatAt": "2026-09-13T12:00:00.000Z",
  "expiresAt": "2026-09-13T12:01:00.000Z"
}
```

`purpose`：`sync` | `upload` | `replicate` | `eink-summary` | `force-unlock`。

默认 TTL **60s**，心跳间隔 **20s**。

### 4.2 获取

1. `PutObject` 完整键 `{prefix}.artstock/v1/lock.json`，仅当对象不存在：
   - AWS / MinIO：`If-None-Match: *`
   - 阿里云 OSS：`x-oss-forbid-overwrite: true`
2. 成功 → 本设备为持有者，记下返回 ETag 与 `fencingToken`。
3. 失败（对象已存在）→ GET 锁体。
   - 若 `now <= expiresAt`：返回 `REMOTE_LOCK_HELD`，不得覆盖。
   - 若 `now > expiresAt`：用当前 ETag `If-Match` PUT 新锁，`fencingToken = old + 1`。冲突则重试从步骤 1。

### 4.3 心跳

持锁期间周期性 PUT 同一文档，更新 `heartbeatAt` / `expiresAt`，**必须** `If-Match` 自己的 ETag。失败 = 丢锁，中止后续写，错误 `REMOTE_LOCK_LOST`。

若 GET 到的 `fencingToken` 大于本地持有值，立即中止（防过期被抢后的迟写）。

### 4.4 释放

`DeleteObject` + `If-Match` 自己的 ETag。失败依赖 TTL。`withRemoteLock()` 必须 `try/finally` 尽力释放。

### 4.5 强制解锁

仅当锁已过期，或用户在 UI 明确确认。新锁 `purpose: "force-unlock"`，并追加 oplog 审计条目。不得做成默认按钮。

### 4.6 不合格远端

连通性检查必须探测条件写（对探测 key 或锁路径）。不支持则 `REMOTE_UNSUPPORTED`，**禁止静默无锁写入**。

### 4.7 API（规范实现）

```ts
withRemoteLock(remote, purpose, fn: (ctx: { fencingToken: number }) => Promise<T>): Promise<T>
```

桌面 / Pad / Web / MCP **只许** 调用该函数，禁止自行 PUT `lock.json`。

### 4.8 多远端取锁顺序

同时持有多个远端的锁时，按 `remoteId` 字符串字典序依次获取，逆序释放，避免死锁。

## 5. oplog

每次持锁提交的变更写成一条或多条不可变记录：

`oplog/{yyyy}/{hlc}-{deviceId}.json`

```json
{
  "schemaVersion": 1,
  "hlc": { "ts": 1, "c": 0, "deviceId": "..." },
  "deviceId": "...",
  "ops": [
    { "op": "put", "key": "objects/xxx/meta.json", "blobSha256": "..." },
    { "op": "upsert", "entity": "kanban.item", "id": "...", "fields": { "title": "..." } },
    { "op": "add", "entity": "tag", "target": "object:xxx", "value": "角色" }
  ]
}
```

客户端启动同步时：列出自己未见过的 oplog（可按年前缀 + 本地已消费 HLC 游标）→ 应用到本地索引 → 再把自己的队列变成新 oplog 并 PUT 实体对象。

压缩：持锁后可写新的 `manifest.json` / `kanban/index.json` / `assets/index.json` 快照，但不删除近期 oplog（至少保留 30 天或 1000 条，具体在实现中可配置，默认 30 天）。

## 6. 合并规则（锁内语义）

锁只保证同一时刻一个写入者。两台设备离线各自改完再同步，仍可能分叉。

| 数据 | 规则 |
| --- | --- |
| 标量（名称、描述、默认分支名） | HLC LWW |
| 集合（标签） | OR-Set：增加与删除带 HLC，删除胜于更早的增加 |
| blob 内容 | 永不覆盖已有 sha；新内容新 snapshot |
| 同一分支上两个不同 parent 的新 snapshot | 不快进；创建 `conflict/{deviceId}-{hlc}` 指向本地 snapshot，原分支保留远端；UI 必提示 |
| 看板 Item 字段 | LWW；`listId`+`order` 视为标量 |
| 树节点父子关系 | LWW；若出现环，拒绝本地该 op 并标记冲突 |

第二道保险：覆盖 `manifest.json`、`tree.json`、锁以外的可变 JSON 时尽量带 `If-Match`。ETag 不匹配则重新 GET 合并，不得盲写。

## 7. 本地缓存

| 端 | 元数据/索引 | 缩略图 | 原文件 |
| --- | --- | --- | --- |
| Desktop | SQLite | 应用缓存目录 | 钉选目录不过期；未钉选 LRU |
| Android | 沙箱 SQLite | 可回收缓存 vs 钉选目录 | 同左；可选 SAF |
| Web | IndexedDB + MiniSearch | OPFS | 尽量不缓存大文件，点开再拉 |

缓存可删。索引必须能从远端元数据+oplog 重建。

Pin 粒度：资料库、文件夹、单个 object/asset。Pin 状态是 **本机配置**，不上 S3（各设备钉选范围可以不同）。

## 8. 素材库索引

`assets/index.json` 在条目很多时可分片：`assets/index/shards/{00-ff}.json`，`manifest` 指向分片表。首版可以单文件，超过 5MB 再分片。条目本身在 `assets/items/{id}/meta.json`，缩略图建议 `assets/items/{id}/thumb.webp`（可变，持锁更新）。

## 9. 看板索引

`kanban/index.json`：workspace 列表及每个 workspace 下的 board id 列表，供侧栏与 eink summary 使用。完整 List/Item 不塞进 index。

## 10. 墨水屏对象

### 10.1 `device/eink/config.json`

由客户端持锁写入，固件只读。

```json
{
  "schemaVersion": 1,
  "refreshIntervalMinutes": 120,
  "todo": {
    "workspaceId": "...",
    "boardId": null,
    "listNames": ["待办", "进行中"],
    "maxItems": 8
  }
}
```

### 10.2 `device/eink/summary.json`

```json
{
  "schemaVersion": 1,
  "generatedAt": "...",
  "generatedBy": "device-uuid",
  "libraryCount": 4,
  "recentFiles": [
    { "name": "主角-立绘.clip", "libraryName": "角色设定", "updatedAt": "..." }
  ],
  "todos": [
    { "title": "修手部结构", "dueAt": null, "boardName": "当前项目" }
  ]
}
```

体积目标 < 32KB。不含密钥、不含原图。

生成时机：任何成功的写同步结束时，若本机配置了「更新墨水屏摘要」且能写该远端。

## 11. 复制与副本跟踪

对象元数据可含：

```json
"replicas": { "nas-home": "ok", "oss-aliyun": "pending" }
```

值为 `ok` | `pending` | `missing`。桥接客户端持两把锁（按序）后把 `pending` blob 拷过去并更新该字段。

## 12. CORS 最低要求（GitHub Pages）

允许来源：Pages 源站。方法：`GET, HEAD, PUT, DELETE, POST`。Headers 至少：

`Authorization, Content-Type, If-Match, If-None-Match, x-oss-forbid-overwrite, x-amz-content-sha256, x-amz-date, x-amz-security-token`

Expose：`ETag`。

## 13. 设备身份

每端首次启动生成 `deviceId`（UUID）与 `deviceName`（可改），存在本机。写入锁、快照、oplog 都带此 id。
