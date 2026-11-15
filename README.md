# RoleCard Studio（智能角色卡中枢）

> **Local-First AI 角色卡 & 世界书（Lorebook）工作台** — 支持模式 A/B/C 三模考据生成、SillyTavern CCV3 双 chunk PNG 导出、选卡快速试聊沙盒、默认关闭的定时人设演化与单跳涟漪传播、RBAC 访问控制，以及面向 SillyTavern / MCP / 游戏的实时同步生态。

## 架构概览

```
rolecard-studio/
├── packages/shared    # Zod Schema、通用类型、RBAC 权限枚举、Token 计数
├── packages/core      # 深模块领域引擎（生成/检索/SSRF/CCV3/Lorebook/演化/同步/RBAC）
├── packages/mcp       # 官方 MCP Server (stdio / HTTP)
├── apps/server        # Hono + Drizzle ORM + SQLite (WAL) 后端服务
├── apps/web           # React 18 + Vite + Tailwind 四主题三层工作台
├── plugins/           # SillyTavern 实时同步扩展、Obsidian/游戏 Webhook 验签同步器
└── scripts/           # 方案 A 便携打包与 Windows (Inno Setup) / Linux (.deb/.tar.gz) 安装器脚本
```

## 快速开始

### 本地开发（Node >= 22, pnpm >= 9）
```bash
pnpm install
pnpm build
pnpm dev
```

### 生产验证与打包
```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm bundle
```

### Docker 部署（GHCR）
```bash
docker pull ghcr.io/dc1024/rolecard-studio:latest
docker run -d -p 3000:3000 -v rolecard_data:/app/data ghcr.io/dc1024/rolecard-studio:latest
```
