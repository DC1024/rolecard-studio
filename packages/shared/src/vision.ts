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
  'anime',
  'semi_realistic',
  'oil_painting',
  'watercolor',
  'pixel_retro',
  'dark_gothic',
]);
export type PortraitPromptStyle = z.infer<typeof PortraitPromptStyleSchema>;

export const PORTRAIT_STYLE_LABELS: Record<PortraitPromptStyle, string> = {
  anime: '日系二次元立绘',
  semi_realistic: '半厚涂概念原画',
  oil_painting: '古典油画肖像',
  watercolor: '清透水彩插画',
  pixel_retro: '复古赛璐璐',
  dark_gothic: '暗黑哥特幻想',
};

export const PortraitPromptRequestSchema = z.object({
  cardId: z.string().min(1).max(128).optional(),
  mode: PortraitPromptModeSchema.default('generate'),
  style: PortraitPromptStyleSchema.default('anime'),
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
