import { zValidator } from '@hono/zod-validator';
import {
  analyzePortraitWithVision,
  createOpenAiCompatibleLlmPort,
  generateOrOptimizePortraitPrompt,
  generatePortraitImage,
  resolveProviderBaseUrl,
  searchWikimediaCommonsImages,
} from '@rolecard/core';
import {
  ImageGenerateRequestSchema,
  ImageSearchRequestSchema,
  PortraitPromptRequestSchema,
  VisionAnalyzeRequestSchema,
  type RoleCardContent,
} from '@rolecard/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { roleCards } from '../db/schema.js';
import { guardPermission, sendCoreError, type AppEnv } from '../middleware/auth.js';
import { loadRuntimeServiceConfig, loadScopedFetch, resolveScopedFetch } from './config.js';

export const visionRoutes = new Hono<AppEnv>();

visionRoutes.post(
  '/vision/analyze',
  zValidator('json', VisionAnalyzeRequestSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:create');
    if (denied) return denied;

    const input = c.req.valid('json');
    const ctx = c.get('ctx');
    const runtimeCfg = await loadRuntimeServiceConfig(ctx);
    if (!runtimeCfg) {
      return c.json(
        { error: { code: 'CONFIG_MISSING', message: '请先在设置中心配置 Vision 或主模型' } },
        400,
      );
    }

    const chosenSlot = runtimeCfg.visionLlm ?? runtimeCfg.primaryLlm;
    const baseUrl = resolveProviderBaseUrl(chosenSlot.provider, chosenSlot.baseUrl);
    const visionFetch = resolveScopedFetch(ctx, runtimeCfg.proxyConfig, 'llm_vision');
    const result = await analyzePortraitWithVision(
      input,
      { ...chosenSlot, baseUrl },
      { fetchImpl: visionFetch, dnsLookup: ctx.dnsLookup },
    );
    if (!result.ok) {
      return sendCoreError(c, result.error);
    }
    return c.json(result.value);
  },
);

visionRoutes.post(
  '/images/search',
  zValidator('json', ImageSearchRequestSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:read');
    if (denied) return denied;

    const input = c.req.valid('json');
    const ctx = c.get('ctx');
    const mediaFetch = await loadScopedFetch(ctx, 'media');
    const result = await searchWikimediaCommonsImages(input.query, input.limit, {
      fetchImpl: mediaFetch,
      dnsLookup: ctx.dnsLookup,
    });
    if (!result.ok) {
      return sendCoreError(c, result.error);
    }
    return c.json({ items: result.value });
  },
);

visionRoutes.post(
  '/images/generate',
  zValidator('json', ImageGenerateRequestSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const input = c.req.valid('json');
    const ctx = c.get('ctx');
    const runtimeCfg = await loadRuntimeServiceConfig(ctx);
    if (!runtimeCfg || !runtimeCfg.imageLlm) {
      return c.json(
        {
          error: {
            code: 'IMAGE_MODEL_NOT_CONFIGURED',
            message: '请先在「模型与系统设置」中配置独立的生图模型 (Image Model) 后再使用 AI 生图',
          },
        },
        400,
      );
    }

    const chosenSlot = runtimeCfg.imageLlm;
    const baseUrl = resolveProviderBaseUrl(chosenSlot.provider, chosenSlot.baseUrl);
    const imageFetch = resolveScopedFetch(ctx, runtimeCfg.proxyConfig, 'llm_image');
    const result = await generatePortraitImage(
      input,
      { ...chosenSlot, baseUrl },
      chosenSlot.model,
      { fetchImpl: imageFetch, dnsLookup: ctx.dnsLookup },
    );
    if (!result.ok) {
      return sendCoreError(c, result.error);
    }
    return c.json(result.value);
  },
);

visionRoutes.post(
  '/images/prompt',
  zValidator('json', PortraitPromptRequestSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const input = c.req.valid('json');
    const ctx = c.get('ctx');
    const runtimeCfg = await loadRuntimeServiceConfig(ctx);
    if (!runtimeCfg) {
      return c.json(
        {
          error: {
            code: 'LLM_NOT_CONFIGURED',
            message: '请先在「模型与系统设置」中配置主生成模型 (Primary LLM)',
          },
        },
        400,
      );
    }

    let cardCtx = {
      characterName: input.characterName?.trim() || '未命名角色',
      workName: input.workName?.trim() || '',
      appearance: input.appearance?.trim() || '',
      personality: input.personality?.trim() || '',
      background: input.background?.trim() || '',
      scenario: input.scenario?.trim() || '',
      tags: input.tags ?? [],
    };

    if (input.cardId) {
      const rows = await ctx.db
        .select()
        .from(roleCards)
        .where(eq(roleCards.id, input.cardId))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return c.json(
          { error: { code: 'CARD_NOT_FOUND', message: '目标角色卡不存在' } },
          404,
        );
      }
      const content = JSON.parse(row.contentJson) as RoleCardContent;
      cardCtx = {
        characterName: input.characterName?.trim() || content.name || row.characterName,
        workName: input.workName?.trim() || row.workName,
        appearance: input.appearance?.trim() || content.appearance || '',
        personality: input.personality?.trim() || content.personality || '',
        background: input.background?.trim() || content.background || '',
        scenario: input.scenario?.trim() || content.scenario || '',
        tags: input.tags && input.tags.length > 0 ? input.tags : content.tags,
      };
    }

    const primaryFetch = resolveScopedFetch(ctx, runtimeCfg.proxyConfig, 'llm_primary');
    const llmPort = ctx.llmPort ?? createOpenAiCompatibleLlmPort(primaryFetch);
    const result = await generateOrOptimizePortraitPrompt(
      {
        card: cardCtx,
        mode: input.mode,
        style: input.style,
        draftPrompt: input.draftPrompt,
        instruction: input.instruction,
      },
      {
        llmPort,
        llmSlot: runtimeCfg.primaryLlm,
      },
    );
    if (!result.ok) {
      return sendCoreError(c, result.error);
    }
    return c.json(result.value);
  },
);
