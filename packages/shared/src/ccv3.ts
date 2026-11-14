import { z } from 'zod';

export const LorebookEntrySchema = z.object({
  uid: z.string().min(1),
  keys: z.array(z.string()).default([]),
  secondary_keys: z.array(z.string()).default([]),
  comment: z.string().default(''),
  content: z.string().default(''),
  constant: z.boolean().default(false),
  selective: z.boolean().default(true),
  insertion_order: z.number().int().default(100),
  enabled: z.boolean().default(true),
  position: z.enum(['before_char', 'after_char']).default('before_char'),
  extensions: z.record(z.unknown()).default({}),
});
export type LorebookEntry = z.infer<typeof LorebookEntrySchema>;

export const CharacterBookSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  scan_depth: z.number().int().min(0).default(4),
  token_budget: z.number().int().min(0).default(1500),
  recursive_scanning: z.boolean().default(false),
  extensions: z.record(z.unknown()).default({}),
  entries: z.array(LorebookEntrySchema).default([]),
});
export type CharacterBook = z.infer<typeof CharacterBookSchema>;

export const CharaCardV3DataSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  personality: z.string().default(''),
  scenario: z.string().default(''),
  first_mes: z.string().default(''),
  mes_example: z.string().default(''),
  creator_notes: z.string().default(''),
  system_prompt: z.string().default(''),
  post_history_instructions: z.string().default(''),
  alternate_greetings: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  creator: z.string().default('RoleCard Studio'),
  character_version: z.string().default('1.0.0'),
  character_book: CharacterBookSchema.optional(),
  extensions: z.record(z.unknown()).default({}),
});
export type CharaCardV3Data = z.infer<typeof CharaCardV3DataSchema>;

export const CharaCardV3Schema = z.object({
  spec: z.literal('chara_card_v3'),
  spec_version: z.literal('3.0'),
  data: CharaCardV3DataSchema,
});
export type CharaCardV3 = z.infer<typeof CharaCardV3Schema>;

export const ExportFormatSchema = z.enum([
  'tavern_png',
  'tavern_v3_json',
  'json',
  'markdown',
]);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const ThemeModeSchema = z.enum(['system', 'light', 'dark', 'ocean', 'parchment']);
export type ThemeMode = z.infer<typeof ThemeModeSchema>;
