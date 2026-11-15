# 开放生态：MCP Server、插件与 External API

RoleCard Studio 不仅是一个独立网页工作台，还通过 **MCP Server**、**SillyTavern / Obsidian 扩展**、**Webhook 实时事件流** 以及 **声明式 JSON 插件** 与你的整套创作工具链打通。

---

## 1. 官方 MCP Server（`@rolecard/mcp`）

`@rolecard/mcp` 允许 Claude Desktop、Cursor、VS Code、Cline 或其他支持 MCP（Model Context Protocol）的 AI 助手直接检索和读取你本地的角色卡与世界书。

### 1.1 暴露的 Tools 与 Resources

- **MCP Tools**：
  - `search_cards`：按角色名、作品或标签搜索角色卡（可选参数 `query`）
  - `get_card`：按 `cardId` 获取完整设定、版本与引用溯源
  - `export_card_ccv3`：按 `cardId` 导出完整 SillyTavern CCV3 JSON（含合并的 `character_book`）
  - `list_lorebooks`：列出全部独立世界书及其词条列表
- **MCP Resources**：
  - `rolecard://cards`：全量角色卡索引 JSON
  - `rolecard://lorebooks`：全量世界书索引 JSON

### 1.2 客户端接入配置示例（stdio）

1. 先确保项目已构建（`pnpm build`），或确认你使用的脚本路径指向 `packages/mcp/dist/index.js`。
2. 在管理员 **「设置 → 外部 API Key」** 创建一个 External API Key（当 `apiAccessMode` 为 `authenticated` 时必需，前缀为 `rc_ext_`）。
3. 将如下配置添加到 MCP 客户端配置文件（如 `claude_desktop_config.json` 或 Cursor `.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "rolecard-studio": {
      "command": "node",
      "args": [
        "/绝对路径/rolecard-studio/packages/mcp/dist/index.js"
      ],
      "env": {
        "ROLECARD_API_URL": "http://127.0.0.1:3000",
        "ROLECARD_API_KEY": "rc_ext_请替换为你的External_API_Key"
      }
    }
  }
}
```

> 若在工作区通过 pnpm 构建过，也可在创建链接后直接运行 `rolecard-mcp` 二进制入口；使用 `node .../packages/mcp/dist/index.js` 则不依赖全局 PATH，最稳妥。

---

## 2. SillyTavern 实时同步扩展

源码位于仓库 `plugins/sillytavern-rolecard-sync/`：

1. 将 `plugins/sillytavern-rolecard-sync/` 整个目录复制到 SillyTavern 的 `public/scripts/extensions/third-party/` 目录。
2. 启用扩展后，在浏览器控制台或扩展配置中设置服务地址与 API Token：
   ```js
   window.RoleCardSync.updateConfig({
     serverUrl: 'http://127.0.0.1:3000',
     apiToken: 'rc_ext_xxx',
     autoApply: true,
   });
   window.RoleCardSync.startStream();
   ```
3. **同步机制**：
   - 优先连接 `GET /api/v1/external/sync/stream?since_cursor=<cursor>` 接收 SSE 实时推流。
   - 断线时自动降级为 `GET /api/v1/external/sync/events?since_cursor=<cursor>` 增量轮询，绝不漏事件。
   - 收到 `card.updated`、`card.evolved`、`ripple.approved` 或 `lorebook.updated` 后自动拉取最新 `/api/v1/external/cards/:id/ccv3` 并派发浏览器事件 `rolecard:synced`。

---

## 3. Obsidian 人物笔记插件与 Webhook 验签桥接

源码位于仓库 `plugins/obsidian-rolecard-sync/`：

- **Obsidian 插件（`manifest.json` + `main.js`）**：
  1. 将 `manifest.json` 与 `main.js` 放入 Vault 下的 `.obsidian/plugins/obsidian-rolecard-sync/` 目录。
  2. 在 Obsidian 第三方插件设置启用 **RoleCard Studio Sync**，填写 RoleCard Studio 地址与可选 Token。
  3. 按 `Ctrl/Cmd + P` 执行「立即从 RoleCard Studio 增量同步」，自动生成带 YAML Frontmatter 的 Markdown 人物卡笔记。
