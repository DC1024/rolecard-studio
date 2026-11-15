import { z } from 'zod';

export const LlmProviderSchema = z.enum([
  'zhipu',
  'modelscope',
  'siliconflow',
  'hunyuan',
  'openrouter',
  'groq',
  'gemini',
  'deepseek',
  'kimi',
  'qwen',
  'openai',
  'anthropic',
  'azure',
  'ollama',
  'custom',
]);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const JsonModeStrategySchema = z.enum(['auto', 'json_object', 'prompt']);
export type JsonModeStrategy = z.infer<typeof JsonModeStrategySchema>;

export const SearchProviderSchema = z.enum(['none', 'bocha', 'tavily', 'serpapi', 'bing']);
export type SearchProvider = z.infer<typeof SearchProviderSchema>;

export const LlmSlotPurposeSchema = z.enum(['primary', 'chat', 'vision', 'image']);
export type LlmSlotPurpose = z.infer<typeof LlmSlotPurposeSchema>;

export const ProxyScopeSchema = z.enum([
  'llm_primary',
  'llm_chat',
  'llm_vision',
  'llm_image',
  'search',
  'media',
  'webhook',
]);
export type ProxyScope = z.infer<typeof ProxyScopeSchema>;

export const ALL_PROXY_SCOPES: readonly ProxyScope[] = [
  'llm_primary',
  'llm_chat',
  'llm_vision',
  'llm_image',
  'search',
  'media',
  'webhook',
] as const;

export const PROXY_SCOPE_META: Record<ProxyScope, { label: string; desc: string }> = {
  llm_primary: { label: '主生成模型 (Primary LLM)', desc: '角色卡创建、AI 微调、压缩与演化推理请求' },
  llm_chat: { label: '试聊沙盒模型 (Chat LLM)', desc: '角色扮演快速试聊对话请求' },
  llm_vision: { label: '视觉识图模型 (Vision LLM)', desc: '参考图反推外貌与设定请求' },
  llm_image: { label: '独立生图模型 (Image Model)', desc: '立绘 AI 文生图接口请求' },
  search: { label: '联网检索与百科 (Search)', desc: 'Wikipedia / 萌娘百科 / PRTS 及 Tavily/Bocha/SerpAPI/Bing' },
  media: { label: '搜图与远程图片 (Media)', desc: 'Wikimedia 搜图、远程立绘下载等媒体请求' },
  webhook: { label: 'Webhook 与通知渠道', desc: '同步订阅 Webhook、Telegram/Bark/ServerChan 等外发通知' },
};

export const ProxyOverrideModeSchema = z.enum(['inherit', 'direct', 'custom']);
export type ProxyOverrideMode = z.infer<typeof ProxyOverrideModeSchema>;

export const ProxyScopeOverrideInputSchema = z.object({
  mode: ProxyOverrideModeSchema.default('inherit'),
  url: z.string().max(512).optional().default(''),
  preserveStoredUrl: z.boolean().optional(),
});
export type ProxyScopeOverrideInput = z.infer<typeof ProxyScopeOverrideInputSchema>;

export const ProxyConfigInputSchema = z.object({
  globalEnabled: z.boolean().default(false),
  globalUrl: z.string().max(512).optional().default(''),
  preserveStoredGlobalUrl: z.boolean().optional(),
  bypassLocal: z.boolean().default(true),
  allowFakeIp: z.boolean().default(false),
  useEnvProxy: z.boolean().default(true),
  overrides: z
    .object({
      llm_primary: ProxyScopeOverrideInputSchema.optional(),
      llm_chat: ProxyScopeOverrideInputSchema.optional(),
      llm_vision: ProxyScopeOverrideInputSchema.optional(),
      llm_image: ProxyScopeOverrideInputSchema.optional(),
      search: ProxyScopeOverrideInputSchema.optional(),
      media: ProxyScopeOverrideInputSchema.optional(),
      webhook: ProxyScopeOverrideInputSchema.optional(),
    })
    .default({}),
});
export type ProxyConfigInput = z.infer<typeof ProxyConfigInputSchema>;

export interface MaskedProxyScopeOverride {
  mode: ProxyOverrideMode;
  urlMasked: string | null;
  hasUrl: boolean;
}

