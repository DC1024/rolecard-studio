# 环境要求与部署指南

本文档详细介绍 **RoleCard Studio (`v1.4.2`)** 的软硬件依赖、四种主流部署方式、环境变量配置、反向代理接入以及数据持久化与迁移方案。

---

## 1. 环境要求

### 1.1 运行与编译依赖

- **预编译安装包 / Docker 部署**：无需本地预装 Node.js 或编译工具（安装包已内置便携版 Node.js `22.22.2`；SQLite 使用 Node.js 22 内建 `node:sqlite`，无任何 C++ 原生模块编译依赖）。
- **源码运行 / 开发构建**：
  - **Node.js**: `>= 22.0.0`（必须为 22+，因为服务端直接使用 `node:sqlite` 的 `DatabaseSync`）
  - **pnpm**: `>= 9.0.0`（推荐 `9.15.4`）
  - **Git**: 用于源码克隆与更新

### 1.2 硬件与网络建议

- **CPU / 内存**：1 vCPU / 512 MB RAM 即可流畅运行单节点服务；若同时运行本地 Ollama 大模型请按模型规格预留内存/显存。
- **磁盘空间**：应用本体约 100～150 MB；建议为 `ROLECARD_DATA_DIR` 预留至少 1 GB 以上空间用于 SQLite 数据库及 `2:3` / `1:1` PNG 立绘文件。
- **网络说明**：若服务部署在无法直连 OpenAI、Anthropic、Wikipedia、Wikimedia 或 Telegram 的网络环境中，可在系统启动后通过网页端 **「设置 → 网络代理」** 配置 HTTP / HTTPS / SOCKS5 代理，无需在操作系统层面硬改全局环境变量。

---

## 2. 部署方式详解

### 方式一：GitHub Release 预编译安装包（推荐桌面与单机）

