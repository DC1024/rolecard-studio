import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { zValidator } from '@hono/zod-validator';
import {
  appendTurnToMesExample,
  compressRoleCard,
  computeCardDiffSummary,
  createDefaultPortraitPng,
  createOpenAiCompatibleLlmPort,
  detectImageMagicBytes,
  embedCardIntoPng,
  exportCardToFoundryDnd5eActor,
  exportCardToMarkdown,
  exportCardToTrpgSheetHtml,
  exportCardToTrpgSheetMarkdown,
  generateCardField,
  generateTrpgAttributesForCard,
  isSafeImageUrl,
  isUrlProxiedByFetch,
  mergeLorebooksToCharacterBook,
  preserveLockedFields,
  refineRoleCard,
  resolveProviderBaseUrl,
  runPlaytestTurn,
  toCharaCardV3,
  validatePublicUrl,
} from '@rolecard/core';
import {
  AdoptMesExampleSchema,
  CardImageUploadSchema,
  estimateCardTokens,
  ExportFormatSchema,
  GenerateCardFieldRequestSchema,
  GenerateTrpgStatsSchema,
  type LorebookEntry,
  PlaytestRequestSchema,
  RefineCardRequestSchema,
  UpdateCardContentSchema,
  type RoleCardContent,
  type SourceEntry,
} from '@rolecard/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getNow, type ServerContext } from '../context.js';
import { generationLogs, roleCards, userServiceConfigs } from '../db/schema.js';
import { guardPermission, sendCoreError, type AppEnv } from '../middleware/auth.js';
import { serializeCardRow } from './cards.js';
import { loadRuntimeServiceConfig, loadScopedFetch, resolveScopedFetch } from './config.js';
import { loadLinkedLorebooksForCard } from './lorebooks.js';
import { publishSyncEvent } from './sync.js';

export const cardM1Routes = new Hono<AppEnv>();

const CompressRequestSchema = z.object({
  targetMaxTokens: z.number().int().min(150).max(8000).default(1200),
});

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function safeDownloadFilename(name: string, ext: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim() || 'rolecard';
  return `${cleaned}.${ext}`;
}

async function resolveUploadBuffer(
  ctx: ServerContext,
  imageUrl: string | null,
): Promise<Buffer | null> {
  if (!imageUrl || !imageUrl.startsWith('/uploads/')) {
    return null;
  }
  const fileName = basename(imageUrl);
  if (!fileName || fileName === '.' || fileName === '..') {
    return null;
  }
  if (ctx.memoryUploads?.has(fileName)) {
    return ctx.memoryUploads.get(fileName)?.data ?? null;
  }
  if (ctx.dataDir === ':memory:') {
    return null;
  }
  try {
    const filePath = resolve(ctx.dataDir, 'uploads', fileName);
    return await readFile(filePath);
  } catch {
    return null;
  }
}

cardM1Routes.put('/cards/:id', zValidator('json', UpdateCardContentSchema), async (c) => {
  const denied = guardPermission(c, 'card:update');
  if (denied) return denied;

  const id = c.req.param('id');
  const input = c.req.valid('json');
  const ctx = c.get('ctx');

  const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const currentContent = JSON.parse(row.contentJson) as RoleCardContent;
  const lockedFields = input.lockedFields ?? parseJsonArray<string>(row.lockedFieldsJson);
  const nextContent = preserveLockedFields(currentContent, input.content, lockedFields);
  const nextTags = [
    ...new Set((input.tags ?? nextContent.tags).map((t) => t.trim()).filter(Boolean)),
  ];
  nextContent.tags = nextTags;

  const nowIso = getNow(ctx).toISOString();
  const diffSummary = computeCardDiffSummary(currentContent, nextContent);
  const tokenCount = estimateCardTokens(nextContent);

  await ctx.db
    .update(roleCards)
    .set({
      characterName: nextContent.name,
      tagsJson: JSON.stringify(nextTags),
      contentJson: JSON.stringify(nextContent),
      lockedFieldsJson: JSON.stringify(lockedFields),
      diffSummary,
      tokenCount,
      version: row.version + 1,
      updatedAt: nowIso,
    })
    .where(eq(roleCards.id, id));

  const updatedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const updated = updatedRows[0];
  if (!updated) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  await publishSyncEvent(ctx, {
    eventType: 'card.updated',
    targetType: 'card',
    targetId: updated.id,
    version: updated.version,
    payload: { characterName: updated.characterName, diffSummary },
  });

  return c.json({ card: serializeCardRow(updated) });
});

