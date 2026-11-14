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
  searchProvider: SearchProviderSchema.default('none'),
  searchApiKey: z.string().max(512).optional(),
  enableLayer1Wiki: z.boolean().default(true),
  dailyAutoRefreshLimit: z.number().int().min(1).max(500).default(20),
  customSystemPrompt: z.string().max(4000).default(''),
});
export type ServiceConfigInput = z.infer<typeof ServiceConfigInputSchema>;

export const LlmTestRequestSchema = z.object({
  provider: LlmProviderSchema,
  apiKey: z.string().max(512).optional(),
  baseUrl: z.string().url().optional().or(z.literal('')),
  model: z.string().trim().min(1).max(160),
  useSavedKeySlot: z.enum(['primary', 'chat', 'vision']).optional(),
});
export type LlmTestRequest = z.infer<typeof LlmTestRequestSchema>;

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
  searchProvider: SearchProvider;
  searchApiKeyMasked: string | null;
  hasSearchApiKey: boolean;
  enableLayer1Wiki: boolean;
  dailyAutoRefreshLimit: number;
  customSystemPrompt: string;
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
