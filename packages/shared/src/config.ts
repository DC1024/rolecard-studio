import { z } from 'zod';

export const LlmProviderSchema = z.enum([
  'openai',
  'anthropic',
  'azure',
  'siliconflow',
  'kimi',
  'deepseek',
  'qwen',
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

export const ServiceConfigInputSchema = z.object({
  primaryLlm: LlmSlotInputSchema,
  chatLlm: LlmSlotInputSchema.optional(),
  visionLlm: LlmSlotInputSchema.optional(),
  imageLlm: LlmSlotInputSchema.optional(),
  searchProvider: SearchProviderSchema.default('none'),
  searchApiKey: z.string().max(512).optional(),
  enableLayer1Wiki: z.boolean().default(true),
  dailyAutoRefreshLimit: z.number().int().min(1).max(500).default(20),
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
  customSystemPrompt: string;
  proxyConfig: MaskedProxyConfig;
  updatedAt: string | null;
}

export const LLM_PROVIDER_DEFAULTS: Record<LlmProvider, { label: string; baseUrl: string; defaultModel: string; requiresKey: boolean }> = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', requiresKey: true },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', requiresKey: true },
  siliconflow: { label: '硅基流动 (SiliconFlow)', baseUrl: 'https://api.siliconflow.cn/v1', defaultModel: 'Qwen/Qwen2.5-72B-Instruct', requiresKey: true },
  kimi: { label: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', requiresKey: true },
  qwen: { label: '通义千问 (DashScope)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus', requiresKey: true },
  anthropic: { label: 'Anthropic (兼容网关)', baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-5-sonnet-latest', requiresKey: true },
  azure: { label: 'Azure OpenAI', baseUrl: '', defaultModel: 'gpt-4o', requiresKey: true },
  ollama: { label: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'qwen2.5:14b', requiresKey: false },
  custom: { label: '自定义 OpenAI 兼容', baseUrl: '', defaultModel: 'gpt-4o-mini', requiresKey: true },
};
