# F06 Markdown 文稿

## 目标

资料库中的 Markdown 文件使用所见即所得编辑器；自动目录；可插入素材库中的图片、音频、视频。

## 对象模型

`objects/{id}`，`type: "markdown"`。正文 UTF-8 存在 blob。每次保存按该对象的快照策略产生 snapshot（与画稿相同机制）。

嵌入语法：

```markdown
![](artstock://asset/{assetId})
<audio src="artstock://asset/{assetId}" />
```

解析器不得把 `artstock://` 当普通 URL 发到公网。编辑器解析为从缓存/远端加载 blob。

## UI

- 编辑器：TipTap 或同等 WYSIWYG（实现阶段选定，保持 Markdown 往返）。
- 侧边或悬浮 TOC，按 ATX 标题生成，点击跳转。
- 工具栏「插入素材」打开素材选择器。
- 预览与编辑同一画布（所见即所得），可切源码模式后置。

Pad：工具栏加大；插入用面板而非 hover。

## 同步

当普通 object 同步。大文稿仍整文件快照，不做行级 CRDT。两端同时改同一文件 → 冲突分支，用文本对比 UI（可复用冲突页）。

## 验收

- 输入标题与列表，刷新后仍在，TOC 正确。
- 插入已在素材库的图，预览显示；源码含 `artstock://asset/...`。
- 离线编辑，上线后远端 blob 更新且持锁。
- 分叉时不丢任何一端正文（冲突分支）。

## 非目标

- 实时协同光标。
- 完整 Notion 块数据库（表格用多维表文件）。