- **Node.js Webhook 验签接收端（`webhook-bridge.mjs`）**：
  - 当你在「审核与同步 → Webhook 订阅」新增订阅时，系统会生成唯一签名密钥（`secret`）。
  - 每次推送都会在请求头附带 `X-RoleCard-Signature: sha256=<HMAC_HEX>`，接收端使用 `crypto.timingSafeEqual` 校验签名合法性，可直接接入游戏后端或本地构建脚本。

---

## 4. 零代码声明式 JSON 插件开发

RoleCard Studio 支持通过纯 JSON Manifest 扩展功能，**无需编写或执行任何不可信 JS 代码**。

### 4.1 放置位置与内置插件

- 系统默认内置 3 个示范插件：`obsidian-rolecard-note`（导出 Obsidian 笔记）、`renpy-character-script`（导出 Ren'Py `.rpy` 脚本）、`wuxia-jianghu-template`（东方武侠/仙侠提示词模板增强）。
- 将自定义 `.json` 插件文件放入 **`<ROLECARD_DATA_DIR>/plugins/`** 目录，或通过 **「插件与 MCP」** 页面粘贴 JSON 进行校验预览。

### 4.2 支持的 3 种插件类型与模板变量

1. **`template`（生成模板增强）**：定义 `templateSpec`（`cardTypeLabel`、`systemPromptAppend`、`defaultTags`）。
2. **`export_formatter`（自定义文本格式导出）**：定义 `exportSpec`（`fileExtension`、`mimeType`、`template`）。
   - 支持的安全插值占位符：`{{name}}`、`{{workName}}`、`{{version}}`、`{{mode}}`、`{{summary}}`、`{{personality}}`、`{{appearance}}`、`{{background}}`、`{{scenario}}`、`{{first_mes}}`、`{{mes_example}}`、`{{system_prompt}}`、`{{creator_notes}}`、`{{tags}}`、`{{json}}`。
3. **`search_source`（自定义检索源链接）**：定义 `searchSpec`（`displayName`、`urlTemplate`）。

**示例：自定义导出插件 Manifest（保存为 `data/plugins/hugo-role-post.json`）**

```json
{
  "id": "hugo-role-post",
  "name": "Hugo 静态博客人物页面",
  "version": "1.0.0",
  "author": "Community",
  "description": "导出适配 Hugo 静态站点的角色设定 Markdown",
  "type": "export_formatter",
  "exportSpec": {
    "fileExtension": "md",
    "mimeType": "text/markdown; charset=utf-8",
    "template": "---\ntitle: \"{{name}}\"\nseries: \"{{workName}}\"\ntags: [{{tags}}]\n---\n\n{{summary}}\n\n## 性格特征\n{{personality}}\n\n## 背景故事\n{{background}}\n"
  }
}
```

---

## 5. 鉴权模式与 External HTTP API 速查（含可运行示例）

### 5.0 鉴权机制说明（两套接口严格隔离）

RoleCard Studio 的 API 分为 **对外生态接口** 与 **工作台内部接口** 两套隔离的鉴权通道，**Token 不可混用**：

