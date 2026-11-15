import { z } from 'zod';

export const VisionAnalyzeRequestSchema = z.object({
  imageDataUrl: z.string().max(4_000_000).optional(),
  imageUrl: z.string().url().max(2048).optional(),
  hint: z.string().max(400).optional().default(''),
});
export type VisionAnalyzeRequest = z.infer<typeof VisionAnalyzeRequestSchema>;

export interface VisionAnalyzeResponse {
  appearanceDescription: string;
  suggestedTags: string[];
  imagePrompt: string;
}

export const ImageSearchRequestSchema = z.object({
  query: z.string().trim().min(1, '搜图关键词不能为空').max(120),
  limit: z.number().int().min(1).max(12).optional().default(6),
});
export type ImageSearchRequest = z.infer<typeof ImageSearchRequestSchema>;

export interface ImageSearchItem {
  title: string;
  imageUrl: string;
  thumbUrl: string;
  sourcePage: string;
}

export const ImageGenerateRequestSchema = z.object({
  prompt: z.string().trim().min(3).max(2000),
  size: z.enum(['1024x1024', '1024x1536', '1536x1024']).optional().default('1024x1536'),
});
export type ImageGenerateRequest = z.infer<typeof ImageGenerateRequestSchema>;

export const PortraitPromptModeSchema = z.enum(['generate', 'optimize']);
export type PortraitPromptMode = z.infer<typeof PortraitPromptModeSchema>;

export const PortraitPromptStyleSchema = z.enum([
  'blank',
  'anime',
  'realistic',
  'semi_realistic',
  'oil_painting',
  'watercolor',
  'pixel_retro',
  'dark_gothic',
]);
export type PortraitPromptStyle = z.infer<typeof PortraitPromptStyleSchema>;

export const PORTRAIT_STYLE_LABELS: Record<PortraitPromptStyle, string> = {
  blank: '空白预设（自由发挥）',
  anime: '日系二次元立绘',
  realistic: '写实摄影人像',
  semi_realistic: '半厚涂概念原画',
  oil_painting: '古典油画肖像',
  watercolor: '清透水彩插画',
  pixel_retro: '复古赛璐璐',
  dark_gothic: '暗黑哥特幻想',
};

export interface BuiltinPortraitStylePresetDef {
  id: PortraitPromptStyle;
  name: string;
  stylePrompt: string;
  negativePromptHint: string;
  instructionHint: string;
  sortOrder: number;
}

export const BUILTIN_PORTRAIT_STYLE_PRESETS: readonly BuiltinPortraitStylePresetDef[] = [
  {
    id: 'blank',
    name: '空白预设（自由发挥）',
    stylePrompt: '',
    negativePromptHint: '',
    instructionHint: '',
    sortOrder: 0,
  },
  {
    id: 'anime',
    name: '日系二次元立绘',
    stylePrompt:
      'clean anime character portrait illustration, crisp lineart, cel-shaded with soft ambient lighting',
    negativePromptHint: 'photorealistic, 3d render, real life photo',
    instructionHint: '',
    sortOrder: 1,
  },
  {
    id: 'realistic',
    name: '写实摄影人像',
    stylePrompt:
      'photorealistic character portrait, natural skin texture, authentic fabric details, 85mm prime lens photography, shallow depth of field, cinematic natural light',
    negativePromptHint: 'anime, cartoon, illustration, 3d render, cel-shaded',
    instructionHint: '',
    sortOrder: 2,
  },
  {
    id: 'semi_realistic',
    name: '半厚涂概念原画',
    stylePrompt:
      'semi-realistic digital character concept art, painterly brushwork, refined facial lighting',
    negativePromptHint: '',
    instructionHint: '',
    sortOrder: 3,
  },
  {
    id: 'oil_painting',
    name: '古典油画肖像',
    stylePrompt:
      'classical oil painting portrait, rich impasto texture, dramatic studio chiaroscuro lighting',
    negativePromptHint: '',
    instructionHint: '',
    sortOrder: 4,
  },
  {
    id: 'watercolor',
    name: '清透水彩插画',
    stylePrompt:
      'delicate watercolor character illustration, soft pigment washes, luminous paper texture',
    negativePromptHint: '',
    instructionHint: '',
    sortOrder: 5,
  },
  {
    id: 'pixel_retro',
    name: '复古赛璐璐',
    stylePrompt: 'retro 90s anime cel illustration, nostalgic film grain, expressive silhouette',
    negativePromptHint: '',
    instructionHint: '',
    sortOrder: 6,
  },
  {
    id: 'dark_gothic',
    name: '暗黑哥特幻想',
    stylePrompt:
      'dark gothic fantasy character portrait, moody atmospheric shadows, high-contrast rim lighting',
    negativePromptHint: '',
    instructionHint: '',
    sortOrder: 7,
  },
];

export interface PortraitStylePresetDto {
  id: string;
  name: string;
  stylePrompt: string;
  negativePromptHint: string;
  instructionHint: string;
  isBuiltin: boolean;
  isCustomized: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export const CreatePortraitStylePresetSchema = z.object({
  name: z.string().trim().min(1, '风格名称不能为空').max(60, '风格名称不能超过 60 字'),
  stylePrompt: z.string().max(1000).optional().default(''),
  negativePromptHint: z.string().max(500).optional().default(''),
  instructionHint: z.string().max(400).optional().default(''),
});
export type CreatePortraitStylePresetInput = z.input<typeof CreatePortraitStylePresetSchema>;

export const UpdatePortraitStylePresetSchema = z.object({
  name: z.string().trim().min(1, '风格名称不能为空').max(60, '风格名称不能超过 60 字').optional(),
  stylePrompt: z.string().max(1000).optional(),
  negativePromptHint: z.string().max(500).optional(),
  instructionHint: z.string().max(400).optional(),
});
export type UpdatePortraitStylePresetInput = z.input<typeof UpdatePortraitStylePresetSchema>;

export const PortraitPromptRequestSchema = z.object({
  cardId: z.string().min(1).max(128).optional(),
  mode: PortraitPromptModeSchema.default('generate'),
  style: z.string().trim().max(128).optional().default('anime'),
  stylePresetId: z.string().trim().min(1).max(128).optional(),
  customStylePrompt: z.string().max(1000).optional(),
  customNegativeHint: z.string().max(500).optional(),
  draftPrompt: z.string().max(2000).optional().default(''),
  instruction: z.string().max(500).optional().default(''),
  characterName: z.string().max(120).optional(),
  workName: z.string().max(120).optional(),
  appearance: z.string().max(2000).optional(),
  personality: z.string().max(1500).optional(),
  background: z.string().max(1500).optional(),
  scenario: z.string().max(1000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});
export type PortraitPromptRequest = z.input<typeof PortraitPromptRequestSchema>;

export interface PortraitPromptResponse {
  prompt: string;
  negativePrompt: string;
  notes: string;
}