export interface MaskedProxyConfig {
  globalEnabled: boolean;
  globalUrlMasked: string | null;
  hasGlobalUrl: boolean;
  bypassLocal: boolean;
  allowFakeIp: boolean;
  useEnvProxy: boolean;
  envProxyDetected: string | null;
  overrides: Partial<Record<ProxyScope, MaskedProxyScopeOverride>>;
}

export const ProxyTestRequestSchema = z.object({
  proxyUrl: z.string().max(512).optional(),
  useSavedScope: z.union([z.literal('global'), ProxyScopeSchema]).optional(),
  targetUrl: z.string().url().optional(),
});
export type ProxyTestRequest = z.infer<typeof ProxyTestRequestSchema>;

export const LlmSlotInputSchema = z.object({
  provider: LlmProviderSchema,
  apiKey: z.string().max(512).optional(),
  baseUrl: z.string().url().optional().or(z.literal('')),
  model: z.string().trim().min(1).max(160),
  jsonModeStrategy: JsonModeStrategySchema.default('auto'),
});
export type LlmSlotInput = z.infer<typeof LlmSlotInputSchema>;

export const DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS = 300;
export const DEFAULT_LLM_MAX_TOKENS = 16384;

export const ServiceConfigInputSchema = z.object({
  primaryLlm: LlmSlotInputSchema,
  chatLlm: LlmSlotInputSchema.optional(),
  visionLlm: LlmSlotInputSchema.optional(),
  imageLlm: LlmSlotInputSchema.optional(),
  searchProvider: SearchProviderSchema.default('none'),
  searchApiKey: z.string().max(512).optional(),
  enableLayer1Wiki: z.boolean().default(true),
  dailyAutoRefreshLimit: z.number().int().min(1).max(500).default(20),
  llmRequestTimeoutSeconds: z
    .number()
    .int()
    .min(30)
    .max(3600)
    .default(DEFAULT_LLM_REQUEST_TIMEOUT_SECONDS),
  llmMaxTokens: z
    .number()
    .int()
    .min(1024)
    .max(131072)
    .default(DEFAULT_LLM_MAX_TOKENS),
  customSystemPrompt: z.string().max(4000).default(''),
  proxyConfig: ProxyConfigInputSchema.optional(),
});
export type ServiceConfigInput = z.infer<typeof ServiceConfigInputSchema>;

export const LlmTestRequestSchema = z.object({
  provider: LlmProviderSchema,
  apiKey: z.string().max(512).optional(),
  baseUrl: z.string().url().optional().or(z.literal('')),
  model: z.string().trim().min(1).max(160),
  slotType: LlmSlotPurposeSchema.default('primary'),
  useSavedKeySlot: LlmSlotPurposeSchema.optional(),
  proxyConfig: ProxyConfigInputSchema.optional(),
});
export type LlmTestRequest = z.infer<typeof LlmTestRequestSchema>;

export const SearchTestRequestSchema = z.object({
  provider: SearchProviderSchema,
  apiKey: z.string().max(512).optional(),
  useSavedKey: z.boolean().optional(),
  testLayer1Wiki: z.boolean().optional().default(false),
  query: z.string().trim().min(1).max(120).optional().default('Alan Turing'),
  proxyConfig: ProxyConfigInputSchema.optional(),
});
export type SearchTestRequest = z.infer<typeof SearchTestRequestSchema>;

export interface SearchTestResult {
  ok: boolean;
  provider: SearchProvider;
  latencyMs: number;
  hitCount: number;
  sampleTitles: string[];
  layer1Reachable?: boolean;
  layer1Summary?: string;
  message: string;
  error?: string;
}

export interface MaskedLlmSlot {
  provider: LlmProvider;
  apiKeyMasked: string | null;
  hasApiKey: boolean;
  baseUrl: string;
  model: string;
  jsonModeStrategy: JsonModeStrategy;
}

