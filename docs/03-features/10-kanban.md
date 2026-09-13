# F10 看板（Workspace → Board → List → Item）

看板**不等于资料库**。固定四层。

```text
Workspace
  └── Board
        └── List
              └── Item
```

## 目标

用四层结构管理项目待办；Item 可引用素材与资料库文件；客户端全管理；墨水屏只展示配置范围内的未完成 Item。

## 对象模型

S3 按层拆开，避免改不同卡片导致整板冲突。

### Workspace `kanban/workspaces/{id}/meta.json`

```ts
{
  schemaVersion: 1
  id: string
  name: string
  icon?: string
  color?: string
  order: number
  archivedAt?: string
  linkedLibraryIds?: string[]   // 可选关联，不替代文件树
  updatedAt: string
}
```

### Board `kanban/boards/{id}/meta.json`

```ts
{
  schemaVersion: 1
  id: string
  workspaceId: string           // 仅属于一个 Workspace
  name: string
  background?: string
  labels: { id: string; name: string; color: string }[]
  defaultLibraryId?: string
  starred?: boolean
  archivedAt?: string
  order: number
  updatedAt: string
}
```

### List `kanban/boards/{boardId}/lists/{listId}.json`

```ts
{
  schemaVersion: 1
  id: string
  boardId: string
  name: string
  order: number
  wipLimit?: number
  archivedAt?: string
  updatedAt: string
}
```

移动 List = 改 `boardId` + `order`，不是复制。

### Item `kanban/items/{id}.json`

```ts
{
  schemaVersion: 1
  id: string
  listId: string                // 间接属于 Board/Workspace
  title: string
  descriptionMarkdown?: string
  dueAt?: string
  checklist?: { id: string; text: string; done: boolean }[]
  labelIds?: string[]
  coverAssetId?: string
  attachmentObjectIds?: string[]
  order: number
  archivedAt?: string
  updatedAt: string
}
```

列间拖动 = 改 `listId` + `order`。标量 LWW；标签 OR-Set 或 LWW 数组（首版 LWW 数组即可）。

### 索引 `kanban/index.json`

workspace 列表及各 workspace 下 board id，供侧栏与 eink。

## UI

- **桌面**：左栏 Workspace → 网格 Board → 横向 List/Item 标准看板。Item 点开抽屉：描述、清单、附件、封面。
- **Pad**：Workspace/Board 大卡片；Board 内横向滑 List；Item 全屏详情。
- **Web**：宽屏同桌面，窄屏同 Pad。
- **墨水屏**：不画整板。按 `device/eink/config.json` 的 workspace/board/`listNames` 抽 Item。
- 创建 Workspace、Board、默认三列（待办/进行中/完成）的模板。

## 同步与 MCP

写任何一层都持全局锁。MCP tools：

- `kanban_list_workspaces` / `boards` / `lists` / `items`
- `kanban_create_workspace|board|list|item`
- `kanban_move_item` / `kanban_update_item`

## 验收

- 建 2 个 Workspace、若干 Board，Item 在列间拖动后刷新仍在正确 List。
- 一端改卡片标题、另一端改另一张卡片，同步后都在。
- Item 封面引用素材库图片可显示。
- summary 能列出指定 List 的未完成标题（在客户端生成逻辑单测 + 手册验收）。
- 归档 Workspace 后默认不出现在主列表。

## 非目标

- 多用户成员与权限。
- 实时协作光标。
- 自定义字段（需要时 `ref` 到数据表行）。
- 看板内评论流（可后置）。
