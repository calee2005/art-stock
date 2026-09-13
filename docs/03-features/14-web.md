# F14 Web 端

部署到 GitHub Pages 的静态 SPA。用户打开网站，填写远端地址与密钥，即可查看、下载、上传。站点构建产物不含密钥。

## 目标

无后端、直连 S3；与桌面共用 core 与大部分 UI。

## 工程

`apps/web`：Vite + React，消费 `packages/core`、`packages/s3`、`packages/ui`。

存储：凭证与 Pin、队列在 IndexedDB；缩略图 OPFS。配额不足时拒绝钉选大文件并提示用桌面。

## UI

- 首次进入：远端配置向导（endpoint、bucket、key、path-style）+ CORS 失败时的说明链接。
- 其后与桌面同构，窄屏 Tablet shell。
- XSS 警告条（可关闭到本机 session）：密钥存在浏览器。

## 同步与锁

浏览器 S3 SDK 必须发送条件头。CORS 见协议 §12。`withRemoteLock` 同一实现。

## 发布

GitHub Actions 构建 `apps/web` 到 Pages（`.github/workflows/pages.yml`）。`PAGES_BASE` 按仓库名配置，例如 `/art-stock/`。工作流**不得**注入 `secrets.*` 或 AWS/OSS 密钥；产物用 `assert-dist-no-secrets.mjs` 扫描示例密钥。用户密钥只存在浏览器本机存储。

## CORS

协议 §12。可复制规则见 [cors-oss.example.json](../cors-oss.example.json)（Pages 站点也托管 `cors-oss.example.json`）。必须包含锁条件头：

`If-Match`、`If-None-Match`、`x-oss-forbid-overwrite`

以及 `Authorization`、`Content-Type`、`x-amz-content-sha256`、`x-amz-date`、`x-amz-security-token`。方法：`GET, HEAD, PUT, DELETE, POST`。Expose：`ETag`。AllowedOrigins 填 Pages 源站（如 `https://<user>.github.io`）与本地 `http://localhost:5173`。

未配 CORS 时，探测/HEAD 在浏览器里表现为 `TypeError: Failed to fetch`。Web 必须把它渲染成可读说明 + 上述 JSON，**不得白屏**。客户端不能替用户改 bucket CORS。

## 验收

- 空密钥打开站点不请求用户桶。
- 填入真实远端后可 list 库、上传小文件、下载；上传期间锁对象存在。
- Pages 部署后 CORS 未配时错误可读（不是白屏）。
- 构建产物 grep 不到示例密钥。

## 非目标

- 服务端代持密钥。
- Service Worker 离线整库（仅缓存已打开资源即可）。
