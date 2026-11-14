# RoleCard Studio -> Obsidian / 游戏后端同步插件

## 目录内容
- `manifest.json` & `main.js`：Obsidian 插件，定时基于 `?since_cursor=` 增量拉取变更并渲染含 YAML Frontmatter 的 Markdown 人物卡笔记。
- `webhook-bridge.mjs`：面向游戏项目或本地工作流的 Node.js Webhook 验签接收端示例，使用 `crypto.timingSafeEqual` 校验 `X-RoleCard-Signature: sha256=...`。

## 安装方法（Obsidian）
1. 在 Vault 的 `.obsidian/plugins/obsidian-rolecard-sync/` 下放入 `manifest.json` 和 `main.js`。
2. 打开 Obsidian 第三方插件列表启用 **RoleCard Studio Sync**，配置服务地址与可选的 External API Token。
3. 可随时按 `Ctrl/Cmd + P` 执行「立即从 RoleCard Studio 增量同步」。
