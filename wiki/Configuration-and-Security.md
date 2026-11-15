# 配置项、代理、通知与安全

本文档详细说明系统设置中的所有配置模块，包括模型槽位、搜索引擎、两级网络代理、9 大多渠道通知以及 RBAC 与加密安全架构。

---

## 1. 四路大模型槽位配置

进入右上角 **「设置 → 模型槽位」**，可将不同任务解耦分配给最合适的模型与服务商：

| 槽位 | 标识 | 职责说明 | 回退策略 |
| --- | --- | --- | --- |
| **主生成模型（必填）** | `primaryLlm` | 角色卡创建、AI 微调、Token 压缩、TRPG 数值推演、定时演化推理与生图提示词生成 | 必须配置 |
| **试聊沙盒模型（可选）** | `chatLlm` | 快速试聊对话（适合配置专门擅长扮演/文风更佳的模型） | 未配置时回退至 `primaryLlm` |
| **视觉识图模型（可选）** | `visionLlm` | 根据参考立绘反推外貌描述与服饰特征 | 未配置时回退至 `primaryLlm` |
| **独立生图模型（可选）** | `imageLlm` | 立绘 `1024×1536` 文生图（自动适配 OpenAI、智谱 BigModel、硅基流动与魔搭异步轮询 4 种生图方言，并支持 `negativePrompt` 透传与短效外链本地转存） | 无回退，使用 AI 生图前必须显式配置 |

### 1.1 内置兼容服务商预设（15 家）

| Provider 标识 | 名称 | 默认 Base URL | 默认模型参考 | 免费额度 / 特性提示 |
| --- | --- | --- | --- | --- |
| `zhipu` | 智谱 AI (BigModel) | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.7-flash` | 文本（`glm-4.7-flash`）/ 识图（`glm-4.6v-flash`）/ 生图（`cogview-3-flash`）均有永久免费 Flash 模型 |
| `modelscope` | 魔搭社区 (ModelScope) | `https://api-inference.modelscope.cn/v1` | `Qwen/Qwen2.5-72B-Instruct` | 绑阿里云享每日免费推理额度（72B 文本 + VL 识图 + `Qwen-Image` 异步生图） |
| `siliconflow` | 硅基流动 (SiliconFlow) | `https://api.siliconflow.cn/v1` | `Qwen/Qwen3-8B` / `Qwen2.5-72B` | 部分 8B/9B 模型永久免费；新人赠金可用 72B / `Kwai-Kolors/Kolors` 生图 |
| `hunyuan` | 腾讯混元 (Hunyuan) | `https://api.hunyuan.cloud.tencent.com/v1` | `hunyuan-lite` | `hunyuan-lite` 永久免费 |
| `openrouter` | OpenRouter (聚合网关) | `https://openrouter.ai/api/v1` | `openrouter/free` | 免绑卡可用 `:free` 模型（50 次/天，需网络可达；请求自动附带 `X-Title` 归因头） |
| `groq` | Groq (LPU 极速) | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | 免卡永久 Free Tier（每日刷新配额，极速响应） |
| `gemini` | Google Gemini (OpenAI 兼容) | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` | AI Studio 免费层级（长上下文 + 原生识图，需网络可达/代理） |
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | 推荐 `deepseek-chat`（V3）与 `deepseek-reasoner` |
| `kimi` | Kimi (Moonshot) | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` | 长文本对话兼容 |
| `qwen` | 通义千问 (DashScope) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | 阿里云百炼新用户赠送各模型 100 万 Tokens |
| `openai` | OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | 生图槽位推荐 `gpt-image-1` / `dall-e-3` |
| `anthropic` | Anthropic（兼容网关） | `https://api.anthropic.com/v1` | `claude-3-5-sonnet-latest` | 需通过 OpenAI 兼容网关或适配层 |
| `azure` | Azure OpenAI | 需填写终结点 URL | `gpt-4o` | 企业终结点接入 |
| `ollama` | 本地 Ollama | `http://127.0.0.1:11434/v1` | `qwen2.5:14b` | 本地离线免费运行，无需 API Key |
| `custom` | 自定义 OpenAI 兼容 | 填写任意兼容接口 | `gpt-4o-mini` | 按实际网关模型填写 |

