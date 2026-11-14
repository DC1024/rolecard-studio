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
  exportCardToMarkdown,
  isSafeImageUrl,
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
import { loadRuntimeServiceConfig } from './config.js';
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
  const llmPort = ctx.llmPort ?? createOpenAiCompatibleLlmPort(ctx.fetchImpl);

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
  const llmPort = ctx.llmPort ?? createOpenAiCompatibleLlmPort(ctx.fetchImpl);

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
  const llmPort = ctx.llmPort ?? createOpenAiCompatibleLlmPort(ctx.fetchImpl);

  const metaSummary =
    row.entityType === 'real_person'
      ? null
      : parseMetaSummary(row.metaReputationJson);

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
    enableMetaInChat: row.enableMetaInChat && row.entityType !== 'real_person',
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

  if (input.mode === 'search_url') {
    if (!isSafeImageUrl(input.imageUrl)) {
      return c.json(
        { error: { code: 'UNSAFE_IMAGE_URL', message: '图片 URL 仅支持 http(s):// 或 /uploads/ 路径' } },
        400,
      );
    }
    if (input.imageUrl && /^https?:\/\//i.test(input.imageUrl)) {
      const ssrf = await validatePublicUrl(input.imageUrl, ctx.dnsLookup);
      if (!ssrf.ok) {
        return sendCoreError(c, ssrf.error);
      }
    }

    await ctx.db
      .update(roleCards)
      .set({
        imageUrl: input.imageUrl ?? null,
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

  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(
    input.dataUrl.trim(),
  );
  if (!match || !match[2]) {
    return c.json(
      { error: { code: 'INVALID_IMAGE_DATA_URL', message: '仅支持 PNG/JPEG/WEBP 格式的 DataURL' } },
      400,
    );
  }

  const buf = Buffer.from(match[2], 'base64');
  if (buf.length === 0 || buf.length > 3 * 1024 * 1024) {
    return c.json(
      { error: { code: 'IMAGE_TOO_LARGE', message: '图片体积必须在 1B ~ 3MB 之间' } },
      400,
    );
  }

  const detected = detectImageMagicBytes(buf);
  if (!detected) {
    return c.json(
      { error: { code: 'INVALID_IMAGE_MAGIC', message: '图片文件魔数校验失败，拒绝保存伪造图片' } },
      400,
    );
  }

  const ext = detected === 'jpeg' ? 'jpg' : detected;
  const contentType = detected === 'png' ? 'image/png' : detected === 'webp' ? 'image/webp' : 'image/jpeg';
  const fileName = `${id}-${Date.now()}.${ext}`;

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

  const publicUrl = `/uploads/${fileName}`;
  await ctx.db
    .update(roleCards)
    .set({
      imageUrl: publicUrl,
      imageSource: 'upload',
      imagePrompt: input.imagePrompt ?? row.imagePrompt,
      updatedAt: nowIso,
    })
    .where(eq(roleCards.id, id));

  const updatedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  return c.json({ card: serializeCardRow(updatedRows[0]!) });
});
