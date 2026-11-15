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

export const GenerateTrpgStatsSchema = z.object({
  system: z.enum(['coc7e', 'dnd5e']),
});
export type GenerateTrpgStatsRequest = z.infer<typeof GenerateTrpgStatsSchema>;

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
]);
export type CardGeneratableField = z.infer<typeof CardGeneratableFieldSchema>;

export const GenerateCardFieldRequestSchema = z.object({
  field: CardGeneratableFieldSchema,
  instruction: z.string().trim().max(500).optional().default(''),
});
export type GenerateCardFieldRequest = z.infer<typeof GenerateCardFieldRequestSchema>;
