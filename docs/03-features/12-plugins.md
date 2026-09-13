# F12 插件系统

## 目标

通过插件扩展可打开/编辑的文件类型（例如未来虚拟出版物）。桌面为完整宿主；Web 沙箱降级；Pad 首版仅内置类型。

## 模型

插件目录（桌面）：应用数据 `plugins/{pluginId}/`。

`manifest.json`：

```json
{
  "id": "com.example.pub",
  "name": "虚拟出版物",
  "version": "0.1.0",
  "apiVersion": 1,
  "fileTypes": [{ "typeId": "publication", "extensions": [".vpub"], "mime": "application/x-vpub" }],
  "entry": "index.js"
}
```

宿主 API（`apiVersion: 1`）最小集：

- `registerEditor(typeId, open(objectId))`
- `readBlob(objectId)` / `writeBlob(objectId, bytes)`（write 走 core 队列+锁，插件不直接碰 S3）
- `getAssetUrl(assetId)`

插件在 iframe 或独立 webview 中加载，不能拿到密钥。

## UI

- 设置 → 插件：列表、启用/禁用、加载失败原因。
- 未知类型：提示安装插件或当 binary 下载。

## 同步

插件代码不上 S3（首版）。文件内容仍是普通 object。`type` 字段可由插件注册进类型表（本机）。

## 验收

- 示例插件（可内置 fixture）能注册一个假类型并打开显示字节长度。
- 插件 `writeBlob` 最终走锁，密钥不可被插件读到（审查 API）。
- Web：无插件时内置类型不受影响。
- Pad：不加载第三方插件，内置编辑器正常。

## 非目标

- 插件市场上架。
- Native/.so 插件。
- Pad/Web 任意代码执行。