### 1.2 新手免费源站向导、模型推荐 Chips 与多协议生图兼容

- **新手免费源站一键向导**：在「设置 → 模型槽位」顶部可展开 4 套开箱预设——**智谱免费全家桶**（1 个 Key 跑通全部 4 槽位）、**魔搭 ModelScope 每日免费全能方案**、**硅基流动低门槛 + Kolors 立绘方案**、**OpenRouter 海外免费聚合方案**，一键填充各槽位服务商、Base URL 与推荐模型。
- **同服务商 Key 一键同步**：在主生成模型（`primary`）填写新 Key 或已保存 Key 后，当 `chat` / `vision` / `image` 中存在与主槽位同服务商的槽位时，点击 **「同步到同服务商其它槽位」** 即可一键复用，无需重复粘贴。
- **按槽位推荐模型 & 快捷 Chips**：切换不同槽位（如 `vision` / `image`）的服务商时，自动带出该槽位适配模型并展示热门模型快捷选择胶囊（含「免费」「极速」「中文极佳」等徽标与官网申请 Key 直达链接）。
- **多协议生图方言自动识别（`vision.ts`）**：
  - **OpenAI 兼容**：使用 `{ model, prompt, n: 1, size, response_format: 'b64_json' }`。
  - **智谱 BigModel**：使用 `{ model, prompt, size }`（自动剔除会触发 400 的 `n` 与 `response_format`）。
  - **硅基流动 SiliconFlow**：使用 `image_size` 与 `negative_prompt`；根据模型族自动映射竖版推荐分辨率（如 `Kwai-Kolors/Kolors` → `960×1280`，`Qwen/Qwen-Image` → `1056×1584`）。
  - **魔搭 ModelScope**：自动附带 `X-ModelScope-Async-Mode: true` 发起异步任务，并以 `X-ModelScope-Task-Type: image_generation` 轮询 `GET /v1/tasks/{task_id}`（支持 `negative_prompt` 与 `size`，`testLlmConnectivity` 探测超时自动放宽至 90 秒）。
  - **短效外链服务端自动转存**：若生图接口仅返回外链 URL（如硅基/智谱/魔搭 1 小时有效链接），服务端 `POST /api/v1/images/generate` 会使用同路 `llm_image` 代理立即拉取并转为 `dataUrl` 返回，避免前端加载跨域或链接过期。

### 1.3 结构化输出策略（`jsonModeStrategy`）、运行超时与输出上限

- **`auto`（推荐）**：优先使用 `response_format: { type: 'json_object' }` 请求结构化 JSON；若检测到服务商不支持该参数，系统会自动降级并记住切换为 `prompt` 策略。
- **`json_object`**：强制要求接口支持 `json_object`。
- **`prompt`**：仅通过系统提示词约束 JSON 输出并配合内置 JSON 修复解析器（适合部分本地模型或推理模型）。
- **SSE 实时探测**：点击每个槽位旁的「测试连接」会发起流式探测，实时打印进度阶段与模型思考流，验证无误后可安全保存。
- **大模型生成运行参数（设置页 → 主生成模型下方）**：
  - **流式空闲超时时间（`llmRequestTimeoutSeconds`）**：支持 `30–3600` 秒（默认 **`300`** 秒）。采用 **「每收到新 token 即重置」的空闲超时机制**，并配备宽松的请求总耗时上限；只要海外/慢速推理模型仍在持续输出 token，就不会因总耗时较长而被误杀。
  - **最大输出 Token 上限（`llmMaxTokens`）**：支持 `1024–131072`（默认 **`16384`**）。用于为长思考链模型留出充足的推理与 JSON 输出配额（若上游网关不支持 `max_tokens` 参数，系统会自动探测回退）；若发生 `finish_reason=length` 截断，系统会触发精简思考重试与尾部截断 JSON 抢救。
- **高级参数**：可在同页签设置 `dailyAutoRefreshLimit`（每日自动演化上限，默认 `20`，范围 `1–500`）与 `customSystemPrompt`（全局附加生成指令，最多 4000 字符）。