1. **对外生态接口（`/api/v1/external/*`）—— 使用 External API Key（`rc_ext_...`）**：
   - 当管理员在 **「设置 → 访问策略」** 将 `apiAccessMode` 设为 `authenticated`（默认，顶栏显示「鉴权」）时，必须携带 `Authorization: Bearer rc_ext_...` 请求头；不认网页登录 Cookie 或用户会话 Token。
   - **获取方式**：
     - **网页端创建（默认全权限 `["*"]`）**：管理员登录 → 打开 **「设置 → 外部 API Key」** → 输入备注名并点击 **「生成 Key」**（明文仅展示一次，服务端仅存 SHA-256 哈希）。
     - **接口创建（可指定最小 Scope，如仅只读）**：使用管理员会话调用 `POST /api/v1/admin/api-keys`，传入 `{"name": "ReadOnly", "scopes": ["cards:read"]}`。
   - **端点所需 Scope 与错误码**：
     - 全部 `GET /api/v1/external/*`（卡片列表、详情、CCV3、世界书、增量同步）均需 `cards:read`（或 `*`）。
     - `POST /api/v1/external/generate` 需 `cards:write`（或 `*`）。
     - 未携带有效 Key 返回 **`401 API_UNAUTHORIZED`**；Key 缺少对应 Scope 返回 **`403 API_FORBIDDEN`**。
2. **工作台内部接口（`/api/v1/cards/*`、`/api/v1/lorebooks/*`、`/api/v1/admin/*` 等）—— 使用用户会话 Token**：
   - 受 `siteAccessMode` 与用户 RBAC 权限控制；服务端显式排除 `rc_ext_` 前缀，因此 **External API Key 不可调用内部接口**。
   - 需先调用登录接口获取会话 Token（同时种下 `rc_session` HttpOnly Cookie，有效期 7 天），再通过 `Authorization: Bearer <token>` 或 Cookie 调用：
     ```bash
     # 1) 登录获取会话 token 与 Cookie
     curl -s -c cookies.txt -X POST "http://127.0.0.1:3000/api/v1/auth/login" \
       -H "Content-Type: application/json" \
       -d '{"username":"admin","password":"你的密码"}'

     # 2) 使用会话 token（或 -b cookies.txt）调用内部接口
     curl -s -H "Authorization: Bearer <login返回的token>" \
       "http://127.0.0.1:3000/api/v1/admin/api-keys"
     ```

### 5.1 列出与搜索角色卡（Scope: `cards:read`）

```bash
curl -s -H "Authorization: Bearer rc_ext_你的密钥" \
  "http://127.0.0.1:3000/api/v1/external/cards?q=凯尔希"
```

### 5.2 获取单卡详情（支持 ETag，Scope: `cards:read`）

```bash
curl -i -H "Authorization: Bearer rc_ext_你的密钥" \
  "http://127.0.0.1:3000/api/v1/external/cards/<cardId>"
```

### 5.3 导出 CCV3 JSON（含合并世界书，Scope: `cards:read`）

```bash
curl -s -H "Authorization: Bearer rc_ext_你的密钥" \
  "http://127.0.0.1:3000/api/v1/external/cards/<cardId>/ccv3" \
  -o character.ccv3.json
```

### 5.4 列出全部独立世界书（Scope: `cards:read`）

```bash
curl -s -H "Authorization: Bearer rc_ext_你的密钥" \
  "http://127.0.0.1:3000/api/v1/external/lorebooks"
```

### 5.5 通过外部 API 触发生成（Scope: `cards:write` 或 `*`）

```bash
curl -s -X POST "http://127.0.0.1:3000/api/v1/external/generate" \
  -H "Authorization: Bearer rc_ext_你的密钥" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "A",
    "characterName": "艾琳",
    "workName": "星港编年史",
    "cardType": "general",
    "referenceText": "星港档案馆的首席机械修补师，随身携带一枚黄铜怀表，性格沉稳但面对古董机关时会显得异常兴奋。"
  }'
```

### 5.6 增量同步事件流（SSE / 轮询，Scope: `cards:read`）

```bash
# SSE 实时流
curl -N -H "Authorization: Bearer rc_ext_你的密钥" \
  "http://127.0.0.1:3000/api/v1/external/sync/stream?since_cursor=0"

# 增量 JSON 轮询
curl -s -H "Authorization: Bearer rc_ext_你的密钥" \
  "http://127.0.0.1:3000/api/v1/external/sync/events?since_cursor=0"
```
