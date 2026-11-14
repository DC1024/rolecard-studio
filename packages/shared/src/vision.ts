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