cardM1Routes.post('/cards/:id/refine', zValidator('json', RefineCardRequestSchema), async (c) => {
  const denied = guardPermission(c, 'card:update');
  if (denied) return denied;

  const id = c.req.param('id');
  const { instruction } = c.req.valid('json');
  const ctx = c.get('ctx');
  const actorUserId = c.get('actor')?.userId ?? 'guest';

  const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const runtime = await loadRuntimeServiceConfig(ctx);
  if (!runtime) {
    return c.json(
      { error: { code: 'LLM_NOT_CONFIGURED', message: '尚未配置主大模型' } },
      400,
    );
  }

  const startedAt = Date.now();
  const currentContent = JSON.parse(row.contentJson) as RoleCardContent;
  const lockedFields = parseJsonArray<string>(row.lockedFieldsJson);
  const primaryFetch = resolveScopedFetch(ctx, runtime.proxyConfig, 'llm_primary');
  const llmPort = ctx.llmPort ?? createOpenAiCompatibleLlmPort(primaryFetch);

  const result = await refineRoleCard(currentContent, instruction, {
    llmPort,
    llmSlot: runtime.primaryLlm,
    lockedFields,
    onStrategyDowngraded: async () => {
      await ctx.db
        .update(userServiceConfigs)
        .set({ jsonModeStrategy: 'prompt', updatedAt: getNow(ctx).toISOString() })
        .where(eq(userServiceConfigs.userId, 'global'));
    },
  });

  const nowIso = getNow(ctx).toISOString();
  const latencyMs = Date.now() - startedAt;

  if (!result.ok) {
    await ctx.db.insert(generationLogs).values({
      id: randomUUID(),
      userId: actorUserId,
      action: 'refine',
      targetId: id,
      provider: runtime.primaryLlm.provider,
      status: 'error',
      latencyMs,
      errorCode: result.error.code,
      errorMessage: result.error.message,
      createdAt: nowIso,
    });
    return sendCoreError(c, result.error);
  }

  await ctx.db
    .update(roleCards)
    .set({
      characterName: result.value.content.name,
      tagsJson: JSON.stringify(result.value.content.tags),
      contentJson: JSON.stringify(result.value.content),
      diffSummary: result.value.diffSummary,
      tokenCount: result.value.tokenCount,
      version: row.version + 1,
      updatedAt: nowIso,
    })
    .where(eq(roleCards.id, id));

  await ctx.db.insert(generationLogs).values({
    id: randomUUID(),
    userId: actorUserId,
    action: 'refine',
    targetId: id,
    provider: runtime.primaryLlm.provider,
    status: 'success',
    latencyMs,
    errorCode: null,
    errorMessage: null,
    createdAt: nowIso,
  });

  const updatedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  return c.json({
    card: serializeCardRow(updatedRows[0]!),
    diffSummary: result.value.diffSummary,
  });
});