前往项目的 [Releases 页面](https://github.com/DC1024/rolecard-studio/releases) 下载对应平台产物：

#### Windows（x64）
1. **安装向导版（`RoleCardStudio-Setup-<version>-win-x64.exe`）**  
   双击运行安装向导，可选择安装目录与创建桌面快捷方式；启动后默认监听 `127.0.0.1:3000` 并自动打开浏览器。
2. **免安装便携版（`RoleCardStudio-<version>-win-x64-portable.zip`）**  
   解压到任意目录，双击根目录的 `start-rolecard.bat` 启动。所有数据默认保存在同级 `data\` 目录中。

> 如需允许局域网其他设备访问 Windows 本机部署，可在启动前于终端设置 `set HOST=0.0.0.0` 后再运行 `start-rolecard.bat`。

#### Linux（x64）
1. **Debian / Ubuntu `.deb` 包**
   ```bash
   sudo dpkg -i rolecard-studio_1.4.2_amd64.deb
   # 方式 A：命令行直接启动
   rolecard-studio

   # 方式 B：作为系统守护服务开机自启（默认数据目录 /var/lib/rolecard-studio）
   sudo systemctl enable --now rolecard-studio
   sudo systemctl status rolecard-studio
   ```
2. **通用 `.tar.gz` 便携包**
   ```bash
   tar -xzf rolecard-studio-1.4.2-linux-x64.tar.gz
   cd bundle
   # 前台运行
   ./start-rolecard.sh

   # 或一键注册 systemd 服务（将安装至 /opt/rolecard-studio，数据存于 /var/lib/rolecard-studio）
   sudo bash install-systemd.sh
   ```

---

### 方式二：Docker & Docker Compose 部署（推荐服务器与 NAS）

官方多架构镜像托管于 GitHub Container Registry（支持 `linux/amd64` 与 `linux/arm64`）：

#### `docker run` 快速启动

```bash
docker pull ghcr.io/dc1024/rolecard-studio:latest

docker run -d \
  --name rolecard-studio \
  --restart unless-stopped \
  -p 3000:3000 \
  -v /opt/rolecard-data:/app/data \
  -e ROLECARD_ADMIN_USER=admin \
  -e ROLECARD_ADMIN_PASSWORD=ChangeMe_StrongPass123 \
  -e ROLECARD_DEPLOYMENT_MODE=cloud \
  ghcr.io/dc1024/rolecard-studio:latest
```

#### `docker-compose.yml` 编排示例

```yaml
services:
  rolecard-studio:
    image: ghcr.io/dc1024/rolecard-studio:1.4.2
    container_name: rolecard-studio
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      PORT: "3000"
      HOST: "0.0.0.0"
      ROLECARD_DATA_DIR: "/app/data"
      ROLECARD_DEPLOYMENT_MODE: "cloud"
      ROLECARD_ADMIN_USER: "admin"
      ROLECARD_ADMIN_PASSWORD: "ChangeMe_StrongPass123"
      ROLECARD_ENABLE_SCHEDULER: "true"
    volumes:
      - ./data:/app/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

> **注意**：镜像内默认以非特权用户 `node`（UID 1000）运行。如果你挂载宿主机本地目录（如 `./data:/app/data`），请确保宿主机目录对 UID `1000` 可写（`chown -R 1000:1000 ./data`）。

---

### 方式三：从源码构建生产单进程包

```bash
git clone https://github.com/DC1024/rolecard-studio.git
cd rolecard-studio
pnpm install
pnpm build

# 方式 A：直接运行编译产物
ROLECARD_DATA_DIR=./data PORT=3000 HOST=0.0.0.0 node apps/server/dist/index.js

# 方式 B：生成独立可迁移便携包（输出到 release/bundle/）
pnpm bundle
cd release/bundle
./start-rolecard.sh   # Windows 使用 start-rolecard.bat
```

`apps/server` 在启动时会自动按顺序探测静态前端目录（环境变量 `ROLECARD_WEB_DIST` → `apps/web/dist` → `public`），从而在**单个 Node 进程**内同时托管前端界面与 `/api/v1/*` 接口。

---

### 方式四：源码本地开发模式

```bash
# 终端 1：启动后端热更新（监听 3000）
pnpm dev

# 终端 2：启动前端 Vite 开发服务器（监听 5173，自动代理 /api 与 /uploads 到 3000）
pnpm --filter @rolecard/web dev
```

---

## 3. 环境变量参考

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 服务监听端口 |
| `HOST` | `0.0.0.0`（便携脚本默认 `127.0.0.1`） | 监听网卡地址。公网反代建议设为 `127.0.0.1`；Docker 与局域网共享设为 `0.0.0.0` |
| `ROLECARD_DATA_DIR` | `./data` | 数据持久化根目录（存放 `rolecard.db`、`.master.key`、`uploads/`、`plugins/`） |
| `ROLECARD_WEB_DIST` | 自动探测 | 指定构建后前端静态目录路径（通常无需手动设置） |
| `ROLECARD_ADMIN_USER` | `admin` | **仅在首次初始化空数据库时生效**：初始管理员用户名 |
| `ROLECARD_ADMIN_PASSWORD` | 自动生成随机密码 | **仅在首次初始化空数据库时生效**：初始管理员密码；若未设置，首次启动会在日志打印随机密码 |
| `ROLECARD_DEPLOYMENT_MODE` | `local` | 可选 `local` / `cloud`，透传至 `/api/v1/health` 便于部署识别 |
| `ROLECARD_ENABLE_SCHEDULER` | `true`（非 `'false'` 即启用） | 是否启用每小时检查一次的定时演化调度器；设为 `false` 可彻底关闭调度循环 |
| `ROLECARD_ALLOW_FAKE_IP` | `false` | 设为 `true` / `1` 时放行系统 TUN 透明代理产生的 `198.18.0.0/15` Fake-IP DNS 结果（也可直接在网页端「设置 → 网络代理」勾选） |
| `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` / `NO_PROXY` | 无 | 当应用内全局代理未启用且开启「自动回退读取系统环境变量代理」时，作用域为 `inherit` 的出站请求会自动按目标协议回退使用系统环境代理并尊重 `NO_PROXY` |

---

## 4. 反向代理配置示例（Nginx / Caddy）

RoleCard Studio 的角色卡生成（`/api/v1/generate/stream`）、模型校验探测（`/api/v1/config/test`）与外部同步推流（`/api/v1/external/sync/stream`）均使用 **SSE（Server-Sent Events）**，反向代理需关闭缓冲。

### Nginx 示例

```nginx
server {
    listen 80;
    server_name rolecard.example.com;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 关键：禁用 SSE 响应缓冲并延长读取超时
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

### Caddy 示例

```caddyfile
rolecard.example.com {
    reverse_proxy 127.0.0.1:3000 {
        flush_interval -1
    }
}
```

---

## 5. 数据目录结构与备份迁移

`ROLECARD_DATA_DIR` 下的目录结构如下：

```text
data/
├── .master.key          # 32 字节本地 AES-256-GCM 加密主密钥（极其重要！）
├── rolecard.db          # SQLite 主数据库（WAL 模式）
├── rolecard.db-wal      # SQLite WAL 日志文件（运行中存在）
├── rolecard.db-shm      # SQLite 共享内存索引（运行中存在）
├── uploads/             # 上传与生成的 2:3 主立绘、1:1 VTT Token PNG 文件
└── plugins/             # 第三方自定义声明式插件 JSON 文件存放目录
```

> ⚠️ **备份铁律**：  
> 迁移服务器或备份数据时，**必须将 `.master.key`、`rolecard.db`（建议先停止服务或使用 SQLite backup 确保 WAL 刷盘）与 `uploads/` 一同备份**。如果丢失 `.master.key`，数据库中已加密保存的所有大模型 Key、代理密码、通知秘钥将无法解密，需要重新填写。
