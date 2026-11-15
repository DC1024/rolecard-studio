import { randomUUID } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import {
  analyzePortraitWithVision,
  createOpenAiCompatibleLlmPort,
  fetchRemoteImageBuffer,
  generateOrOptimizePortraitPrompt,
  generatePortraitImage,
  resolveProviderBaseUrl,
  searchWikimediaCommonsImages,
} from '@rolecard/core';
import {
  BUILTIN_PORTRAIT_STYLE_PRESETS,
  CreatePortraitStylePresetSchema,
  ImageGenerateRequestSchema,
  ImageSearchRequestSchema,
  PortraitPromptRequestSchema,
  UpdatePortraitStylePresetSchema,
  VisionAnalyzeRequestSchema,
  type PortraitStylePresetDto,
  type RoleCardContent,
} from '@rolecard/shared';
import { asc, desc, eq, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { getNow, type ServerContext } from '../context.js';
import { portraitStylePresets, roleCards } from '../db/schema.js';
import { guardPermission, sendCoreError, type AppEnv } from '../middleware/auth.js';
import { loadRuntimeServiceConfig, loadScopedFetch, resolveScopedFetch } from './config.js';

export const visionRoutes = new Hono<AppEnv>();

const GLOBAL_STYLE_OWNER_ID = 'global';

function serializeStylePreset(
  row: typeof portraitStylePresets.$inferSelect,
): PortraitStylePresetDto {
  return {
    id: row.id,
    name: row.name,
    stylePrompt: row.stylePrompt,
    negativePromptHint: row.negativePromptHint,
    instructionHint: row.instructionHint,
    isBuiltin: row.isBuiltin,
    isCustomized: row.isCustomized,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function ensureBuiltinPortraitStylePresets(ctx: ServerContext): Promise<void> {
  const existing = await ctx.db
    .select({ id: portraitStylePresets.id })
    .from(portraitStylePresets)
    .where(eq(portraitStylePresets.ownerId, GLOBAL_STYLE_OWNER_ID));

  const existingIds = new Set(existing.map((item) => item.id));
  const missing = BUILTIN_PORTRAIT_STYLE_PRESETS.filter((def) => !existingIds.has(def.id));
  if (missing.length === 0) return;

  const nowIso = getNow(ctx).toISOString();
  for (const def of missing) {
    await ctx.db
      .insert(portraitStylePresets)
      .values({
        id: def.id,
        ownerId: GLOBAL_STYLE_OWNER_ID,
        name: def.name,
        stylePrompt: def.stylePrompt,
        negativePromptHint: def.negativePromptHint,
        instructionHint: def.instructionHint,
        isBuiltin: true,
        isCustomized: false,
        sortOrder: def.sortOrder,
        createdAt: nowIso,
        updatedAt: nowIso,
      })
      .onConflictDoNothing();
  }
}

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

visionRoutes.get('/images/proxy', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const rawUrl = c.req.query('url')?.trim() ?? '';
  if (!rawUrl || rawUrl.length > 2048 || !/^https?:\/\//i.test(rawUrl)) {
    return c.json(
      { error: { code: 'INVALID_IMAGE_URL', message: '请提供合法的 http(s) 图片 URL' } },
      400,
    );
  }

  const ctx = c.get('ctx');
  const mediaFetch = await loadScopedFetch(ctx, 'media');
  const result = await fetchRemoteImageBuffer(rawUrl, {
    fetchImpl: mediaFetch,
    dnsLookup: ctx.dnsLookup,
    maxBytes: 12 * 1024 * 1024,
  });
  if (!result.ok) {
    return sendCoreError(c, result.error);
  }

  c.header('Content-Type', result.value.contentType);
  c.header('Cache-Control', 'private, max-age=600');
  c.header('X-Content-Type-Options', 'nosniff');
  return c.body(new Uint8Array(result.value.buffer));
});

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

    if (result.value.imageUrl && !result.value.dataUrl) {
      const fetched = await fetchRemoteImageBuffer(result.value.imageUrl, {
        fetchImpl: imageFetch,
        dnsLookup: ctx.dnsLookup,
        maxBytes: 12 * 1024 * 1024,
      });
      if (fetched.ok) {
        return c.json({
          dataUrl: `data:${fetched.value.contentType};base64,${fetched.value.buffer.toString('base64')}`,
        });
      }
    }

    return c.json(result.value);
  },
);