cardM1Routes.post(
  '/cards/:id/generate-field',
  zValidator('json', GenerateCardFieldRequestSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const id = c.req.param('id');
    const { field, instruction } = c.req.valid('json');
    const ctx = c.get('ctx');
    const actorUserId = c.get('actor')?.userId ?? 'guest';

    const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
    const row = rows[0];
    if (!row) {
      return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
    }

    const lockedFields = parseJsonArray<string>(row.lockedFieldsJson);
    if (lockedFields.includes(field)) {
      return c.json(
        {
          error: {
            code: 'FIELD_LOCKED',
            message: '该区块已锁定，请先解锁后再使用 AI 生成',
          },
        },
        400,
      );
    }

    const runtime = await loadRuntimeServiceConfig(ctx);
    if (!runtime) {
      return c.json(
        { error: { code: 'LLM_NOT_CONFIGURED', message: '尚未配置主大模型' } },
        400,
      );
    }

    const startedAt = Date.now();
    const currentContent = JSON.parse(row.contentJson) as RoleCardContent;
    const sources = parseJsonArray<SourceEntry>(row.sourcesJson);
    const primaryFetch = resolveScopedFetch(ctx, runtime.proxyConfig, 'llm_primary');
    const llmPort = ctx.llmPort ?? createOpenAiCompatibleLlmPort(primaryFetch);

    const result = await generateCardField(currentContent, field, {
      llmPort,
      llmSlot: runtime.primaryLlm,
      workName: row.workName,
      cardType: row.cardType,
      entityType: row.entityType,
      sources,
      instruction,
      customSystemPrompt: runtime.customSystemPrompt,
      onStrategyDowngraded: async () => {
        await ctx.db
          .update(userServiceConfigs)
          .set({ jsonModeStrategy: 'prompt', updatedAt: getNow(ctx).toISOString() })
          .where(eq(userServiceConfigs.userId, 'global'));
      },
    });

    const nowIso = getNow(ctx).toISOString();
    const latencyMs = Date.now() - startedAt;

    if (!result.ok) {
      await ctx.db.insert(generationLogs).values({
        id: randomUUID(),
        userId: actorUserId,
        action: 'generate_field',
        targetId: id,
        provider: runtime.primaryLlm.provider,
        status: 'error',
        latencyMs,
        errorCode: result.error.code,
        errorMessage: result.error.message,
        createdAt: nowIso,
      });
      return sendCoreError(c, result.error);
    }

    const nextVersion = row.version + 1;
    await ctx.db
      .update(roleCards)
      .set({
        contentJson: JSON.stringify(result.value.content),
        diffSummary: result.value.diffSummary,
        tokenCount: result.value.tokenCount,
        version: nextVersion,
        updatedAt: nowIso,
      })
      .where(eq(roleCards.id, id));

    await ctx.db.insert(generationLogs).values({
      id: randomUUID(),
      userId: actorUserId,
      action: 'generate_field',
      targetId: id,
      provider: runtime.primaryLlm.provider,
      status: 'success',
      latencyMs,
      errorCode: null,
      errorMessage: null,
      createdAt: nowIso,
    });

    await publishSyncEvent(ctx, {
      eventType: 'card.updated',
      targetType: 'card',
      targetId: id,
      version: nextVersion,
      payload: {
        characterName: row.characterName,
        diffSummary: result.value.diffSummary,
      },
    });

    const updatedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
    return c.json({
      card: serializeCardRow(updatedRows[0]!),
      field: result.value.field,
      fieldLabel: result.value.fieldLabel,
      diffSummary: result.value.diffSummary,
    });
  },
);

cardM1Routes.post('/cards/:id/compress', zValidator('json', CompressRequestSchema), async (c) => {
  const denied = guardPermission(c, 'card:update');
  if (denied) return denied;

  const id = c.req.param('id');
  const { targetMaxTokens } = c.req.valid('json');
  const ctx = c.get('ctx');
  const actorUserId = c.get('actor')?.userId ?? 'guest';

  const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const runtime = await loadRuntimeServiceConfig(ctx);
  if (!runtime) {
    return c.json(
      { error: { code: 'LLM_NOT_CONFIGURED', message: '尚未配置主大模型' } },
      400,
    );
  }

  const currentContent = JSON.parse(row.contentJson) as RoleCardContent;
  const lockedFields = parseJsonArray<string>(row.lockedFieldsJson);
  const primaryFetch = resolveScopedFetch(ctx, runtime.proxyConfig, 'llm_primary');
  const llmPort = ctx.llmPort ?? createOpenAiCompatibleLlmPort(primaryFetch);

  const startedAt = Date.now();
  const result = await compressRoleCard(currentContent, targetMaxTokens, {
    llmPort,
    llmSlot: runtime.primaryLlm,
    lockedFields,
  });

  const nowIso = getNow(ctx).toISOString();
  const latencyMs = Date.now() - startedAt;

  if (!result.ok) {
    await ctx.db.insert(generationLogs).values({
      id: randomUUID(),
      userId: actorUserId,
      action: 'compress',
      targetId: id,
      provider: runtime.primaryLlm.provider,
      status: 'error',
      latencyMs,
      errorCode: result.error.code,
      errorMessage: result.error.message,
      createdAt: nowIso,
    });
    return sendCoreError(c, result.error);
  }

  await ctx.db
    .update(roleCards)
    .set({
      contentJson: JSON.stringify(result.value.content),
      diffSummary: result.value.diffSummary,
      tokenCount: result.value.afterTokens,
      version: row.version + 1,
      updatedAt: nowIso,
    })
    .where(eq(roleCards.id, id));

  await ctx.db.insert(generationLogs).values({
    id: randomUUID(),
    userId: actorUserId,
    action: 'compress',
    targetId: id,
    provider: runtime.primaryLlm.provider,
    status: 'success',
    latencyMs,
    errorCode: null,
    errorMessage: null,
    createdAt: nowIso,
  });

  const updatedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  return c.json({
    card: serializeCardRow(updatedRows[0]!),
    beforeTokens: result.value.beforeTokens,
    afterTokens: result.value.afterTokens,
  });
});

