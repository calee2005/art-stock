# F08 思维导图

## 目标

资料库内可创建、编辑思维导图。结构化 JSON 存为 blob，可预览。

## 对象模型

`type: "mindmap"`。blob 为 JSON：

```ts
type MindNode = {
  id: string
  text: string
  children: MindNode[]
  color?: string
  collapsed?: boolean
}
type MindDoc = { schemaVersion: 1; root: MindNode }
```

保存即快照（策略同其他 object）。

## UI

- 画布：缩放、拖拽节点、增删兄弟/子节点、编辑文本。
- 推荐实现库在编码阶段选（如 mind-elixir），但 **存盘格式以本文 JSON 为准**，不得绑死私有二进制。
- 资料库网格用根节点文本或静态预览图作封面（预览图可本地生成不上传，后置）。

Pad：节点热区加大；双击编辑。

## 同步

整文档 LWW/快照。两端同时改 → 冲突分支，用户选一边或手动抄节点（首版不做树 merge）。

## 验收

- 新建导图、加三层节点、重开后结构一致。
- 作为资料库文件出现在树中，可打标签。
- 冲突时两份 JSON 都在，不互相覆盖。

## 非目标

- 思维导图与 Markdown 双向同步。
- 多人同时编辑同一节点。
