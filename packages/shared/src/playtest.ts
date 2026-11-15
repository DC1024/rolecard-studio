import { z } from 'zod';
import { LlmProviderSchema, JsonModeStrategySchema } from './config.js';
import { RoleCardContentSchema } from './cards.js';

export const PlaytestHistoryItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(16_000),
});
export type PlaytestHistoryItem = z.infer<typeof PlaytestHistoryItemSchema>;

export const PlaytestTrpgSystemSchema = z.enum(['coc7e', 'dnd5e', 'none']);
export type PlaytestTrpgSystem = z.infer<typeof PlaytestTrpgSystemSchema>;

export const PlaytestRequestSchema = z.object({
  message: z.string().trim().min(1, '试聊消息不能为空').max(8_000),
  history: z.array(PlaytestHistoryItemSchema).max(40).default([]),
  userName: z.string().trim().min(1).max(40).default('旅行者'),
  userPersona: z.string().trim().max(400).default(''),
  greetingIndex: z.number().int().min(0).max(50).default(0),
  trpgSystem: PlaytestTrpgSystemSchema.optional(),
  modelOverride: z
    .object({
      provider: LlmProviderSchema.optional(),
      model: z.string().trim().min(1).max(160),
      baseUrl: z.string().url().optional().or(z.literal('')),
      jsonModeStrategy: JsonModeStrategySchema.optional(),
    })
    .optional(),
});
export type PlaytestRequest = z.infer<typeof PlaytestRequestSchema>;

export interface HitLorebookDebugItem {
  lorebookId: string;
  lorebookName: string;
  uid: string;
  comment: string;
  keys: string[];
  mode: 'blue_constant' | 'green_keyword';
  matchedKeyword?: string;
}

export interface PlaytestResponse {
  reply: string;
  usedModel: string;
  usedProvider: string;
  greetingText: string;
  hitLorebooks: HitLorebookDebugItem[];
  metaInjected: boolean;
  trpgSystemInjected?: 'coc7e' | 'dnd5e' | null;
}

export const AdoptMesExampleSchema = z.object({
  userMessage: z.string().trim().min(1).max(4000),
  assistantMessage: z.string().trim().min(1).max(8000),
});
export type AdoptMesExampleRequest = z.infer<typeof AdoptMesExampleSchema>;

export const RefineCardRequestSchema = z.object({
  instruction: z.string().trim().min(2, '微调指令至少需要 2 个字符').max(2000),
  sourceIndices: z.array(z.number().int().min(0)).max(20).optional(),
});
export type RefineCardRequest = z.infer<typeof RefineCardRequestSchema>;

export const UpdateCardContentSchema = z.object({
  content: RoleCardContentSchema,
  lockedFields: z.array(z.string().trim().min(1).max(64)).max(30).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(30).optional(),
});
export type UpdateCardContentRequest = z.infer<typeof UpdateCardContentSchema>;

export const TokenCropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  size: z.number().min(0.05).max(1),
});
export type TokenCrop = z.infer<typeof TokenCropSchema>;

export const CardImageUploadSchema = z.object({
  mode: z.enum(['upload', 'search_url', 'crop_token']),
  dataUrl: z.string().max(4_000_000).optional(),
  tokenDataUrl: z.string().max(4_000_000).optional(),
  tokenCrop: TokenCropSchema.optional(),
  imageUrl: z.string().url().max(2048).optional(),
  imagePrompt: z.string().max(2000).optional(),
});
export type CardImageUploadRequest = z.infer<typeof CardImageUploadSchema>;