cardM1Routes.get('/cards/:id/export', async (c) => {
  const denied = guardPermission(c, 'card:export');
  if (denied) return denied;

  const id = c.req.param('id');
  const formatParse = ExportFormatSchema.safeParse(c.req.query('format') ?? 'tavern_png');
  if (!formatParse.success) {
    return c.json(
      { error: { code: 'INVALID_EXPORT_FORMAT', message: '不支持的导出格式' } },
      400,
    );
  }
  const format = formatParse.data;
  const ctx = c.get('ctx');

  const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const content = JSON.parse(row.contentJson) as RoleCardContent;
  const sources = parseJsonArray<SourceEntry>(row.sourcesJson);

  if (format === 'json') {
    const filename = safeDownloadFilename(content.name, 'json');
    c.header('Content-Type', 'application/json; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return c.body(JSON.stringify(content, null, 2));
  }

  if (format === 'markdown') {
    const filename = safeDownloadFilename(content.name, 'md');
    const md = exportCardToMarkdown(content, {
      workName: row.workName,
      mode: row.mode,
      version: row.version,
      sources,
    });
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return c.body(md);
  }

  if (format === 'foundry_dnd5e_json') {
    const filename = safeDownloadFilename(`${content.name}.foundry-dnd5e`, 'json');
    const actor = exportCardToFoundryDnd5eActor(content, {
      cardType: row.cardType,
      workName: row.workName,
      version: row.version,
      imageUrl: row.tokenImageUrl || row.imageUrl,
    });
    c.header('Content-Type', 'application/json; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return c.body(JSON.stringify(actor, null, 2));
  }

  if (format === 'vtt_token_png') {
    const tokenBuf =
      (await resolveUploadBuffer(ctx, row.tokenImageUrl)) ??
      (await resolveUploadBuffer(ctx, row.imageUrl)) ??
      createDefaultPortraitPng();
    const detected = detectImageMagicBytes(tokenBuf);
    const ext = detected === 'jpeg' ? 'jpg' : detected === 'webp' ? 'webp' : 'png';
    const contentType =
      detected === 'jpeg' ? 'image/jpeg' : detected === 'webp' ? 'image/webp' : 'image/png';
    const filename = safeDownloadFilename(`${content.name}.vtt-token`, ext);
    c.header('Content-Type', contentType);
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return c.body(new Uint8Array(tokenBuf));
  }

  if (format === 'trpg_sheet_md') {
    const filename = safeDownloadFilename(`${content.name}.trpg-sheet`, 'md');
    const sheetMd = exportCardToTrpgSheetMarkdown(content, {
      cardType: row.cardType,
      workName: row.workName,
      version: row.version,
      sources,
    });
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return c.body(sheetMd);
  }

  if (format === 'trpg_sheet_html') {
    const filename = safeDownloadFilename(`${content.name}.trpg-sheet`, 'html');
    const sheetHtml = exportCardToTrpgSheetHtml(content, {
      cardType: row.cardType,
      workName: row.workName,
      version: row.version,
      sources,
    });
    c.header('Content-Type', 'text/html; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return c.body(sheetHtml);
  }

  const linkedBookRows = await loadLinkedLorebooksForCard(ctx, id);
  const characterBook = mergeLorebooksToCharacterBook(
    linkedBookRows.map((lb) => ({
      name: lb.name,
      description: lb.description,
      scanDepth: lb.scanDepth,
      tokenBudget: lb.tokenBudget,
      recursiveScanning: lb.recursiveScanning,
      entries: parseJsonArray<LorebookEntry>(lb.entriesJson),
    })),
  );

  const v3Card = toCharaCardV3(content, {
    version: row.version,
    characterBook,
    sources,
  });

  if (format === 'tavern_v3_json') {
    const filename = safeDownloadFilename(`${content.name}.ccv3`, 'json');
    c.header('Content-Type', 'application/json; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return c.body(JSON.stringify(v3Card, null, 2));
  }

  // tavern_png
  const uploadedBuf = await resolveUploadBuffer(ctx, row.imageUrl);
  const basePng =
    uploadedBuf && detectImageMagicBytes(uploadedBuf) === 'png'
      ? uploadedBuf
      : createDefaultPortraitPng();

  const embedded = embedCardIntoPng(basePng, v3Card);
  if (!embedded.ok) {
    return sendCoreError(c, embedded.error);
  }

  const filename = safeDownloadFilename(content.name, 'png');
  c.header('Content-Type', 'image/png');
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  return c.body(new Uint8Array(embedded.value));
});

cardM1Routes.post('/cards/:id/playtest', zValidator('json', PlaytestRequestSchema), async (c) => {
  const denied = guardPermission(c, 'playtest:use');
  if (denied) return denied;

  const id = c.req.param('id');
  const input = c.req.valid('json');
  const ctx = c.get('ctx');

  const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const runtime = await loadRuntimeServiceConfig(ctx);
  if (!runtime) {
    return c.json(
      { error: { code: 'LLM_NOT_CONFIGURED', message: '尚未配置大模型，请先在设置中心配置主模型或试聊模型' } },
      400,
    );
  }

  const baseSlot = runtime.chatLlm ?? runtime.primaryLlm;
  const effectiveSlot = input.modelOverride
    ? {
        ...baseSlot,
        provider: input.modelOverride.provider ?? baseSlot.provider,
        baseUrl: input.modelOverride.baseUrl
          ? resolveProviderBaseUrl(
              input.modelOverride.provider ?? baseSlot.provider,
              input.modelOverride.baseUrl,
            )
          : baseSlot.baseUrl,
        model: input.modelOverride.model,
        jsonModeStrategy: input.modelOverride.jsonModeStrategy ?? baseSlot.jsonModeStrategy,
      }
    : baseSlot;

  const content = JSON.parse(row.contentJson) as RoleCardContent;
  const chatFetch = resolveScopedFetch(ctx, runtime.proxyConfig, 'llm_chat');
  const llmPort = ctx.llmPort ?? createOpenAiCompatibleLlmPort(chatFetch);

  const metaSummary = parseMetaSummary(row.metaReputationJson);

  const linkedBookRows = await loadLinkedLorebooksForCard(ctx, id);
  const playtestLorebooks = linkedBookRows.map((lb) => ({
    id: lb.id,
    name: lb.name,
    entries: parseJsonArray<LorebookEntry>(lb.entriesJson),
  }));

  const turnResult = await runPlaytestTurn(content, input, {
    llmPort,
    llmSlot: effectiveSlot,
    lorebooks: playtestLorebooks,
    enableMetaInChat: row.enableMetaInChat,
    metaReputationSummary: metaSummary,
  });

  if (!turnResult.ok) {
    return sendCoreError(c, turnResult.error);
  }

  return c.json(turnResult.value);
});

function parseMetaSummary(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { summary?: string };
    return typeof parsed.summary === 'string' ? parsed.summary : null;
  } catch {
    return null;
  }
}

cardM1Routes.post('/cards/:id/mes-example', zValidator('json', AdoptMesExampleSchema), async (c) => {
  const denied = guardPermission(c, 'card:update');
  if (denied) return denied;

  const id = c.req.param('id');
  const { userMessage, assistantMessage } = c.req.valid('json');
  const ctx = c.get('ctx');

  const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const content = JSON.parse(row.contentJson) as RoleCardContent;
  content.mes_example = appendTurnToMesExample(content.mes_example, userMessage, assistantMessage);
  const tokenCount = estimateCardTokens(content);
  const nowIso = getNow(ctx).toISOString();

  await ctx.db
    .update(roleCards)
    .set({
      contentJson: JSON.stringify(content),
      tokenCount,
      diffSummary: '已采纳试聊对话片段至 mes_example',
      updatedAt: nowIso,
    })
    .where(eq(roleCards.id, id));

  const updatedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  return c.json({ card: serializeCardRow(updatedRows[0]!) });
});

async function saveUploadDataUrl(
  ctx: ServerContext,
  cardId: string,
  suffix: string,
  dataUrl: string,
): Promise<
  | { ok: true; publicUrl: string }
  | { ok: false; status: 400; code: string; message: string }
> {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(
    dataUrl.trim(),
  );
  if (!match || !match[2]) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_IMAGE_DATA_URL',
      message: '仅支持 PNG/JPEG/WEBP 格式的 DataURL',
    };
  }

  const buf = Buffer.from(match[2], 'base64');
  if (buf.length === 0 || buf.length > 3 * 1024 * 1024) {
    return {
      ok: false,
      status: 400,
      code: 'IMAGE_TOO_LARGE',
      message: '图片体积必须在 1B ~ 3MB 之间',
    };
  }

  const detected = detectImageMagicBytes(buf);
  if (!detected) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_IMAGE_MAGIC',
      message: '图片文件魔数校验失败，拒绝保存伪造图片',
    };
  }

  const ext = detected === 'jpeg' ? 'jpg' : detected;
  const contentType =
    detected === 'png' ? 'image/png' : detected === 'webp' ? 'image/webp' : 'image/jpeg';
  const fileName = `${cardId}-${suffix}-${Date.now()}.${ext}`;

  if (ctx.dataDir === ':memory:') {
    if (!ctx.memoryUploads) {
      ctx.memoryUploads = new Map();
    }
    ctx.memoryUploads.set(fileName, { data: buf, contentType });
  } else {
    const uploadsDir = resolve(ctx.dataDir, 'uploads');
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(resolve(uploadsDir, fileName), buf);
  }

  return { ok: true, publicUrl: `/uploads/${fileName}` };
}

