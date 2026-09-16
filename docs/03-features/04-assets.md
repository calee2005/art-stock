# F04 全局素材库

Eagle 核心子集。素材库全局一份，不属于某个资料库；文稿与看板可引用素材。

## 目标

导入图像等素材，管理文件夹、标签、评分，生成缩略图，检索，并在 Markdown / 看板封面中引用。

## 对象模型

```ts
type AssetItem = {
  id: string
  name: string
  folderId: string | null
  tags: string[]
  rating: 0 | 1 | 2 | 3 | 4 | 5
  width?: number
  height?: number
  mimeType: string
  blobSha256: string
  thumbKey: string          // assets/items/{id}/thumb.webp
  sourceObjectId?: string   // 若从资料库文件送入
  createdAt: string
  updatedAt: string
}
```

文件夹树存在 `assets/index.json`（或分片，协议 §8）。

引用格式（Markdown / Item 封面）：`artstock://asset/{id}`。

## UI

- 主导航独立「素材库」页。
- 左栏：智能文件夹（最近 7 天访问、随机 30 张）、文件夹树、标签检索。
- 顶栏：色彩点（有颜色元数据才筛选；无则仅展示）、格式芯片（如 JPG）、文件名检索。
- 主区：缩略图网格，卡片含名称、格式、尺寸。
- 导入：拖拽、选择器、从资料库「添加到素材库」；Pad 收件箱入口放本页左栏底部。
- 详情：大图、标签编辑、打开原文件（按需下载）。
- 插入选择器：供 Markdown / 看板调用。

## 同步

- 默认同步**全部元数据 + 缩略图**，原图按 Pin 或点开再拉（与 IDEA 一致）。
- 缩略图：桌面/Pad 用 Rust 生成后持锁上传；Web 小图可用 Canvas，失败则仅远端有原图、列表显示占位。
- 标签 OR-Set；评分 LWW。

## 验收

- 导入 20+ 张图，缩略图列表可滚动，标签筛选正确。
- 仅缓存元数据+缩略图时，流量/磁盘不含原图；点开后原图可下。
- Markdown 插入素材后预览能显示（已缓存缩略图或临时 GET）。
- 两端打不同标签，同步后集合为并集（未互删时）。

## 非目标

- Eagle 插件生态、智能文件夹完整兼容。
- 以图搜图 / 颜色聚类（可后置）。
- 视频逐帧预览（视频当 binary + 封面帧即可）。
