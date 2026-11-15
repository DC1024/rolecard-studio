# RoleCard Studio Wiki（v1.4.2）

欢迎来到 **RoleCard Studio（智能角色卡中枢）** 官方 Wiki。本文档库严格对应当前 **`v1.4.2`** 版本代码实现，覆盖从零部署、新手快速上手、全功能深度解析到外部生态集成的完整知识体系。

---

## 📚 文档导航与阅读路线

### 按角色推荐阅读路径

- **如果你是初次安装的新用户**：  
  [环境要求与部署指南](Deployment-and-Environment.md) → [快速入门与典型场景](Quickstart-and-Workflows.md) → [常见问题与注意事项](FAQ-and-Troubleshooting.md)
- **如果你是角色卡创作者 / SillyTavern 玩家 / TRPG 主持人**：  
  [快速入门与典型场景](Quickstart-and-Workflows.md) → [详细功能使用指南](User-Guide.md) → [开放生态：MCP、插件与 API](Ecosystem-API-MCP-Plugins.md)
- **如果你是自托管管理员 / 团队运维**：  
  [环境要求与部署指南](Deployment-and-Environment.md) → [配置项、代理、通知与安全](Configuration-and-Security.md) → [常见问题与注意事项](FAQ-and-Troubleshooting.md)
- **如果你要接入外部 AI 客户端或开发插件**：  
  [开放生态：MCP、插件与 API](Ecosystem-API-MCP-Plugins.md) → [配置项、代理、通知与安全](Configuration-and-Security.md)

---

## 🧩 核心概念与统一术语表

为避免理解偏差，全站及文档统一使用以下术语定义：

| 术语 | 说明 |
| --- | --- |
| **角色卡（RoleCard）** | 系统核心资产，底层以结构化 `RoleCardContent` 存储，兼容导入/导出为 SillyTavern CCV3 规范、TRPG 面板及通用人设档案。 |
| **生成模式 Mode A / B / C** | **Mode A**：仅使用用户提供的材料/文本/URL；**Mode B**：仅通过联网百科与搜索考据（无证据硬拦截）；**Mode C**：本地骨架 + 联网补充双溯源融合。 |
| **Layer-1 免 Key 百科 / Layer-2 检索** | **Layer-1**：内置萌娘百科、PRTS Wiki、Wikipedia（中/英）直连 API，无需任何 Search Key；**Layer-2**：可选 Bocha / Tavily / SerpAPI / Bing 商业搜索引擎。 |
| **2:3 主立绘与衍生 1:1 VTT Token** | 全站角色卡封面统一采用 **2:3 竖版比例**（本地裁剪 `600×900`，AI 生图 `1024×1536`）；**1:1 VTT Token（`512×512`）** 由 2:3 主立绘裁剪衍生并单独保存，供跑团桌面（如 Foundry VTT）直接调用。 |
| **独立世界书（Lorebook）** | 可跨角色复用的背景知识库，支持 **蓝灯（Constant 常驻注入）** 与 **绿灯（Selective 关键词触发）** 词条，并与角色卡多对多关联。 |
| **快速试聊沙盒（Playtest）** | 内置对话测试环境，用于即时检验角色语气、开场白与世界书蓝/绿灯触发命中情况，并可将满意对话采纳到 `mes_example`。 |
| **定时演化与单跳涟漪（1-Hop Ripple）** | 默认关闭的定时背景更新机制；仅对共享同一本世界书的直接相邻角色（1-Hop）生成态度变更提案，必须人工审核后生效。 |
| **元舆论风评层（Meta Isolation）** | 所有角色卡（含 `entityType = 'real_person'`）默认关闭 `meta_reputation` 注入，用户可在详情页按需自主开启或手动编辑风评摘要。 |
| **四路模型槽位** | 将 **主生成 (`primary`)**、**试聊 (`chat`)**、**识图 (`vision`)** 与 **文生图 (`image`)** 解耦为 4 个独立配置槽位。 |
| **两级网络代理** | 支持设置全局默认代理，并针对 `llm_primary`、`llm_chat`、`llm_vision`、`llm_image`、`search`、`media`、`webhook` 七大作用域分别设置继承、强制直连或独立代理。 |
| **RBAC 与访客策略** | 将 **网页端访客策略（`siteAccessMode`）** 与 **外部 API 策略（`apiAccessMode`）** 分离控制，普通用户按 7 项细粒度权限授权。 |

---

## 🗺️ 全站页面一览

| 文档 | 文件名 |
| --- | --- |
| 环境要求与部署指南 | [`Deployment-and-Environment.md`](Deployment-and-Environment.md) |
| 快速入门与典型场景 | [`Quickstart-and-Workflows.md`](Quickstart-and-Workflows.md) |
| 详细功能使用指南 | [`User-Guide.md`](User-Guide.md) |
| 配置项、代理、通知与安全 | [`Configuration-and-Security.md`](Configuration-and-Security.md) |
| 开放生态：MCP、插件与 API | [`Ecosystem-API-MCP-Plugins.md`](Ecosystem-API-MCP-Plugins.md) |
| 常见问题与注意事项 | [`FAQ-and-Troubleshooting.md`](FAQ-and-Troubleshooting.md) |