cardM1Routes.get('/cards/:id/portrait-source', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const id = c.req.param('id');
  const ctx = c.get('ctx');
  const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row || !row.imageUrl) {
    return c.json({ error: { code: 'PORTRAIT_NOT_FOUND', message: '角色卡尚未设置立绘' } }, 404);
  }

  const localBuf = await resolveUploadBuffer(ctx, row.imageUrl);
  if (localBuf) {
    const detected = detectImageMagicBytes(localBuf);
    const contentType =
      detected === 'jpeg' ? 'image/jpeg' : detected === 'webp' ? 'image/webp' : 'image/png';
    c.header('Content-Type', contentType);
    c.header('Cache-Control', 'private, max-age=300');
    return c.body(new Uint8Array(localBuf));
  }

  if (!/^https?:\/\//i.test(row.imageUrl)) {
    return c.json({ error: { code: 'PORTRAIT_NOT_FOUND', message: '立绘文件不可用' } }, 404);
  }

  const mediaFetch = await loadScopedFetch(ctx, 'media');
  const ssrf = await validatePublicUrl(row.imageUrl, ctx.dnsLookup, {
    viaProxy: isUrlProxiedByFetch(mediaFetch, row.imageUrl),
  });
  if (!ssrf.ok) {
    return sendCoreError(c, ssrf.error);
  }

  try {
    const res = await mediaFetch(row.imageUrl, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'image/png,image/jpeg,image/webp,image/*;q=0.8' },
    });
    if (!res.ok) {
      return c.json(
        { error: { code: 'PORTRAIT_FETCH_FAILED', message: `拉取外链立绘失败 (HTTP ${res.status})` } },
        502,
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 8 * 1024 * 1024) {
      return c.json(
        { error: { code: 'IMAGE_TOO_LARGE', message: '外链立绘体积超出限制 (最大 8MB)' } },
        400,
      );
    }
    const detected = detectImageMagicBytes(buf);
    if (!detected) {
      return c.json(
        { error: { code: 'INVALID_IMAGE_MAGIC', message: '外链返回内容不是受支持的 PNG/JPEG/WEBP 图片' } },
        400,
      );
    }
    const contentType =
      detected === 'jpeg' ? 'image/jpeg' : detected === 'webp' ? 'image/webp' : 'image/png';
    c.header('Content-Type', contentType);
    c.header('Cache-Control', 'private, max-age=300');
    return c.body(new Uint8Array(buf));
  } catch (err) {
    return c.json(
      {
        error: {
          code: 'PORTRAIT_FETCH_FAILED',
          message: err instanceof Error ? err.message : '拉取外链立绘失败',
        },
      },
      502,
    );
  }
});

