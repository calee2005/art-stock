# F13 MCP

将软件能力暴露为 MCP Tools，供 WorkBuddy 等本地 Agent 使用：写 Markdown、改看板、搜素材等。

## 目标

本地 stdio MCP Server，复用已配置远端与 `packages/core`。仅桌面（或 `artstock mcp` CLI）。Pad / Web / 固件不跑 MCP。

## 进程

`packages/mcp` → 可执行入口 `artstock-mcp`。读桌面同一套 RemoteConfig（安全存储）。所有写走 `withRemoteLock`。

## Tools（首版）

| 名称 | 写？ | 说明 |
| --- | --- | --- |
| `list_remotes` | 否 | 名称与 mode，不含密钥 |
| `list_libraries` | 否 | |
| `list_folder` | 否 | libraryId + path |
| `search_assets` | 否 | 标签/关键字 |
| `read_object_text` | 否 | markdown/mindmap json |
| `write_markdown` | 是 | 创建或覆盖正文并 snapshot |
| `kanban_list_workspaces` | 否 | |
| `kanban_list_boards` | 否 | workspaceId |
| `kanban_list_items` | 否 | boardId 可选 |
| `kanban_create_item` | 是 | |
| `kanban_move_item` | 是 | |
| `kanban_update_item` | 是 | |

禁止 tool 返回 `secretAccessKey`。锁占用时返回 `REMOTE_LOCK_HELD` 文本，让 Agent 重试。

## 验收

- 用 MCP Inspector 或脚本调用 `list_libraries` 成功。
- `write_markdown` 后远端出现新 snapshot。
- `kanban_create_item` 出现在对应 List。
- 调用结果中无密钥。

## 非目标

- 远程 HTTP MCP（会把密钥带出本机）。
- 让 Agent 直接执行 SQL / 任意 S3 命令。
