import { zValidator } from '@hono/zod-validator';
import {
  analyzePortraitWithVision,
  generatePortraitImage,
  resolveProviderBaseUrl,
  searchWikimediaCommonsImages,
} from '@rolecard/core';
import {
  ImageGenerateRequestSchema,
  ImageSearchRequestSchema,
  VisionAnalyzeRequestSchema,
} from '@rolecard/shared';
import { Hono } from 'hono';
import { guardPermission, sendCoreError, type AppEnv } from '../middleware/auth.js';
import { loadRuntimeServiceConfig } from './config.js';

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
    const result = await analyzePortraitWithVision(
      input,
      { ...chosenSlot, baseUrl },
      { fetchImpl: ctx.fetchImpl, dnsLookup: ctx.dnsLookup },
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
    const result = await searchWikimediaCommonsImages(input.query, input.limit, {
      fetchImpl: ctx.fetchImpl,
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
    const result = await generatePortraitImage(
      input,
      { ...chosenSlot, baseUrl },
      chosenSlot.model,
      { fetchImpl: ctx.fetchImpl, dnsLookup: ctx.dnsLookup },
    );
    if (!result.ok) {
      return sendCoreError(c, result.error);
    }
    return c.json(result.value);
  },
);