cardM1Routes.post('/cards/:id/image', zValidator('json', CardImageUploadSchema), async (c) => {
  const denied = guardPermission(c, 'card:update');
  if (denied) return denied;

  const id = c.req.param('id');
  const input = c.req.valid('json');
  const ctx = c.get('ctx');

  const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const nowIso = getNow(ctx).toISOString();

  if (input.mode === 'crop_token') {
    if (!input.tokenDataUrl) {
      return c.json(
        { error: { code: 'MISSING_IMAGE_DATA', message: '缺少 1:1 Token 裁剪图片数据' } },
        400,
      );
    }
    const tokenSaved = await saveUploadDataUrl(ctx, id, 'token', input.tokenDataUrl);
    if (!tokenSaved.ok) {
      return c.json({ error: { code: tokenSaved.code, message: tokenSaved.message } }, tokenSaved.status);
    }

    await ctx.db
      .update(roleCards)
      .set({
        tokenImageUrl: tokenSaved.publicUrl,
        tokenCropJson: input.tokenCrop ? JSON.stringify(input.tokenCrop) : row.tokenCropJson,
        updatedAt: nowIso,
      })
      .where(eq(roleCards.id, id));

    const updatedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
    return c.json({ card: serializeCardRow(updatedRows[0]!) });
  }

  let nextTokenUrl: string | null = null;
  if (input.tokenDataUrl) {
    const tokenSaved = await saveUploadDataUrl(ctx, id, 'token', input.tokenDataUrl);
    if (!tokenSaved.ok) {
      return c.json({ error: { code: tokenSaved.code, message: tokenSaved.message } }, tokenSaved.status);
    }
    nextTokenUrl = tokenSaved.publicUrl;
  }

  if (input.mode === 'search_url') {
    if (!isSafeImageUrl(input.imageUrl)) {
      return c.json(
        { error: { code: 'UNSAFE_IMAGE_URL', message: '图片 URL 仅支持 http(s):// 或 /uploads/ 路径' } },
        400,
      );
    }
    if (input.imageUrl && /^https?:\/\//i.test(input.imageUrl)) {
      const mediaFetch = await loadScopedFetch(ctx, 'media');
      const ssrf = await validatePublicUrl(input.imageUrl, ctx.dnsLookup, {
        viaProxy: isUrlProxiedByFetch(mediaFetch, input.imageUrl),
      });
      if (!ssrf.ok) {
        return sendCoreError(c, ssrf.error);
      }
    }

    await ctx.db
      .update(roleCards)
      .set({
        imageUrl: input.imageUrl ?? null,
        tokenImageUrl: nextTokenUrl,
        tokenCropJson: nextTokenUrl && input.tokenCrop ? JSON.stringify(input.tokenCrop) : null,
        imageSource: 'search',
        imagePrompt: input.imagePrompt ?? row.imagePrompt,
        updatedAt: nowIso,
      })
      .where(eq(roleCards.id, id));

    const updatedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
    return c.json({ card: serializeCardRow(updatedRows[0]!) });
  }

  // mode === 'upload'
  if (!input.dataUrl) {
    return c.json(
      { error: { code: 'MISSING_IMAGE_DATA', message: '缺少图片 Base64 数据' } },
      400,
    );
  }

  const portraitSaved = await saveUploadDataUrl(ctx, id, 'portrait', input.dataUrl);
  if (!portraitSaved.ok) {
    return c.json(
      { error: { code: portraitSaved.code, message: portraitSaved.message } },
      portraitSaved.status,
    );
  }

  await ctx.db
    .update(roleCards)
    .set({
      imageUrl: portraitSaved.publicUrl,
      tokenImageUrl: nextTokenUrl,
      tokenCropJson: nextTokenUrl && input.tokenCrop ? JSON.stringify(input.tokenCrop) : null,
      imageSource: 'upload',
      imagePrompt: input.imagePrompt ?? row.imagePrompt,
      updatedAt: nowIso,
    })
    .where(eq(roleCards.id, id));

  const updatedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  return c.json({ card: serializeCardRow(updatedRows[0]!) });
});

