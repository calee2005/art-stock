# 概要设计：艺术资产管理中心（Art Stock）

| 项 | 值 |
| --- | --- |
| 产品名 | 艺术资产管理中心（仓库名 `art-stock`） |
| 文档状态 | 已锁定，实现以本文档族为准 |
| 相关 | [架构](01-architecture.md) · [存储协议](02-storage-protocol.md) · [功能详细设计](03-features/) · [开发计划](04-roadmap.md) · [功能清单](FEATURES.md) |

## 1. 要解决什么问题

作者在多台设备之间往来：台式机、笔记本、MacBook Pro、Android Pad。携带的设备每天不同，但绘画资源（素材、画稿、笔刷、文稿、项目信息）必须是同一份。

核心诉求：

- 多设备、多平台共享全部绘画相关资产。
- 家用 NAS 加速访问，外出时走阿里云 OSS；两者都是 S3 兼容，由客户端负责桥接。
- 本地永远是缓存，远端是权威存储。
- 画稿可以有多个方向：快照 + 命名分支。
- 资料、素材、看板、文稿、数据表集中管理，并在四色墨水屏上展示摘要。

## 2. 产品定位

Art Stock 是一套 **零自建后端** 的个人艺术资产系统：

- 权威数据全部落在用户自己的 S3 兼容存储上。
- Web / 桌面 / Pad / MCP 共用同一套对象协议。
- GitHub Pages 上的静态站不含密钥；用户自行填写远端地址与密钥后直连 S3。
- ESP32-S3 四色墨水屏只读拉取预计算摘要，不扫桶、不持写锁。

它不是网盘客户端，也不是完整 Git 托管，也不是多人实时协作 SaaS。

## 3. 已锁定决策

| 决策 | 选择 |
| --- | --- |
| 后端 | 无。客户端直连 S3 |
| 写并发 | 每个远端一把全局锁 `{prefix}.artstock/v1/lock.json`；任何写入必须先获锁。`prefix` 是桶内全局根，协议目录固定为 `.artstock/v1/` |
| 画稿版本 | 不可变快照 + 命名分支；可配置「保存时自动快照」或手动 commit；可手动建分支 |
| 客户端 | Tauri 2 + React：Windows、macOS、Android Pad；另有 Web SPA |
| 远端 | 任意 S3 兼容（NAS MinIO / 阿里云 OSS 等），可多个 |
| 看板 | Workspace → Board → List → Item |
| 墨水屏 | 从 [youn-ink-fourcolor-firmware](https://github.com/calee2005/youn-ink-fourcolor-firmware) subtree 拉取后再改，禁止从零重写 |

## 4. 角色与端

单用户、多设备。没有「成员权限」；身份就是 S3 访问密钥所代表的桶权限。

| 端 | 形态 | 典型场景 |
| --- | --- | --- |
| Windows / macOS 桌面 | Tauri 2 | 家中创作、文件监视、大文件同步、桥接 NAS↔OSS |
| Android Pad | 同一 Tauri 工程的 mobile 目标 | 通勤/单位：浏览、轻编辑、从绘画 App 收件 |
| Web | Vite SPA，GitHub Pages | 任意浏览器填密钥后查看、下载、上传 |
| MCP | 本地 stdio 进程 | 把库/看板/文稿暴露给 WorkBuddy 等 Agent |
| 墨水屏 | ESP32-S3 + 400x300 四色 BWRY | 每 2 小时刷新库统计、最近文件、看板待办 |

## 5. 核心概念

| 概念 | 含义 |
| --- | --- |
| Remote | 一个 S3 兼容桶+前缀+凭证。可只读或读写 |
| Library（资料库） | 多层文件夹 + 文件；用户可建多个。文件类型包括画稿、PDF、音视频、Markdown、数据表、思维导图等 |
| Object | 资料库中的逻辑文件。内容以 SHA-256 blob 存储，可有分支与快照 |
| Snapshot | 一次不可变内容记录。自动（监听保存）或手动 commit |
| Branch | 指向某个 snapshot 的命名指针。冲突时自动生成 `conflict/...` 分支 |
| Asset Library（素材库） | 全局一份，Eagle 核心子集：文件夹、标签、评分、缩略图、检索 |
| Kanban | 独立于资料库的四层结构；Item 可引用资料库对象与素材 |
| Database file | 资料库里的一种文件：多维表（JSON + oplog，不把 SQLite 直接放上 S3） |
| Pin | 钉选范围：该范围内原文件保留在本地；未钉选默认只有元数据+缩略图 |
| Device summary | 客户端持锁后写入的墨水屏摘要，固件只 GET |

## 6. 系统上下文

```text
[绘画软件 CSP 等] --导出/分享--> [桌面监视夹 / Pad 收件箱]
                                      |
                                      v
[Web] [Desktop] [Pad] [MCP] ----packages/core----> [NAS S3] [OSS S3]
                                      |
                                      | 持锁写入 summary/config
                                      v
                               [ESP32 墨水屏 GET]
```

没有应用服务器。GitHub Pages 只托管静态前端。冲突与复制都在客户端完成。

## 7. 功能全景

1. 远端管理（含写锁探测与 CORS 说明）
2. 资料库与文件夹
3. 画稿版本与分支
4. 全局素材库
5. 同步策略（钉选、按需取回、全部上传走锁）
6. Markdown 所见即所得
7. PDF 查看
8. 思维导图
9. 多维数据表
10. 看板（Workspace / Board / List / Item）
11. 冲突处理 UI
12. 插件系统
13. MCP
14. Web 端
15. 桌面端原生能力
16. Android Pad
17. 墨水屏固件
18. Monorepo 与构建

每项的对象模型、UI、同步、验收见 [03-features](03-features/)。

## 8. 非目标（首版不做）

- 自建同步服务器、账号系统、多人实时光标
- 完整 Git 协议、二进制 diff、LFS
- 把 SQLite 文件当权威数据直接放上 S3 并发写
- 墨水屏语音助手 / 复用上游 Python 后端
- Pad 上的 MCP Server、任意代码插件、系统托盘
- 看板自定义字段（结构化字段走多维表）
- 对不支持条件写的 S3 做无锁降级（视为不合格远端）

## 9. 质量属性

| 属性 | 要求 |
| --- | --- |
| 权威性 | 远端对象为真源；本地可丢、可重建 |
| 并发 | 同一远端同一时刻最多一个写入者（全局锁） |
| 离线 | 已缓存/已钉选内容可离线用；上线后排队同步 |
| 安全 | 密钥不上 Git、不进 Pages；Web 密钥仅存本机；固件存 NVS |
| 墨水屏 | 全刷 ≥10s，默认 2 小时一次；只拉小 JSON |
| 可演进 | 对象带 `schemaVersion`；协议文档即 API |

## 10. 文档与实现的关系

后续实现 **只认本目录与 [AGENTS.md](../AGENTS.md)**。口头需求若与文档冲突，先改文档再改代码。Agent 从 [FEATURES.json](FEATURES.json) 领取任务。
