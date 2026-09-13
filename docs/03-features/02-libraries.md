# F02 资料库与文件夹

## 目标

用户可创建多个资料库；库内多层文件夹；文件夹与文件均可打标签；文件类型包括画稿、PDF、音视频、Markdown、思维导图、数据表及普通二进制。

## 对象模型

S3：

- `libraries/{libId}/meta.json`：`{ id, name, tags[], createdAt, updatedAt }`
- `libraries/{libId}/tree.json`：节点数组或 map：

```ts
type TreeNode = {
  id: string
  parentId: string | null
  kind: "folder" | "file"
  name: string
  objectId?: string        // kind=file 时指向 objects/{id}
  tags: string[]
  updatedAt: string
  order: number
}
```

- 文件实体：`objects/{objectId}/meta.json` 等，见协议 §3。

根文件夹 `parentId = null`。禁止环：应用 op 前检测。

标签是 OR-Set，合并规则见协议 §6。

## UI

- 侧栏资料库列表；主区为树或网格（可切换）。
- 创建库、重命名、归档（归档后默认隐藏）。
- 文件夹：新建、重命名、拖拽移动、标签编辑。
- 文件：导入（桌面拖拽 / Pad 分享 / Web 选择器）、打开（按 type 分发给内置或插件编辑器）、标签、定位到素材库引用（若有）。
- 空状态：引导创建第一个库并导入文件。

桌面与 Pad 布局差异见 [16-android-pad](16-android-pad.md)。

## 同步

- `tree.json` 与 object meta 的变更进本地队列，上线后持锁提交。
- 默认同步整库**元数据**；原文件按 Pin。见 [05-sync](05-sync.md)。
- 删除：首版软删 `deletedAt`，树中隐藏；blob 不立即删（避免他端未同步）。物理 GC 后置。

## 验收

- 可建 ≥2 个库，三层文件夹，导入若干不同类型文件，标签可检索。
- 一端建文件夹，另一端同步后树一致。
- 离线新建文件，上线后出现在远端且带锁日志（探测 lock 心跳）。
- 移动文件夹不丢子节点、不产生环。

## 非目标

- 资料库级多人 ACL。
- 跨库硬链接同一 object（可复制或引用素材库）。