visionRoutes.get('/images/styles', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const ctx = c.get('ctx');
  const actorUserId = c.get('actor')?.userId ?? 'guest';
  await ensureBuiltinPortraitStylePresets(ctx);

  const rows = await ctx.db
    .select()
    .from(portraitStylePresets)
    .where(
      or(
        eq(portraitStylePresets.ownerId, GLOBAL_STYLE_OWNER_ID),
        eq(portraitStylePresets.ownerId, actorUserId),
      ),
    )
    .orderBy(asc(portraitStylePresets.sortOrder), desc(portraitStylePresets.updatedAt));

  return c.json({ styles: rows.map(serializeStylePreset) });
});

visionRoutes.post(
  '/images/styles',
  zValidator('json', CreatePortraitStylePresetSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const input = c.req.valid('json');
    const ctx = c.get('ctx');
    const actorUserId = c.get('actor')?.userId ?? 'guest';
    await ensureBuiltinPortraitStylePresets(ctx);

    const nowIso = getNow(ctx).toISOString();
    const id = randomUUID();
    const record: typeof portraitStylePresets.$inferInsert = {
      id,
      ownerId: actorUserId,
      name: input.name.trim(),
      stylePrompt: input.stylePrompt.trim(),
      negativePromptHint: input.negativePromptHint.trim(),
      instructionHint: input.instructionHint.trim(),
      isBuiltin: false,
      isCustomized: false,
      sortOrder: 100,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await ctx.db.insert(portraitStylePresets).values(record);
    const createdRows = await ctx.db
      .select()
      .from(portraitStylePresets)
      .where(eq(portraitStylePresets.id, id))
      .limit(1);

    return c.json({ style: serializeStylePreset(createdRows[0]!) }, 201);
  },
);

visionRoutes.put(
  '/images/styles/:id',
  zValidator('json', UpdatePortraitStylePresetSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const id = c.req.param('id');
    const input = c.req.valid('json');
    const ctx = c.get('ctx');
    const actorUserId = c.get('actor')?.userId ?? 'guest';
    await ensureBuiltinPortraitStylePresets(ctx);

    const rows = await ctx.db
      .select()
      .from(portraitStylePresets)
      .where(eq(portraitStylePresets.id, id))
      .limit(1);
    const existing = rows[0];
    if (!existing) {
      return c.json(
        { error: { code: 'STYLE_NOT_FOUND', message: '未找到对应的画风预设' } },
        404,
      );
    }

    if (!existing.isBuiltin && existing.ownerId !== actorUserId) {
      return c.json(
        { error: { code: 'FORBIDDEN', message: '无权修改其他用户的自定义风格预设' } },
        403,
      );
    }

    const nextName = input.name !== undefined ? input.name.trim() : existing.name;
    const nextStylePrompt =
      input.stylePrompt !== undefined ? input.stylePrompt.trim() : existing.stylePrompt;
    const nextNegativeHint =
      input.negativePromptHint !== undefined
        ? input.negativePromptHint.trim()
        : existing.negativePromptHint;
    const nextInstructionHint =
      input.instructionHint !== undefined
        ? input.instructionHint.trim()
        : existing.instructionHint;

    let isCustomized = existing.isCustomized;
    if (existing.isBuiltin) {
      const def = BUILTIN_PORTRAIT_STYLE_PRESETS.find((item) => item.id === existing.id);
      if (def) {
        isCustomized =
          nextName !== def.name ||
          nextStylePrompt !== def.stylePrompt ||
          nextNegativeHint !== def.negativePromptHint ||
          nextInstructionHint !== def.instructionHint;
      }
    }

    const nowIso = getNow(ctx).toISOString();
    await ctx.db
      .update(portraitStylePresets)
      .set({
        name: nextName,
        stylePrompt: nextStylePrompt,
        negativePromptHint: nextNegativeHint,
        instructionHint: nextInstructionHint,
        isCustomized,
        updatedAt: nowIso,
      })
      .where(eq(portraitStylePresets.id, id));

    const updatedRows = await ctx.db
      .select()
      .from(portraitStylePresets)
      .where(eq(portraitStylePresets.id, id))
      .limit(1);

    return c.json({ style: serializeStylePreset(updatedRows[0]!) });
  },
);

visionRoutes.post('/images/styles/:id/reset', async (c) => {
  const denied = guardPermission(c, 'card:update');
  if (denied) return denied;

  const id = c.req.param('id');
  const ctx = c.get('ctx');
  await ensureBuiltinPortraitStylePresets(ctx);

  const def = BUILTIN_PORTRAIT_STYLE_PRESETS.find((item) => item.id === id);
  if (!def) {
    return c.json(
      { error: { code: 'NOT_BUILTIN_STYLE', message: '仅系统内置风格预设支持恢复默认' } },
      400,
    );
  }

  const nowIso = getNow(ctx).toISOString();
  await ctx.db
    .update(portraitStylePresets)
    .set({
      name: def.name,
      stylePrompt: def.stylePrompt,
      negativePromptHint: def.negativePromptHint,
      instructionHint: def.instructionHint,
      isCustomized: false,
      updatedAt: nowIso,
    })
    .where(eq(portraitStylePresets.id, id));

  const updatedRows = await ctx.db
    .select()
    .from(portraitStylePresets)
    .where(eq(portraitStylePresets.id, id))
    .limit(1);

  return c.json({ style: serializeStylePreset(updatedRows[0]!) });
});

visionRoutes.delete('/images/styles/:id', async (c) => {
  const denied = guardPermission(c, 'card:update');
  if (denied) return denied;

  const id = c.req.param('id');
  const ctx = c.get('ctx');
  const actorUserId = c.get('actor')?.userId ?? 'guest';
  await ensureBuiltinPortraitStylePresets(ctx);

  const rows = await ctx.db
    .select()
    .from(portraitStylePresets)
    .where(eq(portraitStylePresets.id, id))
    .limit(1);
  const existing = rows[0];
  if (!existing) {
    return c.json(
      { error: { code: 'STYLE_NOT_FOUND', message: '未找到对应的画风预设' } },
      404,
    );
  }

  if (existing.isBuiltin) {
    return c.json(
      {
        error: {
          code: 'BUILTIN_STYLE_PROTECTED',
          message: '系统内置风格预设不可删除，可直接修改或点击恢复默认',
        },
      },
      400,
    );
  }

  if (existing.ownerId !== actorUserId) {
    return c.json(
      { error: { code: 'FORBIDDEN', message: '无权删除其他用户的自定义风格预设' } },
      403,
    );
  }

  await ctx.db.delete(portraitStylePresets).where(eq(portraitStylePresets.id, id));
  return c.json({ ok: true, id });
});

visionRoutes.post(
  '/images/prompt',
  zValidator('json', PortraitPromptRequestSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const input = c.req.valid('json');
    const ctx = c.get('ctx');
    const actorUserId = c.get('actor')?.userId ?? 'guest';
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

    await ensureBuiltinPortraitStylePresets(ctx);
    const targetPresetId = input.stylePresetId ?? input.style ?? 'anime';
    const presetRows = await ctx.db
      .select()
      .from(portraitStylePresets)
      .where(eq(portraitStylePresets.id, targetPresetId))
      .limit(1);
    const matchedPreset = presetRows[0];
    const accessiblePreset =
      matchedPreset && (matchedPreset.isBuiltin || matchedPreset.ownerId === actorUserId)
        ? matchedPreset
        : undefined;

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
    const resolvedStylePrompt =
      input.customStylePrompt !== undefined
        ? input.customStylePrompt
        : accessiblePreset?.stylePrompt;
    const resolvedNegativeHint =
      input.customNegativeHint !== undefined
        ? input.customNegativeHint
        : accessiblePreset?.negativePromptHint;

    const result = await generateOrOptimizePortraitPrompt(
      {
        card: cardCtx,
        mode: input.mode,
        style: targetPresetId,
        customStylePrompt: resolvedStylePrompt,
        customNegativeHint: resolvedNegativeHint,
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
