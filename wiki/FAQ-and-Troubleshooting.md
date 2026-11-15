# 常见问题与注意事项

本文整理了部署、模型调用、考据生成、立绘裁剪与数据升级中的高频问题及处理办法。

---

## 1. 部署与启动问题

### Q1：源码运行时报错 `Cannot find module 'node:sqlite'` 或 SQLite 相关异常？
- **原因**：Node.js 版本低于 `22.0.0`。本仓库使用 Node.js 22 内置的 `node:sqlite` 模块，不依赖 `better-sqlite3` 等原生编译包。
- **解决**：使用 `node -v` 检查版本，升级至 **Node.js 22 LTS 或更高版本**；或者直接使用 Docker 镜像与 GitHub Release 预编译安装包（已内嵌 Node 22）。
- *注：运行时终端可能会看到 `ExperimentalWarning: SQLite is an experimental feature` 提示，这是 Node 22 的正常提示，不影响稳定性与 WAL 持久化。*

### Q2：首次启动忘记查看控制台，不知道管理员密码怎么办？
- 仅当数据库完全为空（`users` 表无记录）时，服务端才会创建初始管理员并读取 `ROLECARD_ADMIN_PASSWORD` 或打印随机密码。
- 如果在初始化后忘记密码且尚未建立重要数据，可停止服务后删除 `ROLECARD_DATA_DIR/rolecard.db*` 重新启动；如果已有业务数据，可在环境变量设置已知密码前先备份数据，或通过另一位拥有管理员权限的账号在 **「设置 → 用户管理」** 重置密码。

### Q3：Docker 挂载宿主机目录后启动报错 `EACCES: permission denied`？
- **原因**：容器内默认以非 root 用户 `node`（UID `1000` / GID `1000`）运行，宿主机新建目录归属 `root` 导致无法写入 `rolecard.db` 或 `.master.key`。
- **解决**：
  ```bash
  mkdir -p ./data/uploads
  chown -R 1000:1000 ./data
  ```

---

## 2. 模型配置与联网代理问题

### Q4：测试模型连接时提示超时或 `fetch failed`，怎么排查？
1. **检查网络代理**：若访问 OpenAI / Anthropic / Telegram 等海外接口，请到 **「设置 → 网络代理」** 开启全局代理或针对对应作用域（如 `llm_primary` / `llm_image` / `webhook`）配置 `custom` 代理，并点击「测试代理连通性」。
2. **检查本地 Ollama**：确认 `bypassLocal`（本地回环直连）处于开启状态，否则请求 `127.0.0.1:11434` 可能会错误发往代理服务器；同时 Ollama 的 `baseUrl` 需包含 `/v1`（例如 `http://127.0.0.1:11434/v1`）。
3. **检查 Base URL 格式**：绝大多数 OpenAI 兼容接口均需填写到 `/v1` 为止（系统会自动拼接 `/chat/completions` 或 `/images/generations`）。

### Q5：模型返回格式校验失败（JSON 解析错误）？
- 某些本地小参数模型或开启长思考链的推理模型可能输出带 Markdown 代码块或非严格 `json_object` 格式。
- **解决**：在对应模型槽位中将 **`jsonModeStrategy`** 保持为 `auto`（系统会自动降级并记住切换为 `prompt` 策略），或者手动指定为 **`prompt`**。

---

## 3. 生成、考据与立绘裁剪问题

### Q6：选择 Mode B 生成角色卡时提示「未检索到有效考据资料」被硬拦截？
- **原因**：Mode B 为防止大模型对未知角色“一本正经地胡说八道”，内置硬拦截策略：当 Layer-1 百科与 Layer-2 搜索均未命中实质性条目时中止生成。
- **解决**：
  - 确认角色名是否为完整标准译名（可在作品名栏补充完整作品名称）。
  - 检查「设置 → 检索设置」是否开启了 Layer-1 公开百科，以及海外 Wikipedia 访问是否需要通过 `search` 代理。
  - 若为**原创 OC 或极冷门角色**，请切换为 **Mode A（仅参考材料）** 或 **Mode C（混合模式）** 并补充一段文字设定。

### Q7：点击「AI 生图」提示未配置生图模型？
- **原因**：文本对话模型（Primary LLM）与文生图模型接口协议不同，系统将生图独立拆分为 **`imageLlm`** 槽位。
- **解决**：前往 **「设置 → 模型槽位 → 独立生图模型 (Image Model)」** 启用并填写兼容 `/images/generations` 的模型（如 `dall-e-3`、`gpt-image-1` 或硅基流动等平台的生图模型）。

### Q8：外链导入的立绘无法裁剪 `1:1` Token，或浏览器报跨域画布错误？
- **原因**：外部图床通常禁止浏览器直接读取跨域图片像素。
- **现状与解决**：`v1.3.0` 已在服务端新增同源代理端点 `/api/v1/cards/:id/portrait-source` 自动绕开浏览器 CORS 限制；若仍失败，通常是因为目标外链开启了严格防盗链（Referer 校验）、资源已失效，或需要为 **`media`** 作用域配置网络代理。此时建议将图片下载到本地后通过 **「2:3 上传裁剪」** 上传。

### Q9：为什么全站立绘和画廊都是 `2:3` 竖版比例？
- 为了统一桌面端与移动端的视觉比例，避免方图/横图/竖图混排导致的裁切错位与“切头”问题，全站角色卡封面统一采用 **`2:3` 竖版**（上传固定 `600×900`，AI 生图固定 `1024×1536`）。
- 当你在跑团 VTT（如 Foundry VTT / Roll20）需要 **`1:1` 头像 Token** 时，无需重复传图，直接点击详情页的 **「1:1 Token」** 从已有 `2:3` 立绘中框选头肩区域衍生裁剪（`512×512` PNG）即可。

---

## 4. 安全、升级与数据备份注意事项

### Q10：跨版本升级后，旧数据库能直接兼容吗？
- **可以**。服务端启动时会自动执行增量表结构检查（`ensureColumnExists`），例如升级至 `v1.3.0` 时会自动为存量 `role_cards` 表补充 `token_image_url` 与 `token_crop_json` 列，无需手动跑迁移脚本。
- 若旧卡原本仅有 `imageUrl` 尚未单独裁剪过 `1:1` Token，导出 `vtt_token_png` 或 `foundry_dnd5e_json` 时会自动回退到现有立绘；随时打开该卡片点击 **「1:1 Token」** 补裁即可。

### Q11：日常运维有哪些必须注意的安全事项？
1. **严禁丢失 `.master.key`**：`ROLECARD_DATA_DIR/.master.key` 负责解密所有入库密钥，备份时必须与 `rolecard.db`、`.db-wal`、`uploads/` 打包保存在一起。
2. **公网部署务必检查访问策略**：公网环境建议将 `apiAccessMode` 保持为 **`authenticated`**，如需私密使用可将 `siteAccessMode` 设为 **`login_required`**，并始终为外部系统签发最小作用域的 External API Key。
3. **反向代理务必关闭 SSE 缓冲**：使用 Nginx/Caddy 反代时若未关闭缓冲，生成流与模型探测思考流会出现长时间卡顿后一次性刷出的现象（参考 [环境要求与部署指南](Deployment-and-Environment.md) 中的配置）。
