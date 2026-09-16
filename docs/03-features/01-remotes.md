# F01 远端管理

对应功能清单：`F-001` 起。协议见 [存储协议](../02-storage-protocol.md)。

## 目标

用户可登记多个 S3 兼容远端（家用 NAS、阿里云 OSS 等），探测连通性与**条件写（锁）能力**，选择读写或只读，配置 endpoint、region、bucket、**全局 prefix**、path-style。

`prefix` 是该远端在桶内的**根路径**（可与其它应用共用一个桶），不是 `.artstock` 自己的名字。协议元数据、blob、锁一律写在规范化后的 `{prefix}.artstock/v1/` 之下（`prefix` 为空则为 `.artstock/v1/`），见 [存储协议](../02-storage-protocol.md)。

## 对象模型（本机，不上 S3）

远端配置只存在本机：

```ts
type RemoteConfig = {
  id: string
  name: string
  endpoint: string
  region?: string
  bucket: string
  prefix: string          // 全局根，默认 ""（桶根）。例："art/"、"home/stock/"
                          // 规范化：去掉首尾多余 /，非空时以 / 结尾
                          // 完整键 = prefix + ".artstock/v1/" + 相对路径
                          // 不要把 ".artstock/v1" 填进本字段
  accessKeyId: string     // 经安全存储，UI 只显示后四位
  secretAccessKey: string
  forcePathStyle: boolean // NAS 通常 true
  mode: "readwrite" | "readonly"
}
```

密钥：桌面 OS 凭证库；Android Keystore；Web 浏览器存储（须警告 XSS）。

## UI

- 总览右上「远端」卡片：已保存远端以云图标展示；探测成功打勾；「管理」打开配置；「+」添加。
- 配置模态「基本」：「远端」列表（名称、endpoint、只读标记、最后探测结果）与添加/编辑表单。
- 添加/编辑表单：上述字段；「探测」按钮。
- 探测步骤（只读远端跳过写探测）：HEAD/GET `{prefix}.artstock/v1/manifest.json`（可 404）；对协议根下临时 key 或锁做一次条件 PUT 再删除。失败展示 `REMOTE_UNSUPPORTED`。
- 表单对 prefix 的说明：「桶内目录，可空。Art Stock 会使用 `{你填的路径}/.artstock/v1/`，不会占用该目录下其它文件。」并预览即将使用的协议根。
- 帮助面板：GitHub Pages CORS 示例、OSS 子账号最小策略（建议只授 `{prefix}.artstock/v1/*`）、path-style 说明。
- 当前工作远端：可多选「启用」；默认同步目标可设一个主远端。

## 同步

- 只读：永不 `withRemoteLock`，永不 PUT。
- 读写：所有上传走锁。见 [05-sync](05-sync.md)。
- 切换主远端不自动迁移数据；复制是 [P9 多远端](../04-roadmap.md) 的桥接任务。

## 验收

- 能添加 MinIO path-style 与 OSS virtual-hosted 两种配置并成功 list/get。
- prefix 为空时对象落在 `.artstock/v1/…`；prefix 为 `art/` 时落在 `art/.artstock/v1/…`，不得把 `.artstock/v1` 当成 prefix 默认值。
- 不支持条件写的假 endpoint 被拒绝，且没有对象被写入。
- 只读配置下所有写入口禁用。
- Web 刷新后凭证仍在（本机存储）；文档写明清除站点数据会丢失密钥。
- 密钥不出现在日志、eink summary、Git。

## 非目标

- 官方 OAuth / STS 控制台代管。
- 自动修改用户 bucket 的 CORS（只提供可复制的 JSON）。