---

## 2. 检索配置（双层考据架构）

在 **「设置 → 检索设置」** 中管理考据来源：

1. **Layer-1 免 Key 公开百科（`enableLayer1Wiki`，默认开启）**：
   - 自动检索 **萌娘百科**（`zh.moegirl.org.cn`）、**PRTS Wiki**（`prts.wiki`）、**中文 Wikipedia** 与 **英文 Wikipedia**。
   - 无需申请任何 API Key，开箱即可完成大部分二次元/游戏/历史角色考据。
2. **Layer-2 通用搜索引擎（`searchProvider`，可选）**：
   - 支持 `none`（仅用 Layer-1）、`bocha`（博查）、`tavily`、`serpapi`、`bing`。
   - 如需覆盖冷门新作、近期事件或非百科收录人物，可填入对应 `searchApiKey` 作为补充。

---

## 3. 两级网络代理配置

在 **「设置 → 网络代理」** 中支持 **全局 + 分作用域精细控制**，支持 `http://`、`https://` 与 `socks5://` 协议（已保存的代理地址若包含鉴权密码同样加密脱敏存储）：

- **全局开关（`globalEnabled` / `globalUrl`）**：启用后，所有未单独覆写的作用域默认经此代理发出请求。
- **本地回环直连（`bypassLocal`，默认开启）**：访问 `127.0.0.1`、`localhost`、`::1`（例如本地 Ollama 或局域网服务）自动绕过代理，避免误走代理失败。
- **自动回退读取系统环境变量代理（`useEnvProxy`，默认开启）**：当未启用应用内全局代理、且对应作用域为 `inherit` 时，自动读取服务端进程的 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`（支持 `NO_PROXY` 排除规则），并在设置界面展示脱敏后的检测结果。
- **允许系统透明代理 / TUN Fake-IP（`allowFakeIp`，默认关闭）**：兼容 Clash / Mihomo 等系统或路由器级 TUN 透明代理所返回的 `198.18.0.0/15` Fake-IP DNS 解析结果；亦可通过服务端环境变量 `ROLECARD_ALLOW_FAKE_IP=true` 全局启用。开启后仅豁免 `198.18.0.0/15` 域名解析结果，真实私有/内网 IP（如 `127.0.0.1`、`192.168.x.x`）与直接 IP 字面量访问仍严格拦截。
- **7 大独立作用域覆写（`inherit` 继承全局 / `direct` 强制直连 / `custom` 指定独立代理）**：
  1. `llm_primary` — 主生成模型请求
  2. `llm_chat` — 试聊沙盒模型请求
  3. `llm_vision` — 视觉识图模型请求
  4. `llm_image` — 独立生图模型请求
  5. `search` — 百科与搜索引擎请求
  6. `media` — Wikimedia 搜图与外链立绘拉取
  7. `webhook` — 外部 Webhook 与多渠道通知发送
- **连通性测试**：支持一键对当前填写的临时代理地址、已保存的全局代理或某个已保存作用域进行连通性探测，立即返回 HTTP 探测状态码。

> **典型代理搭配示例**：在国内服务器部署时，开启全局代理指向本地代理端口；然后将使用国内接口的 `llm_primary`（如 DeepSeek）或本地 Ollama 设为 **`direct`（强制直连）**，同时保持 `search`、`media` 或海外生图接口继承全局代理。

---

## 4. 多渠道事件通知（9 大等权并行通道）

在顶栏 **「审核与同步」** 中可添加并管理任意数量的通知渠道。所有已启用且订阅对应事件的渠道**等权并发推送**（单一渠道超时或失败不会阻塞其余渠道，且每条渠道记录最近发送状态与错误信息）：

| 渠道类型 | 必填核心参数 |
| --- | --- |
| `smtp`（邮件） | `smtpHost`、`smtpPort`（默认 `465`）、`smtpSecure`、`smtpUser`、`smtpPass`、`smtpFrom`、`smtpTo` |
| `feishu`（飞书机器人） | `webhookUrl`、可选签名校验 `secret` |
| `wecom`（企业微信机器人） | `webhookUrl` |
| `dingtalk`（钉钉机器人） | `webhookUrl`、可选加签 `secret` |
| `telegram`（Telegram Bot） | `telegramBotToken`、`telegramChatId`、可选自定义反代 `telegramApiBaseUrl` |
| `discord`（Discord Webhook） | `webhookUrl` |
| `bark`（iOS Bark 推送） | `barkServerUrl`（默认 `https://api.day.app`）、`barkDeviceKey`、`barkGroup` |
| `serverchan`（Server 酱） | `serverChanSendKey` |
| `webhook`（通用 JSON Webhook） | `webhookUrl`、可选签名 `secret` |

