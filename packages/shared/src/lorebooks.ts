import { z } from 'zod';
import { LorebookEntrySchema } from './ccv3.js';
import { CardTypeSchema } from './cards.js';

export const CreateLorebookSchema = z.object({
  name: z.string().trim().min(1, '世界书名称不能为空').max(120),
  description: z.string().max(2000).optional().default(''),
  worldSummary: z.string().max(12_000).optional().default(''),
  scanDepth: z.number().int().min(0).max(50).optional().default(4),
  tokenBudget: z.number().int().min(100).max(32_000).optional().default(1500),
  recursiveScanning: z.boolean().optional().default(false),
  entries: z.array(LorebookEntrySchema).max(200).optional().default([]),
  tags: z.array(z.string().trim().min(1).max(32)).max(30).optional().default([]),
});
export type CreateLorebookRequest = z.infer<typeof CreateLorebookSchema>;

export const UpdateLorebookSchema = CreateLorebookSchema.partial();
export type UpdateLorebookRequest = z.infer<typeof UpdateLorebookSchema>;

export const LinkCharacterToLorebookSchema = z.object({
  cardId: z.string().trim().min(1),
  relationRole: z.string().trim().max(80).optional().default('核心人物'),
  keys: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  constant: z.boolean().optional().default(false),
});
export type LinkCharacterToLorebookRequest = z.infer<typeof LinkCharacterToLorebookSchema>;

export interface LorebookCharacterLinkDto {
  id: string;
  lorebookId: string;
  cardId: string;
  characterName: string;
  entryUid: string;
  relationRole: string;
  createdAt: string;
}

export interface LorebookDto {
  id: string;
  userId: string;
  name: string;
  description: string;
  worldSummary: string;
  scanDepth: number;
  tokenBudget: number;
  recursiveScanning: boolean;
  entries: z.infer<typeof LorebookEntrySchema>[];
  tags: string[];
  linkedCards: LorebookCharacterLinkDto[];
  createdAt: string;
  updatedAt: string;
}

export const ImportCardRequestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  format: z.enum(['png', 'json']).optional(),
  pngBase64: z.string().max(6_000_000).optional(),
  jsonText: z.string().max(2_000_000).optional(),
  targetCardType: CardTypeSchema.optional().default('sillytavern_v3'),
  importEmbeddedLorebook: z.boolean().optional().default(true),
  tags: z.array(z.string().trim().min(1).max(32)).max(30).optional().default([]),
});
export type ImportCardRequest = z.infer<typeof ImportCardRequestSchema>;