export interface MaskedServiceConfig {
  configured: boolean;
  primaryLlm: MaskedLlmSlot | null;
  chatLlm: MaskedLlmSlot | null;
  visionLlm: MaskedLlmSlot | null;
  imageLlm: MaskedLlmSlot | null;
  searchProvider: SearchProvider;
  searchApiKeyMasked: string | null;
  hasSearchApiKey: boolean;
  enableLayer1Wiki: boolean;
  dailyAutoRefreshLimit: number;
  llmRequestTimeoutSeconds: number;
  llmMaxTokens: number;
  customSystemPrompt: string;
  proxyConfig: MaskedProxyConfig;
  updatedAt: string | null;
}

export interface ProviderModelChip {
  id: string;
  label: string;
  badge?: string;
}

export interface LlmProviderDefaultMeta {
  label: string;
  baseUrl: string;
  defaultModel: string;
  requiresKey: boolean;
  freeTierBadge?: string;
  signupUrl?: string;
  recommendedSlots?: Partial<
    Record<
      LlmSlotPurpose,
      {
        model: string;
        chips?: ProviderModelChip[];
      }
    >
  >;
}

export const LLM_PROVIDER_DEFAULTS: Record<LlmProvider, LlmProviderDefaultMeta> = {
  zhipu: {
    label: '智谱 AI (BigModel)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.7-flash',
    requiresKey: true,
    freeTierBadge: '文本 / 视觉 / 生图均有永久免费 Flash 模型',
    signupUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    recommendedSlots: {
      primary: {
        model: 'glm-4.7-flash',
        chips: [
          { id: 'glm-4.7-flash', label: 'GLM-4.7-Flash', badge: '免费' },
          { id: 'glm-4.5-flash', label: 'GLM-4.5-Flash', badge: '免费' },
          { id: 'glm-4-plus', label: 'GLM-4-Plus', badge: '旗舰' },
        ],
      },
      chat: {
        model: 'glm-4.7-flash',
        chips: [
          { id: 'glm-4.7-flash', label: 'GLM-4.7-Flash', badge: '免费' },
          { id: 'glm-4-flash', label: 'GLM-4-Flash', badge: '免费' },
        ],
      },
      vision: {
        model: 'glm-4.6v-flash',
        chips: [
          { id: 'glm-4.6v-flash', label: 'GLM-4.6V-Flash', badge: '免费识图' },
          { id: 'glm-4v-flash', label: 'GLM-4V-Flash', badge: '免费' },
        ],
      },
      image: {
        model: 'cogview-3-flash',
        chips: [
          { id: 'cogview-3-flash', label: 'CogView-3-Flash', badge: '免费生图' },
          { id: 'cogview-4', label: 'CogView-4', badge: '高清付费' },
          { id: 'glm-image', label: 'GLM-Image', badge: '旗舰付费' },
        ],
      },
    },
  },
  modelscope: {
    label: '魔搭社区 (ModelScope)',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    requiresKey: true,
    freeTierBadge: '绑阿里云享每日免费推理额度（文本 + 识图 + 生图）',
    signupUrl: 'https://modelscope.cn/my/myaccesstoken',
    recommendedSlots: {
      primary: {
        model: 'Qwen/Qwen2.5-72B-Instruct',
        chips: [
          { id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen2.5-72B', badge: '免费额度' },
          { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3', badge: '免费额度' },
          { id: 'Qwen/Qwen3-32B', label: 'Qwen3-32B', badge: '免费额度' },
        ],
      },
      chat: {
        model: 'Qwen/Qwen2.5-72B-Instruct',
        chips: [
          { id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen2.5-72B' },
          { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3' },
        ],
      },
      vision: {
        model: 'Qwen/Qwen2.5-VL-72B-Instruct',
        chips: [
          { id: 'Qwen/Qwen2.5-VL-72B-Instruct', label: 'Qwen2.5-VL-72B', badge: '免费识图' },
        ],
      },
      image: {
        model: 'Qwen/Qwen-Image',
        chips: [
          { id: 'Qwen/Qwen-Image', label: 'Qwen-Image', badge: '免费额度' },
          { id: 'Tongyi-MAI/Z-Image-Turbo', label: 'Z-Image-Turbo', badge: '极速' },
        ],
      },
    },
  },
  siliconflow: {
    label: '硅基流动 (SiliconFlow)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    requiresKey: true,
    freeTierBadge: '部分 8B/9B 永久免费 · 新人赠金可用 72B / Kolors 生图',
    signupUrl: 'https://cloud.siliconflow.cn/account/ak',
    recommendedSlots: {
      primary: {
        model: 'Qwen/Qwen3-8B',
        chips: [
          { id: 'Qwen/Qwen3-8B', label: 'Qwen3-8B', badge: '永久免费' },
          { id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen2.5-72B', badge: '赠金更稳' },
          { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3', badge: '赠金旗舰' },
        ],
      },
      chat: {
        model: 'Qwen/Qwen3-8B',
        chips: [
          { id: 'Qwen/Qwen3-8B', label: 'Qwen3-8B', badge: '永久免费' },
          { id: 'THUDM/glm-4-9b-chat', label: 'GLM-4-9B', badge: '永久免费' },
        ],
      },
      vision: {
        model: 'Qwen/Qwen2.5-VL-72B-Instruct',
        chips: [
          { id: 'Qwen/Qwen2.5-VL-72B-Instruct', label: 'Qwen2.5-VL-72B' },
          { id: 'Pro/Qwen/Qwen2.5-VL-7B-Instruct', label: 'Qwen2.5-VL-7B' },
        ],
      },
      image: {
        model: 'Kwai-Kolors/Kolors',
        chips: [
          { id: 'Kwai-Kolors/Kolors', label: 'Kolors 可图', badge: '中文极佳' },
          { id: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX.1-schnell', badge: '极速' },
          { id: 'Qwen/Qwen-Image', label: 'Qwen-Image' },
        ],
      },
    },
  },
  hunyuan: {
    label: '腾讯混元 (Hunyuan)',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    defaultModel: 'hunyuan-lite',
    requiresKey: true,
    freeTierBadge: 'hunyuan-lite 永久免费',
    signupUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    recommendedSlots: {
      primary: {
        model: 'hunyuan-lite',
        chips: [
          { id: 'hunyuan-lite', label: 'hunyuan-lite', badge: '永久免费' },
          { id: 'hunyuan-turbo', label: 'hunyuan-turbo' },
        ],
      },
      chat: {
        model: 'hunyuan-lite',
        chips: [{ id: 'hunyuan-lite', label: 'hunyuan-lite', badge: '永久免费' }],
      },
      vision: {
        model: 'hunyuan-vision',
        chips: [{ id: 'hunyuan-vision', label: 'hunyuan-vision' }],
      },
    },
  },
  openrouter: {
    label: 'OpenRouter (聚合网关)',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free',
    requiresKey: true,
    freeTierBadge: '免绑卡可用 :free 模型（50 次/天，需网络可达）',
    signupUrl: 'https://openrouter.ai/keys',
    recommendedSlots: {
      primary: {
        model: 'openrouter/free',
        chips: [
          { id: 'openrouter/free', label: '自动免费路由', badge: '免费' },
          { id: 'deepseek/deepseek-chat-v3-0324:free', label: 'DeepSeek-V3:free', badge: '免费' },
          { id: 'google/gemma-3-27b-it:free', label: 'Gemma-3-27B:free', badge: '免费' },
        ],
      },
      chat: {
        model: 'openrouter/free',
        chips: [{ id: 'openrouter/free', label: '自动免费路由', badge: '免费' }],
      },
      vision: {
        model: 'google/gemma-3-27b-it:free',
        chips: [{ id: 'google/gemma-3-27b-it:free', label: 'Gemma-3-27B:free', badge: '免费识图' }],
      },
    },
  },
  groq: {
    label: 'Groq (LPU 极速)',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    requiresKey: true,
    freeTierBadge: '免卡永久 Free Tier（每日刷新配额，极速响应）',
    signupUrl: 'https://console.groq.com/keys',
    recommendedSlots: {
      primary: {
        model: 'llama-3.3-70b-versatile',
        chips: [
          { id: 'llama-3.3-70b-versatile', label: 'Llama-3.3-70B', badge: '免费' },
          { id: 'qwen/qwen3-32b', label: 'Qwen3-32B', badge: '免费' },
        ],
      },
      chat: {
        model: 'llama-3.3-70b-versatile',
        chips: [{ id: 'llama-3.3-70b-versatile', label: 'Llama-3.3-70B', badge: '免费' }],
      },
    },
  },
  gemini: {
    label: 'Google Gemini (OpenAI 兼容)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    requiresKey: true,
    freeTierBadge: 'AI Studio 免费层级（长上下文 + 原生识图，需代理）',
    signupUrl: 'https://aistudio.google.com/apikey',
    recommendedSlots: {
      primary: {
        model: 'gemini-2.5-flash',
        chips: [
          { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', badge: '免费层' },
          { id: 'gemini-2.5-flash-lite', label: 'Flash-Lite', badge: '高配额' },
        ],
      },
      chat: {
        model: 'gemini-2.5-flash',
        chips: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', badge: '免费层' }],
      },
      vision: {
        model: 'gemini-2.5-flash',
        chips: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', badge: '免费识图' }],
      },
    },
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    requiresKey: true,
    signupUrl: 'https://platform.deepseek.com/api_keys',
    recommendedSlots: {
      primary: {
        model: 'deepseek-chat',
        chips: [
          { id: 'deepseek-chat', label: 'DeepSeek-V3' },
          { id: 'deepseek-reasoner', label: 'DeepSeek-R1' },
        ],
      },
      chat: {
        model: 'deepseek-chat',
        chips: [{ id: 'deepseek-chat', label: 'DeepSeek-V3' }],
      },
    },
  },
  kimi: {
    label: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    requiresKey: true,
    signupUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  qwen: {
    label: '通义千问 (DashScope)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    requiresKey: true,
    freeTierBadge: '阿里云百炼新用户赠送各模型 100 万 Tokens',
    signupUrl: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key',
    recommendedSlots: {
      primary: {
        model: 'qwen-plus',
        chips: [
          { id: 'qwen-plus', label: 'Qwen-Plus' },
          { id: 'qwen-max', label: 'Qwen-Max' },
        ],
      },
      vision: {
        model: 'qwen-vl-max',
        chips: [{ id: 'qwen-vl-max', label: 'Qwen-VL-Max' }],
      },
    },
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    requiresKey: true,
    signupUrl: 'https://platform.openai.com/api-keys',
    recommendedSlots: {
      primary: { model: 'gpt-4o-mini' },
      vision: { model: 'gpt-4o-mini' },
      image: {
        model: 'gpt-image-1',
        chips: [
          { id: 'gpt-image-1', label: 'gpt-image-1' },
          { id: 'dall-e-3', label: 'dall-e-3' },
        ],
      },
    },
  },
  anthropic: {
    label: 'Anthropic (兼容网关)',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-latest',
    requiresKey: true,
    signupUrl: 'https://console.anthropic.com/settings/keys',
  },
  azure: {
    label: 'Azure OpenAI',
    baseUrl: '',
    defaultModel: 'gpt-4o',
    requiresKey: true,
  },
  ollama: {
    label: '本地 Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5:14b',
    requiresKey: false,
    freeTierBadge: '本地离线免费运行，无需 API Key',
  },
  custom: {
    label: '自定义 OpenAI 兼容',
    baseUrl: '',
    defaultModel: 'gpt-4o-mini',
    requiresKey: true,
  },
};

export interface FreeStarterPresetSlot {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  jsonModeStrategy?: JsonModeStrategy;
}

export interface FreeStarterPreset {
  id: string;
  title: string;
  subtitle: string;
  highlights: string[];
  caveat: string;
  signupUrl: string;
  signupLabel: string;
  requiresProxyHint?: boolean;
  slots: {
    primary: FreeStarterPresetSlot;
    chat?: FreeStarterPresetSlot;
    vision?: FreeStarterPresetSlot;
    image?: FreeStarterPresetSlot;
  };
}

export const FREE_STARTER_PRESETS: readonly FreeStarterPreset[] = [
  {
    id: 'zhipu-all-in-one',
    title: '智谱免费全家桶（推荐国内直连）',
    subtitle: '1 个免费 Key 同时跑通建卡、试聊、识图与生图全部 4 个槽位',
    highlights: ['文本 glm-4.7-flash', '视觉 glm-4.6v-flash', '生图 cogview-3-flash'],
    caveat: '免费档并发限 1（极低并发），适合单人/小团队开箱体验；高并发可换付费版。',
    signupUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    signupLabel: '去智谱控制台免费创建 Key',
    slots: {
      primary: {
        provider: 'zhipu',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'glm-4.7-flash',
        jsonModeStrategy: 'auto',
      },
      chat: {
        provider: 'zhipu',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'glm-4.7-flash',
        jsonModeStrategy: 'auto',
      },
      vision: {
        provider: 'zhipu',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'glm-4.6v-flash',
        jsonModeStrategy: 'auto',
      },
      image: {
        provider: 'zhipu',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'cogview-3-flash',
        jsonModeStrategy: 'auto',
      },
    },
  },
  {
    id: 'modelscope-daily-free',
    title: '魔搭 ModelScope 每日免费全能方案',
    subtitle: '绑定阿里云账号即可使用 Qwen2.5-72B、Qwen2.5-VL 与 Qwen-Image',
    highlights: ['旗舰 72B 建卡', '72B 视觉反推', 'Qwen-Image 异步生图'],
    caveat: '需先在魔搭绑定阿里云账号；生图走异步队列，单张约需 10-40 秒。',
    signupUrl: 'https://modelscope.cn/my/myaccesstoken',
    signupLabel: '去魔搭复制访问令牌',
    slots: {
      primary: {
        provider: 'modelscope',
        baseUrl: 'https://api-inference.modelscope.cn/v1',
        model: 'Qwen/Qwen2.5-72B-Instruct',
        jsonModeStrategy: 'auto',
      },
      chat: {
        provider: 'modelscope',
        baseUrl: 'https://api-inference.modelscope.cn/v1',
        model: 'Qwen/Qwen2.5-72B-Instruct',
        jsonModeStrategy: 'auto',
      },
      vision: {
        provider: 'modelscope',
        baseUrl: 'https://api-inference.modelscope.cn/v1',
        model: 'Qwen/Qwen2.5-VL-72B-Instruct',
        jsonModeStrategy: 'auto',
      },
      image: {
        provider: 'modelscope',
        baseUrl: 'https://api-inference.modelscope.cn/v1',
        model: 'Qwen/Qwen-Image',
        jsonModeStrategy: 'auto',
      },
    },
  },
  {
    id: 'siliconflow-starter',
    title: '硅基流动低门槛 + Kolors 立绘方案',
    subtitle: '8B 文本永久免费，配合新人体验金体验 72B 与中文强项 Kolors 可图',
    highlights: ['Qwen3-8B 永久免费', 'Qwen2.5-VL 识图', 'Kolors 二次元立绘'],
    caveat: '免费 8B 模型生成超长复杂 JSON 时建议适度精简设定，或切为 72B/DeepSeek。',
    signupUrl: 'https://cloud.siliconflow.cn/account/ak',
    signupLabel: '去硅基流动领新人额度',
    slots: {
      primary: {
        provider: 'siliconflow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'Qwen/Qwen3-8B',
        jsonModeStrategy: 'auto',
      },
      chat: {
        provider: 'siliconflow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'Qwen/Qwen3-8B',
        jsonModeStrategy: 'auto',
      },
      vision: {
        provider: 'siliconflow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'Qwen/Qwen2.5-VL-72B-Instruct',
        jsonModeStrategy: 'auto',
      },
      image: {
        provider: 'siliconflow',
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'Kwai-Kolors/Kolors',
        jsonModeStrategy: 'auto',
      },
    },
  },
  {
    id: 'openrouter-overseas',
    title: 'OpenRouter 免卡出海免费档',
    subtitle: '无需绑定信用卡即可使用 :free 模型池（主生成 + 试聊 + 识图）',
    highlights: ['免信用卡注册', '自动免费路由', 'Gemma-3-27B 识图'],
    caveat: '免费账号限 50 次/天且不含文生图；国内网络通常需配合「网络代理」Tab 使用。',
    signupUrl: 'https://openrouter.ai/keys',
    signupLabel: '去 OpenRouter 生成 Key',
    requiresProxyHint: true,
    slots: {
      primary: {
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openrouter/free',
        jsonModeStrategy: 'auto',
      },
      chat: {
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openrouter/free',
        jsonModeStrategy: 'auto',
      },
      vision: {
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'google/gemma-3-27b-it:free',
        jsonModeStrategy: 'auto',
      },
    },
  },
];
