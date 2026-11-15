# RoleCard Studio（智能角色卡中枢）

> **Local-First AI 角色卡 & 世界书（Lorebook）工作台（v1.8.0）**  
> 集 **A/B/C 三模式考据生成**、**2:3 统一立绘画廊 & 衍生 1:1 VTT Token**、**独立世界书与快速试聊沙盒**、**多格式导入导出（SillyTavern CCV3 / TRPG / Foundry VTT / Obsidian）**、**定时演化与单跳涟漪审核**、**细粒度 RBAC 与两级网络代理**，以及 **MCP / SillyTavern / Webhook 开放生态**于一体。

---

## 目录

- [项目定位与核心特性](#项目定位与核心特性)
- [系统架构与目录结构](#系统架构与目录结构)
- [环境要求](#环境要求)
- [安装与部署](#安装与部署)
- [5 分钟快速入门](#5-分钟快速入门)
- [Wiki 专题文档导航](#wiki-专题文档导航)
- [开发与验证命令](#开发与验证命令)
- [安全与数据说明](#安全与数据说明)

---

## 项目定位与核心特性

RoleCard Studio 旨在解决传统角色卡创作中「资料考据零散、提示词与设定易漂移、世界书调试困难、多平台格式割裂、多人/跨端同步繁琐」的问题，采用 **Local-First（本地优先、单节点自托管友好）** 设计：

- **三模式考据生成引擎（Mode A / B / C）**
  - **Mode A（仅参考材料）**：基于输入文本、上传设定集（`.txt` / `.md` / `.json`）或经 SSRF 校验的直链 URL 提纯生成，忠实还原原作或原创 OC 设定。
  - **Mode B（仅联网检索考据）**：内置 **Layer-1 免 Key 公开百科**（萌娘百科、PRTS Wiki、Wikipedia 中英文）与可选 **Layer-2 搜索引擎**（Bocha / Tavily / SerpAPI / Bing）；无有效依据时触发硬拦截，拒绝凭空编造。
  - **Mode C（混合模式）**：以本地材料为第一优先级骨架，自动联网补充背景与关系，并保留双源引用溯源（`user_provided` / `search_supplement`）。
  - 支持 **SSE 实时进度与思考流展示**（新建 5 阶段流、单区块「AI 生成」、整卡「一键 AI 生成」、顶部「AI 微调」及 TRPG 规则推演均支持实时展示推理过程，且进度文案统一展示模型名称与目标动作/区块），兼容 `<think>` / `<thought>` / `<reasoning>` / `reasoning_content`；采用 **流式空闲重置超时（默认 300s）+ `max_tokens` 上限可配（默认 16384）+ 截断 JSON 抢救**，稳定支持慢速海外推理模型与大设定卡。
- **多规格预设与 TRPG 跑团支持**
  - 支持 **AI 角色扮演（SillyTavern CCV3）**、**TRPG 车卡（CoC 7e 调查员 / D&D 5e 冒险者）**、**通用设定** 与自定义规格。
  - 支持 **AI 推演 CoC 7e / D&D 5e 真实数值面板（实时展示思考流）**，并支持 **CoC 7e 与 D&D 5e 双规则在同一张角色卡中共存**（独立存储 `trpgSystems.coc7e` / `trpgSystems.dnd5e`，可随时切换默认激活规则、各自独立 **表单 + 原始 JSON 双模式手工编辑**），精简时自动豁免 TRPG 面板不被误压，并支持按指定规则导出标准车卡表（HTML / Markdown）及自动优先读取 `dnd5e` 桶导出 Foundry VTT Actor JSON。
- **统一 2:3 角色卡画廊与衍生 1:1 VTT Token**
  - 默认主视图为 **2:3 竖版立绘角色卡画廊**，左侧栏保留常驻检索、规格/模式筛选与常用标签联动。
  - 支持本地图片 `600×900` 裁剪、**AI 文生图（固定 `1024x1536` 竖版 + 结合角色卡生成/优化英文提示词 + 反向词透传）**、兼容 **OpenAI / 智谱 CogView / 硅基流动 Kolors & Qwen-Image / 魔搭异步队列** 生图协议并自动本地化短效外链、Wikimedia 同源搜图代理（`/api/v1/images/proxy`，点选自动本地转存 2:3 立绘与 1:1 Token）与外链同源代理（`/api/v1/cards/:id/portrait-source`）。
  - 可直接从 `2:3` 主立绘交互裁剪衍生 **`1:1`（`512×512`）VTT Token**，自动同步用于 `vtt_token_png` 直接导出与 `foundry_dnd5e_json`。
- **独立世界书（Lorebook）与快速试聊沙盒**
  - 世界书支持独立管理、与角色卡多对多绑定，支持 **蓝灯常驻（Constant）** 与 **绿灯关键词（Selective）** 规则，导出 CCV3 时自动合并至 `character_book`。
  - 内置 **快速试聊沙盒**，支持切换主开场白 / 备选开场白、配置测试人设、**按需选择 TRPG 规则注入（自动跟随激活规则 / 强制 CoC 7e / 强制 D&D 5e / 不注入）**、实时显示本次对话命中的蓝/绿灯词条与已注入规则角标，并可将高光对话一键采纳写入 `mes_example`。
- **版本锁定、版本撤回、引用管理、语义精简与多格式导入导出**
  - 支持对已有角色卡在详情页 **新增文本/URL 引用、自定义关键词联网搜料（Layer-1 百科 + Layer-2 检索）并删除过期资料**，每条引用支持 **折叠与展开（含全部展开/收起）**，勾选特定引用或自动优先使用最新资料驱动「AI 微调」、整卡「一键 AI 生成」与单区块「AI 生成」。
  - 支持 **「一键 AI 生成」**（二次确认后协同重写除 `lockedFields` 之外的所有区块）、**「AI 生成标签」**（默认追加去重）与 **「撤回上一版 / 历史版本快照恢复」**（自动留存最近 20 个操作快照，支持反撤回）。
  - 支持逐字段锁定（`lockedFields`），防止 AI 生成、微调或精简覆盖核心设定；支持按目标 Token 上限执行 **「语义精简」**（操作前明确提示有损风险，且自动豁免 TRPG 等 `extensions` 扩展面板）。
  - 支持导入旧版 PNG（`tEXt`/`iTXt`）与 V1/V2/V3 JSON 角色卡自动升级规范化，同时保留内嵌世界书与立绘。
  - 支持 8 种官方导出格式：`tavern_png`、`tavern_v3_json`、`json`、`markdown`、`foundry_dnd5e_json`、`vtt_token_png`、`trpg_sheet_html`、`trpg_sheet_md`。
- **定时人设演化、单跳涟漪与多渠道通知**
  - 定时演化默认关闭，可按角色独立配置同步周期与自动应用阈值；仅允许对共同关联世界书的邻居角色生成 **1-Hop 单跳关系涟漪提案**，严格人工审核。
  - 支持按角色卡独立控制 **元舆论（Meta Reputation）风评层**（默认关闭，用户可自主在详情页编辑风评摘要或开启试聊/演化注入）。
  - 支持 **9 大等权并行通知渠道**：SMTP 邮件、飞书、企业微信、钉钉、Telegram、Discord、Bark、Server酱、自定义 Webhook。
- **四路模型槽位、两级网络代理与 RBAC 安全体系**
  - 支持 `primary`（主生成）/ `chat`（试聊）/ `vision`（识图反推）/ `image`（文生图）4 路独立模型槽位，内置 **15 家服务商预设**（智谱 AI、魔搭社区、硅基流动、腾讯混元、OpenRouter、Groq、Google Gemini、DeepSeek、Kimi、通义千问、OpenAI、Anthropic 兼容网关、Azure OpenAI、本地 Ollama、自定义 OpenAI 兼容），并提供 **4 套新手免费源站一键向导** 与同服务商 Key 一键同步。
  - 支持 **全局代理 + 7 个作用域独立代理覆写**（`inherit` / `direct` / `custom`）、**系统环境变量代理自动回退**（`HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`）、**TUN Fake-IP（`198.18.0.0/15`）透明代理兼容**及一键连通性测试。
  - 所有凭据均采用 **AES-256-GCM**（基于本地 `.master.key`）加密落盘；内置管理员/普通用户 RBAC、站点/API 独立访客策略与 External API Key 作用域控制。
- **开放生态与实时同步**
  - 提供官方 **MCP Server（`@rolecard/mcp`）**、**SillyTavern 实时同步扩展**（SSE 推流 + 轮询降级）、**Obsidian 人物笔记插件 & Webhook 验签桥接**，以及零代码 JSON **声明式插件**。

---

## 系统架构与目录结构

```text
rolecard-studio/
├── packages/shared/    # Zod Schema、通用类型、RBAC 权限枚举、Token 估算
├── packages/core/      # 领域引擎（三模式生成/检索/SSRF/CCV3/Lorebook/演化/同步/代理/加密）
├── packages/mcp/       # 官方 MCP Server（stdio，提供角色卡检索、详情、CCV3 导出与世界书工具/资源）
├── apps/server/        # Hono + Drizzle ORM + Node 内建 SQLite (WAL) 后端服务与静态前端托管
├── apps/web/           # React 18 + Vite + Tailwind CSS 响应式工作台（4 套主题 + 独立字号缩放）
├── plugins/            # SillyTavern 实时同步扩展、Obsidian 插件与 Node Webhook 验签桥接
├── scripts/            # 便携包构建（build-bundle.mjs）、Windows Inno Setup 与 Linux 打包脚本
└── wiki/               # 完整项目 Wiki 文档（部署、入门、功能手册、配置安全、生态 API 与 FAQ）
```

**核心技术栈**：TypeScript 5 · Node.js 22（`node:sqlite` 原生运行，无 C++ 编译依赖）· pnpm Workspace · Hono · Drizzle ORM · React 18 · Vite 6 · Tailwind CSS · Vitest。

---

## 环境要求

| 部署/运行方式 | 最低要求 | 说明 |
| --- | --- | --- |
| **GitHub Release 预编译安装包** | Windows 10/11 (x64) 或 Debian/Ubuntu/Linux (x64) | 已内嵌便携版 Node.js 22 运行时，**无需手动安装 Node.js** |
| **Docker 容器部署** | Docker Engine 24+（支持 `linux/amd64` 与 `linux/arm64`） | 直接拉取 GHCR 官方多架构镜像 |
| **源码运行 / 二次开发** | **Node.js `>= 22.0.0`**、**pnpm `>= 9.0.0`** | 依赖 Node.js 22 内置 `node:sqlite` 模块 |
| **浏览器访问** | 现代 Chromium / Firefox / Safari 浏览器 | 支持前端离屏 `<canvas>` 2:3 与 1:1 立绘裁剪 |

---

## 安装与部署

> 完整部署细节、环境变量全表、反向代理（Nginx/Caddy）与数据备份说明请参阅 [Wiki · 环境与部署指南](wiki/Deployment-and-Environment.md)。

### 方式一：下载预编译安装包（推荐桌面与单机用户）

前往 [GitHub Releases](https://github.com/DC1024/rolecard-studio/releases) 下载对应平台最新产物：

- **Windows（x64）**：
  - 安装版：`RoleCardStudio-Setup-<版本>-win-x64.exe`（图形化安装向导）
  - 绿色便携版：解压 `RoleCardStudio-<版本>-win-x64-portable.zip` 后双击 `start-rolecard.bat`
- **Linux（x64）**：
  - Debian / Ubuntu：`sudo dpkg -i rolecard-studio_<版本>_amd64.deb`（自带 `rolecard-studio` 命令与 `systemd` 服务模板）
  - 通用压缩包：解压 `rolecard-studio-<版本>-linux-x64.tar.gz` 后运行 `./start-rolecard.sh`，或执行 `sudo bash install-systemd.sh` 注册系统服务

### 方式二：Docker 一键部署（推荐 NAS / 云服务器）

```bash
# 1. 拉取多架构镜像（支持 linux/amd64 与 linux/arm64）
docker pull ghcr.io/dc1024/rolecard-studio:latest

# 2. 启动容器并持久化数据目录（数据库、加密主密钥 .master.key 与上传立绘）
docker run -d \
  --name rolecard-studio \
  --restart unless-stopped \
  -p 3000:3000 \
  -v rolecard_data:/app/data \
  -e ROLECARD_ADMIN_USER=admin \
  -e ROLECARD_ADMIN_PASSWORD=请替换为强密码 \
  ghcr.io/dc1024/rolecard-studio:latest
```

启动后验证健康检查：

```bash
curl http://127.0.0.1:3000/api/v1/health
```

### 方式三：源码本地开发

```bash
# 1. 克隆并安装依赖
git clone https://github.com/DC1024/rolecard-studio.git
cd rolecard-studio
pnpm install

# 2. 构建共享包（首次或修改 shared/core 后需构建）
pnpm build

# 3. 启动后端服务（默认 http://0.0.0.0:3000）
pnpm dev
```

如需热更新前端开发服务器，可另开终端运行：

```bash
pnpm --filter @rolecard/web dev
```

前端开发服务器默认监听 `http://localhost:5173`，并自动将 `/api/*` 与 `/uploads/*` 代理至 `http://127.0.0.1:3000`。

### 方式四：自构建便携包（Portable Bundle）

```bash
pnpm build
pnpm bundle
# 生成的独立运行目录位于 release/bundle/
```

---

## 5 分钟快速入门

1. **访问工作台并登录管理员**  
   打开 `http://127.0.0.1:3000`（开发前端为 `http://localhost:5173`）。  
   - 若启动时未设置 `ROLECARD_ADMIN_PASSWORD`，首次启动会在控制台日志打印自动生成的初始账号与随机密码（例如 `username: "admin", password: "..."`）。
   - 点击右上角「登录」，登录后建议立即前往「系统设置 → 账号安全」修改密码。
2. **配置主大模型（Primary LLM）或一键导入免费源站**  
   点击右上角「设置」按钮，在 **模型槽位** 顶部可直接展开 **「新手免费源站一键向导」**（支持智谱免费全家桶、魔搭每日免费方案、硅基流动新人方案、OpenRouter 海外免费路由），一键预填 4 个槽位并用同一把 Key 同步；也可手动选择任意内置服务商（如 DeepSeek、通义千问、Kimi、本地 Ollama），点击「测试连接」验证通过后保存。
   - 如需访问海外接口或图源，可在「网络代理」页签开启全局代理或按作用域单独配置。
3. **生成第一张角色卡**  
   在顶部居中导航点击 **「生成新卡」**，选择预设规格（如「AI 角色扮演」或「TRPG 车卡」），选择 **Mode B（联网考据）** 或 **Mode A（本地材料）**，填写角色名与作品名，提交生成并观察实时思考流进度。
4. **统一 2:3 立绘与裁剪 1:1 VTT Token**  
   进入卡片详情后点击 **「2:3 立绘」**：上传图片（自动固定输出 `600×900`）或使用 AI 生图（固定 `1024x1536`），系统会同步生成默认头肩 `1:1`（`512×512`）VTT Token；也可随时点击 **「1:1 Token」** 独立微调取景框。
5. **试聊与导出**  
   - 点击顶栏 **「快速试聊」** 验证开场白与关联世界书的蓝/绿灯触发。
   - 在详情页「导出中心」一键下载 `tavern_png`（CCV3 PNG）、`tavern_v3_json`、`vtt_token_png` 或 `foundry_dnd5e_json`。

---

## Wiki 专题文档导航

完整的分章节详尽指南已整理在仓库 [`wiki/`](wiki/Home.md) 目录中，按角色与需求快速查阅：

| 文档页面 | 适用读者 | 核心内容 |
| --- | --- | --- |
| [Wiki 首页与核心概念](wiki/Home.md) | 所有用户 | 阅读路线图、术语统一表、系统工作流总览 |
| [环境要求与部署指南](wiki/Deployment-and-Environment.md) | 运维 / 自托管用户 | 安装包、Docker/GHCR、源码运行、环境变量、反向代理、数据备份与迁移 |
| [快速入门与典型场景](wiki/Quickstart-and-Workflows.md) | 新手 / 创作者 / 跑团玩家 | 首次初始化与 4 大端到端实战流程（CCV3 考据卡、原创 OC+世界书、TRPG+VTT、旧卡升级） |
| [详细功能使用指南](wiki/User-Guide.md) | 日常高频使用者 | 居中顶栏与 2:3 画廊布局、三模式生成、2:3 立绘与 1:1 Token、世界书、试聊沙盒、演化与审核、导出矩阵 |
| [配置项、代理、通知与安全](wiki/Configuration-and-Security.md) | 管理员 / 高级用户 | 四路模型与 JSON 策略、双层检索、两级 7 作用域代理、9 大通知渠道、RBAC 权限与加密机制 |
| [开放生态：MCP、插件与 API](wiki/Ecosystem-API-MCP-Plugins.md) | 开发者 / 极客玩家 | `@rolecard/mcp` 接入、SillyTavern/Obsidian 同步扩展、Webhook 验签、声明式插件与 External API 示例 |
| [常见问题与注意事项](wiki/FAQ-and-Troubleshooting.md) | 排查问题时 | 常见报错处理、`.master.key` 与数据库升级注意事项、SSRF/外链代理与硬拦截说明 |

---

## 开发与验证命令

```bash
pnpm build       # 构建所有 workspace 包与前端生产资源
pnpm typecheck   # 先构建 shared/core 类型产物，再对全仓执行 tsc --noEmit
pnpm lint        # 使用 ESLint 检查 packages/ 与 apps/
pnpm test        # 运行 Vitest 全仓单元与集成测试（11 个测试文件，57 项测试）
pnpm bundle      # 打包独立运行产物至 release/bundle/
```

---

## 安全与数据说明

- **加密主密钥保护**：服务首次启动时会在 `ROLECARD_DATA_DIR/.master.key` 自动生成主密钥，用于 AES-256-GCM 加密所有模型 API Key、代理地址、通知密钥与 Webhook Secret。**迁移或备份数据时请务必连同 `rolecard.db`、`uploads/` 与 `.master.key` 一起保存。**
- **SSRF 防护**：所有参考 URL、远程立绘与 Webhook 均内置私网/回环地址拦截（当对应作用域配置走用户显式代理时，按代理链路规则执行）。
- **风评层默认隔离与自主可控**：包括 `real_person` 在内的所有角色卡默认关闭试聊风评层注入与 `meta_reputation` 同步，用户可在「定时演化与 Meta 配置」中按需显式开启与编辑。