cardM1Routes.post('/cards/:id/trpg', zValidator('json', GenerateTrpgStatsSchema), async (c) => {
  const denied = guardPermission(c, 'card:update');
  if (denied) return denied;

  const id = c.req.param('id');
  const { system } = c.req.valid('json');
  const ctx = c.get('ctx');
  const actorUserId = c.get('actor')?.userId ?? 'guest';

  const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const runtime = await loadRuntimeServiceConfig(ctx);
  if (!runtime) {
    return c.json(
      { error: { code: 'LLM_NOT_CONFIGURED', message: '尚未配置主大模型，无法推演 TRPG 规则数据' } },
      400,
    );
  }

  const currentContent = JSON.parse(row.contentJson) as RoleCardContent;
  const primaryFetch = resolveScopedFetch(ctx, runtime.proxyConfig, 'llm_primary');
  const llmPort = ctx.llmPort ?? createOpenAiCompatibleLlmPort(primaryFetch);
  const startedAt = Date.now();
  const result = await generateTrpgAttributesForCard(currentContent, system, {
    llmPort,
    llmSlot: runtime.primaryLlm,
    onStrategyDowngraded: async () => {
      await ctx.db
        .update(userServiceConfigs)
        .set({ jsonModeStrategy: 'prompt', updatedAt: getNow(ctx).toISOString() })
        .where(eq(userServiceConfigs.userId, 'global'));
    },
  });

  const nowIso = getNow(ctx).toISOString();
  const latencyMs = Date.now() - startedAt;

  if (!result.ok) {
    await ctx.db.insert(generationLogs).values({
      id: randomUUID(),
      userId: actorUserId,
      action: 'trpg_generate',
      targetId: id,
      provider: runtime.primaryLlm.provider,
      status: 'error',
      latencyMs,
      errorCode: result.error.code,
      errorMessage: result.error.message,
      createdAt: nowIso,
    });
    return sendCoreError(c, result.error);
  }

  const nextVersion = row.version + 1;
  const tokenCount = estimateCardTokens(result.value.content);
  const diffSummary = `已根据角色设定生成 ${system === 'coc7e' ? 'CoC 7e' : 'D&D 5e'} TRPG 规则数据`;

  await ctx.db
    .update(roleCards)
    .set({
      cardType: result.value.cardType,
      contentJson: JSON.stringify(result.value.content),
      diffSummary,
      tokenCount,
      version: nextVersion,
      updatedAt: nowIso,
    })
    .where(eq(roleCards.id, id));

  await ctx.db.insert(generationLogs).values({
    id: randomUUID(),
    userId: actorUserId,
    action: 'trpg_generate',
    targetId: id,
    provider: runtime.primaryLlm.provider,
    status: 'success',
    latencyMs,
    errorCode: null,
    errorMessage: null,
    createdAt: nowIso,
  });

  await publishSyncEvent(ctx, {
    eventType: 'card.updated',
    targetType: 'card',
    targetId: id,
    version: nextVersion,
    payload: {
      characterName: result.value.content.name,
      diffSummary,
    },
  });

  const updatedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  return c.json({ card: serializeCardRow(updatedRows[0]!) });
});