**可订阅事件类型**：`review.pending`（待审核提案）、`card.evolved`（角色演化）、`card.updated`（角色更新）、`lorebook.updated`（世界书更新）、`ripple.approved`（单跳涟漪批准）。

---

## 5. RBAC 访问控制与安全加密机制

### 5.1 分离式访客策略（管理员配置）

管理员可在 **「设置 → 访问策略」** 分别配置网页端与外部 API 的匿名策略：

- **网页端访问模式（`siteAccessMode`）**：
  - `public`（默认）：允许未登录访客按 `guestPermissions`（默认仅 `['card:read']`）浏览角色卡库与世界书。
  - `login_required`：未登录状态禁止访问网页业务数据，强制要求登录。
- **外部 API 模式（`apiAccessMode`）**：
  - `authenticated`（默认）：调用 `/api/v1/external/*` 必须携带有效的 `Authorization: Bearer rc_ext_...` External API Key（在 **「设置 → 外部 API Key」** 创建；该 Key 仅作用于外部接口，不可用于登录工作台内部接口）。
  - `public`：允许匿名读取/调用外部接口（适合纯局域网个人实验环境；公网部署强烈建议保持 `authenticated`）。

### 5.2 7 项细粒度用户权限

| 权限标识 | 含义 |
| --- | --- |
| `card:read` | 查看角色卡库、版本历史、引用溯源与世界书 |
| `card:create` | 使用 Mode A/B/C 生成角色卡或导入旧卡 |
| `card:update` | 编辑与微调人设、管理标签、调整立绘与定时任务 |
| `card:delete` | 删除角色卡及关联历史 |
| `card:export` | 导出 PNG、CCV3 JSON、TRPG 车卡表、Token 与世界书 |
| `playtest:use` | 使用快速试聊沙盒验证设定与世界书触发 |
| `review:resolve` | 审核定时演化草稿与单跳涟漪提案 |

管理员可在 **「设置 → 用户管理」** 创建普通账号、分配上述权限、修改任意用户用户名/密码或禁用账号；系统严格禁止管理员自我降权或禁用最后一个活跃管理员。

### 5.3 密码学与网络安全基线

- **凭据加密**：所有大模型 API Key、搜索 Key、代理 URL、通知秘钥、Webhook Secret 均采用 **AES-256-GCM**（随机 IV + Auth Tag）配合 `ROLECARD_DATA_DIR/.master.key` 加密存储在 SQLite 中，前端读取接口永远只返回后 4 位脱敏掩码（如 `****abcd`）。
- **密码哈希**：用户密码使用随机盐 + **PBKDF2-SHA512** 哈希存储；会话 Token 与 External API Key（前缀 `rc_ext_`）在数据库中均只保存 **SHA-256 哈希**，明文 Key 仅在创建时展示一次。
- **SSRF 防护**：所有参考 URL、外链图片探测、Webhook 目标均会解析 DNS 并拦截内网网段（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`127.0.0.0/8`、`169.254.0.0/16`、`198.18.0.0/15`、`::1` 等）；仅当请求显式通过用户配置的网络代理/环境变量代理转发时豁免本地 DNS 检查，或在显式勾选「允许系统透明代理 / TUN Fake-IP」/设置 `ROLECARD_ALLOW_FAKE_IP=true` 时放行 `198.18.0.0/15` DNS 解析结果。
