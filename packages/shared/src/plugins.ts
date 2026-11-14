import { z } from 'zod';

export const DeclarativePluginTypeSchema = z.enum([
  'template',
  'export_formatter',
  'search_source',
]);
export type DeclarativePluginType = z.infer<typeof DeclarativePluginTypeSchema>;

export const DeclarativePluginManifestSchema = z.object({
  id: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, '插件 ID 仅支持小写字母、数字和连字符'),
  name: z.string().trim().min(1).max(80),
  version: z.string().trim().min(1).max(32),
  author: z.string().trim().max(64).optional().default('RoleCard Studio'),
  description: z.string().trim().max(400).optional().default(''),
  type: DeclarativePluginTypeSchema,
  templateSpec: z
    .object({
      cardTypeLabel: z.string().trim().min(1).max(64),
      systemPromptAppend: z.string().trim().max(2000),
      defaultTags: z.array(z.string().trim().min(1).max(32)).max(10).default([]),
    })
    .optional(),
  exportSpec: z
    .object({
      fileExtension: z.string().trim().min(1).max(16).regex(/^[a-z0-9]+$/),
      mimeType: z.string().trim().min(1).max(80),
      template: z.string().min(1).max(16_000),
    })
    .optional(),
  searchSpec: z
    .object({
      displayName: z.string().trim().min(1).max(64),
      urlTemplate: z.string().url().max(512),
    })
    .optional(),
});
export type DeclarativePluginManifest = z.infer<typeof DeclarativePluginManifestSchema>;
