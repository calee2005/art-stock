# F09 多维数据表

资料库中的一种文件，像可自由建表的微型关系库（Airtable 子集）。**权威数据是 JSON + oplog，禁止把 SQLite 文件直接放到 S3 当真源。**

## 目标

建表、定义列类型、增删改行、筛选；本地副本可与远端比较并同步。

## 对象模型

`type: "database"`。blob 为快照 JSON，细粒度变更走该 object 专属 ops（仍写入全局 oplog）：

```ts
type ColumnType = "text" | "number" | "bool" | "date" | "select" | "ref-asset" | "ref-object"
type Column = { id: string; name: string; type: ColumnType; options?: string[] }
type Row = { id: string; cells: Record<string, unknown>; updatedHlc: Hlc }
type DatabaseDoc = {
  schemaVersion: 1
  columns: Column[]
  rows: Row[]
  views?: { id: string; name: string; filters: unknown }[]
}
```

行级 LWW（按 `updatedHlc`）。列定义 LWW（按字段）。删行/删列用 tombstone，避免复活。

`ref-asset` / `ref-object` 存 id，UI 解析为链接。

## UI

- 打开数据库文件进入表格视图：表头改类型、加列、加行、单元格编辑。
- 「与远端比较」：只读 diff（新增/删除/改单元格），用户确认后合并进队列。
- Pad：保证加行、改文本、横向滑列；复杂筛选以桌面为完整。

## 同步

持锁后写最新 snapshot blob + oplog ops。比较功能：拉远端 snapshot，三路（共同祖先可选：用 parent snapshot）列出冲突单元格，用户选本地/远端。

## 验收

- 建表：文本列+素材引用列，录入 10 行，重开仍在。
- 两端改不同行，同步后两行都在。
- 两端改同一单元格，比较 UI 能选出一方，结果唯一。
- S3 上看不到 `.sqlite` 作为该功能的权威文件。

## 非目标

- SQL 任意查询引擎、跨库 JOIN。
- 把看板 Item 自定义字段做进本表引擎（看板链接行即可）。
