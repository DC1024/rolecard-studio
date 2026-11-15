import { z } from 'zod';

export const CardTypeSchema = z.enum([
  'general',
  'sillytavern_v3',
  'trpg_coc7',
  'trpg_dnd5e',
  'custom',
]);
export type CardType = z.infer<typeof CardTypeSchema>;

export const GenerationModeSchema = z.enum(['A', 'B', 'C']);
export type GenerationMode = z.infer<typeof GenerationModeSchema>;

export const EntityTypeSchema = z.enum(['fictional', 'real_person']);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const PublishStatusSchema = z.enum(['published', 'pending_review', 'archived']);
export type PublishStatus = z.infer<typeof PublishStatusSchema>;

export const SourceOriginSchema = z.enum(['user_provided', 'search_supplement']);
export type SourceOrigin = z.infer<typeof SourceOriginSchema>;

export const SourceEntrySchema = z.object({
  title: z.string().trim().min(1),
  url: z.string().url().optional(),
  snippet: z.string().trim().min(1),
  origin: SourceOriginSchema,
  provider: z.string().trim().min(1).optional(),
});
export type SourceEntry = z.infer<typeof SourceEntrySchema>;

export const SpeechStyleSchema = z.object({
  tone: z.string().default(''),
  catchphrases: z.array(z.string()).default([]),
  habits: z.array(z.string()).default([]),
});

export const RelationshipEntrySchema = z.object({
  target: z.string().trim().min(1),
  relation: z.string().trim().min(1),
  attitude: z.string().default(''),
});

export const RoleCardContentSchema = z.object({
  name: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  personality: z.string().trim().min(1),
  appearance: z.string().default(''),
  background: z.string().default(''),
  speech_style: SpeechStyleSchema.default({ tone: '', catchphrases: [], habits: [] }),
  relationships: z.array(RelationshipEntrySchema).default([]),
  first_mes: z.string().default(''),
  alternate_greetings: z.array(z.string()).default([]),
  mes_example: z.string().default(''),
  system_prompt: z.string().default(''),
  scenario: z.string().default(''),
  creator_notes: z.string().default(''),
  tags: z.array(z.string()).default([]),
  extensions: z.record(z.unknown()).default({}),
});
export type RoleCardContent = z.infer<typeof RoleCardContentSchema>;

export const GenerateCardRequestSchema = z.object({
  mode: GenerationModeSchema,
  characterName: z.string().trim().min(1, '角色名不能为空').max(120),
  workName: z.string().trim().max(120).optional().default(''),
  cardType: CardTypeSchema.default('sillytavern_v3'),
  entityType: EntityTypeSchema.default('fictional'),
  referenceText: z.string().max(100_000).optional().default(''),
  referenceUrls: z.array(z.string().url()).max(5).optional().default([]),
  visionDescription: z.string().max(10_000).optional().default(''),
  enableSupplementSearch: z.boolean().optional().default(false),
  tags: z.array(z.string().trim().min(1).max(32)).max(30).optional().default([]),
  lorebookIds: z.array(z.string().trim().min(1)).max(10).optional().default([]),
  customPrompt: z.string().max(2_000).optional().default(''),
});
export type GenerateCardRequest = z.infer<typeof GenerateCardRequestSchema>;

export const CardListQuerySchema = z.object({
  q: z.string().trim().optional(),
  tags: z.string().trim().optional(),
  cardType: CardTypeSchema.optional(),
  mode: GenerationModeSchema.optional(),
  scheduleEnabled: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type CardListQuery = z.infer<typeof CardListQuerySchema>;

export const UpdateCardTagsSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(32)).max(30),
});
export type UpdateCardTagsRequest = z.infer<typeof UpdateCardTagsSchema>;

export const TrpgSystemKeySchema = z.enum(['coc7e', 'dnd5e']);
export type TrpgSystemKey = z.infer<typeof TrpgSystemKeySchema>;

export const GenerateTrpgStatsSchema = z.object({
  system: TrpgSystemKeySchema,
  activate: z.boolean().optional().default(true),
});
export type GenerateTrpgStatsRequest = z.infer<typeof GenerateTrpgStatsSchema>;

export const SwitchTrpgSystemSchema = z.object({
  system: TrpgSystemKeySchema,
});
export type SwitchTrpgSystemRequest = z.infer<typeof SwitchTrpgSystemSchema>;

export const CardGeneratableFieldSchema = z.enum([
  'summary',
  'personality',
  'appearance',
  'background',
  'scenario',
  'speech_style',
  'relationships',
  'first_mes',
  'alternate_greetings',
  'mes_example',
  'system_prompt',
  'creator_notes',
  'tags',
]);
export type CardGeneratableField = z.infer<typeof CardGeneratableFieldSchema>;

export const GenerateCardFieldRequestSchema = z.object({
  field: CardGeneratableFieldSchema,
  instruction: z.string().trim().max(500).optional().default(''),
  sourceIndices: z.array(z.number().int().min(0)).max(20).optional(),
});
export type GenerateCardFieldRequest = z.infer<typeof GenerateCardFieldRequestSchema>;

export const RegenerateCardRequestSchema = z.object({
  instruction: z.string().trim().max(1000).optional().default(''),
  sourceIndices: z.array(z.number().int().min(0)).max(20).optional(),
});
export type RegenerateCardRequest = z.infer<typeof RegenerateCardRequestSchema>;

export const CardRevisionSummarySchema = z.object({
  id: z.string(),
  cardId: z.string(),
  action: z.string(),
  summary: z.string(),
  tokenCount: z.number().int().min(0),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type CardRevisionSummary = z.infer<typeof CardRevisionSummarySchema>;

export const RollbackCardRequestSchema = z.object({
  revisionId: z.string().trim().min(1).optional(),
});
export type RollbackCardRequest = z.infer<typeof RollbackCardRequestSchema>;

export const CardTextSourceInputSchema = z.object({
  title: z.string().trim().max(120).optional().default(''),
  content: z.string().trim().min(1, '引用文本不能为空').max(50_000),
});
export type CardTextSourceInput = z.infer<typeof CardTextSourceInputSchema>;

export const AddCardSourcesRequestSchema = z
  .object({
    textSources: z.array(CardTextSourceInputSchema).max(5).optional().default([]),
    urls: z.array(z.string().trim().url('参考链接格式无效').max(2048)).max(5).optional().default([]),
    entries: z.array(SourceEntrySchema).max(20).optional().default([]),
  })
  .refine(
    (data) => data.textSources.length > 0 || data.urls.length > 0 || data.entries.length > 0,
    { message: '请至少提供文本引用、参考链接或检索条目之一' },
  );
export type AddCardSourcesRequest = z.infer<typeof AddCardSourcesRequestSchema>;

export const SearchCardSourcesRequestSchema = z.object({
  query: z.string().trim().min(1, '搜索关键词不能为空').max(200),
  enableLayer1Wiki: z.boolean().optional(),
  deepSearch: z.boolean().optional().default(true),
  appendToCard: z.boolean().optional().default(false),
});
export type SearchCardSourcesRequest = z.infer<typeof SearchCardSourcesRequestSchema>;

export interface SearchCardSourcesResponse {
  query: string;
  sources: SourceEntry[];
  layer1Hits: number;
  layer2Hits: number;
  addedCount: number;
}
