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
├── plugins/           # SillyTavern 扩展、Obsidian/游戏同步器与声明式插件示例
├── packaging/         # Windows (Inno Setup) & Linux (.deb/.rpm/.tar.gz) 打包脚本
└── docs/              # 技术方案 (v1.4)、设计规范 (v1.0)、排期计划 (v1.0)
```

## 快速开始

```bash
pnpm install
pnpm dev
```

## 文档索引
- 技术方案：`角色卡生成网站_技术方案与可行性分析_v1.4.md`
- 前端规范：`前端设计风格规范_v1.0.md`
- 排期计划：`角色卡生成网站_排期计划表_v1.0.md`
- 编码标准：`CODING_STANDARDS.md`
