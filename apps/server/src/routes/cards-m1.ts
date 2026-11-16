import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { zValidator } from '@hono/zod-validator';
import {
  appendTurnToMesExample,
  clipToTokenBudget,
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
  fetchRemoteImageBuffer,
  fetchUserReferenceUrl,
  generateCardField,
  generateTrpgAttributesForCard,
  isFakeIpAllowedByFetch,
  isSafeImageUrl,
  isUrlProxiedByFetch,
  layeredRetrieve,
  mergeLorebooksToCharacterBook,
  preserveLockedFields,
  reconcileTrpgExtensionsOnEdit,
  refineRoleCard,
  regenerateRoleCard,
  resolveProviderBaseUrl,
  runPlaytestTurn,
  switchActiveTrpgSystem,
  toCharaCardV3,
  trpgSystemToCardType,
  validatePublicUrl,
} from '@rolecard/core';
import {
  AddCardSourcesRequestSchema,
  AdoptMesExampleSchema,
  CardImageUploadSchema,
  estimateCardTokens,
  ExportFormatSchema,
  GenerateCardFieldRequestSchema,
  GenerateTrpgStatsSchema,
  type LorebookEntry,
  PlaytestRequestSchema,
  RefineCardRequestSchema,
  RegenerateCardRequestSchema,
  SearchCardSourcesRequestSchema,
  SwitchTrpgSystemSchema,
  type TrpgSystemKey,
  TrpgSystemKeySchema,
  UpdateCardContentSchema,
  type RoleCardContent,
  type SourceEntry,
} from '@rolecard/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { getNow, type ServerContext } from '../context.js';
import { generationLogs, roleCards, userServiceConfigs } from '../db/schema.js';
import { guardPermission, sendCoreError, type AppEnv } from '../middleware/auth.js';
import { saveCardRevisionSnapshot } from './card-revisions.js';
import { serializeCardRow } from './cards.js';
import { loadRuntimeServiceConfig, loadScopedFetch, resolveScopedFetch } from './config.js';
import { loadLinkedLorebooksForCard } from './lorebooks.js';
import { findAuthorizedPlaytestSession, persistPlaytestSessionTurn } from './playtest.js';
import { publishSyncEvent } from './sync.js';

export const cardM1Routes = new Hono<AppEnv>();

const CompressRequestSchema = z.object({
  targetMaxTokens: z.number().int().min(150).max(8000).default(1200),
});

const FIELD_PROGRESS_LABELS: Record<string, string> = {
  summary: '角色简介',
  personality: '性格特征',
  appearance: '外貌立绘',
  background: '背景故事',
  scenario: '场景设定',
  speech_style: '语言风格与口癖',
  relationships: '人际关系网',
  first_mes: '默认开场白',
  alternate_greetings: '备选开场白',
  mes_example: '对话示例',
  system_prompt: '系统提示词',
  creator_notes: '作者备注',
  tags: '角色标签',
};

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
  const actorUserId = c.get('actor')?.userId ?? 'guest';

  const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const currentContent = JSON.parse(row.contentJson) as RoleCardContent;
  const lockedFields = input.lockedFields ?? parseJsonArray<string>(row.lockedFieldsJson);
  const preservedContent = preserveLockedFields(currentContent, input.content, lockedFields);
  const nextTags = [
    ...new Set((input.tags ?? preservedContent.tags).map((t) => t.trim()).filter(Boolean)),
  ];
  preservedContent.tags = nextTags;

  const reconciled = reconcileTrpgExtensionsOnEdit(currentContent, preservedContent, row.cardType);
  const nextContent = reconciled.content;
  const nextCardType =
    reconciled.activeSystem &&
    (row.cardType === 'trpg_coc7' ||
      row.cardType === 'trpg_dnd5e' ||
      currentContent.extensions.activeTrpgSystem !== nextContent.extensions.activeTrpgSystem)
      ? trpgSystemToCardType(reconciled.activeSystem)
      : row.cardType;

  const nextContentJson = JSON.stringify(nextContent);
  const nextTagsJson = JSON.stringify(nextTags);
  const contentOrTagsChanged =
    row.contentJson !== nextContentJson || row.tagsJson !== nextTagsJson || row.cardType !== nextCardType;

  const nowIso = getNow(ctx).toISOString();
  const diffSummary = computeCardDiffSummary(currentContent, nextContent);
  const tokenCount = estimateCardTokens(nextContent);

  if (contentOrTagsChanged) {
    await saveCardRevisionSnapshot(ctx, row, {
      action: 'manual_edit',
      summary: diffSummary === '无字段实质变更' ? '手动保存编辑' : diffSummary,
      createdBy: actorUserId,
    });
  }

  await ctx.db
    .update(roleCards)
    .set({
      cardType: nextCardType,
      characterName: nextContent.name,
      tagsJson: nextTagsJson,
      contentJson: nextContentJson,
      lockedFieldsJson: JSON.stringify(lockedFields),
      diffSummary: contentOrTagsChanged ? diffSummary : row.diffSummary,
      tokenCount,
      version: contentOrTagsChanged ? row.version + 1 : row.version,
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
  const { instruction, sourceIndices } = c.req.valid('json');
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
  const sources = parseJsonArray<SourceEntry>(row.sourcesJson);
  const primaryFetch = resolveScopedFetch(ctx, runtime.proxyConfig, 'llm_primary');
  const llmPort =
    ctx.llmPort ??
    createOpenAiCompatibleLlmPort(primaryFetch, {
      idleTimeoutMs: runtime.llmRequestTimeoutSeconds * 1000,
    });

  const runRefine = async (hooks?: {
    onProgress?: (event: { step: string; message: string }) => void | Promise<void>;
    onReasoningDelta?: (delta: string) => void | Promise<void>;
  }) => {
    const startedAt = Date.now();
    await hooks?.onProgress?.({
      step: 'preparing',
      message: `正在整理角色卡设定与已选参考资料，准备调用 ${runtime.primaryLlm.model} 执行整卡局部微调...`,
    });

    const result = await refineRoleCard(currentContent, instruction, {
      llmPort,
      llmSlot: runtime.primaryLlm,
      lockedFields,
      sources,
      sourceIndices,
      workName: row.workName,
      customSystemPrompt: runtime.customSystemPrompt,
      onProgress: hooks?.onProgress,
      onReasoningDelta: hooks?.onReasoningDelta,
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
      return { ok: false as const, error: result.error };
    }

    await hooks?.onProgress?.({
      step: 'persisting',
      message: `「执行整卡局部微调」结构化校验通过，正在保存结果...`,
    });

    await saveCardRevisionSnapshot(ctx, row, {
      action: 'refine',
      summary: result.value.diffSummary,
      createdBy: actorUserId,
    });

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
    return {
      ok: true as const,
      payload: {
        card: serializeCardRow(updatedRows[0]!),
        diffSummary: result.value.diffSummary,
      },
    };
  };

  const wantsSse = (c.req.header('accept') ?? '').includes('text/event-stream');
  if (wantsSse) {
    return streamSSE(c, async (stream) => {
      let sentThinkingHeader = false;
      let closed = false;
      const heartbeat = setInterval(() => {
        if (closed) return;
        void stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => {
          closed = true;
        });
      }, 15_000);
      try {
        const outcome = await runRefine({
          onProgress: async (evt) => {
            await stream.writeSSE({
              event: 'progress',
              data: JSON.stringify({ step: evt.step, message: evt.message }),
            });
          },
          onReasoningDelta: async (delta) => {
            if (!sentThinkingHeader) {
              sentThinkingHeader = true;
              await stream.writeSSE({
                event: 'progress',
                data: JSON.stringify({
                  step: 'thinking',
                  message: `${runtime.primaryLlm.model} 正在思考推演（执行整卡局部微调）...`,
                }),
              });
            }
            await stream.writeSSE({
              event: 'thinking',
              data: JSON.stringify({ delta }),
            });
          },
        });
        if (!outcome.ok) {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({
              code: outcome.error.code,
              message: outcome.error.message,
              status: outcome.error.status,
            }),
          });
          return;
        }
        await stream.writeSSE({
          event: 'result',
          data: JSON.stringify(outcome.payload),
        });
      } finally {
        closed = true;
        clearInterval(heartbeat);
      }
    });
  }

  const outcome = await runRefine();
  if (!outcome.ok) {
    return sendCoreError(c, outcome.error);
  }
  return c.json(outcome.payload);
});

cardM1Routes.post(
  '/cards/:id/generate-field',
  zValidator('json', GenerateCardFieldRequestSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const id = c.req.param('id');
    const { field, instruction, sourceIndices } = c.req.valid('json');
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

    const currentContent = JSON.parse(row.contentJson) as RoleCardContent;
    const sources = parseJsonArray<SourceEntry>(row.sourcesJson);
    const primaryFetch = resolveScopedFetch(ctx, runtime.proxyConfig, 'llm_primary');
    const llmPort =
      ctx.llmPort ??
      createOpenAiCompatibleLlmPort(primaryFetch, {
        idleTimeoutMs: runtime.llmRequestTimeoutSeconds * 1000,
      });

    const fieldLabel = FIELD_PROGRESS_LABELS[field] ?? field;
    const runGenerateField = async (hooks?: {
      onProgress?: (event: { step: string; message: string }) => void | Promise<void>;
      onReasoningDelta?: (delta: string) => void | Promise<void>;
    }) => {
      const startedAt = Date.now();
      await hooks?.onProgress?.({
        step: 'preparing',
        message: `正在组装上下文与参考资料，准备调用 ${runtime.primaryLlm.model} 生成「${fieldLabel}」...`,
      });

      const result = await generateCardField(currentContent, field, {
        llmPort,
        llmSlot: runtime.primaryLlm,
        workName: row.workName,
        cardType: row.cardType,
        entityType: row.entityType,
        sources,
        sourceIndices,
        instruction,
        customSystemPrompt: runtime.customSystemPrompt,
        onProgress: hooks?.onProgress,
        onReasoningDelta: hooks?.onReasoningDelta,
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
        return { ok: false as const, error: result.error };
      }

      await hooks?.onProgress?.({
        step: 'persisting',
        message: `「生成「${fieldLabel}」」结构化校验通过，正在保存结果...`,
      });

      await saveCardRevisionSnapshot(ctx, row, {
        action: 'generate_field',
        summary: result.value.diffSummary,
        createdBy: actorUserId,
      });

      const nextVersion = row.version + 1;
      await ctx.db
        .update(roleCards)
        .set({
          tagsJson: JSON.stringify(result.value.content.tags),
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
      return {
        ok: true as const,
        payload: {
          card: serializeCardRow(updatedRows[0]!),
          field: result.value.field,
          fieldLabel: result.value.fieldLabel,
          diffSummary: result.value.diffSummary,
        },
      };
    };

    const wantsSse = (c.req.header('accept') ?? '').includes('text/event-stream');
    if (wantsSse) {
      return streamSSE(c, async (stream) => {
        let sentThinkingHeader = false;
        let closed = false;
        const heartbeat = setInterval(() => {
          if (closed) return;
          void stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => {
            closed = true;
          });
        }, 15_000);
        try {
          const outcome = await runGenerateField({
            onProgress: async (evt) => {
              await stream.writeSSE({
                event: 'progress',
                data: JSON.stringify({ step: evt.step, message: evt.message }),
              });
            },
            onReasoningDelta: async (delta) => {
            if (!sentThinkingHeader) {
              sentThinkingHeader = true;
              await stream.writeSSE({
                event: 'progress',
                data: JSON.stringify({
                  step: 'thinking',
                  message: `${runtime.primaryLlm.model} 正在思考推演（生成「${fieldLabel}」）...`,
                }),
              });
            }
              await stream.writeSSE({
                event: 'thinking',
                data: JSON.stringify({ delta }),
              });
            },
          });
          if (!outcome.ok) {
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({
                code: outcome.error.code,
                message: outcome.error.message,
                status: outcome.error.status,
              }),
            });
            return;
          }
          await stream.writeSSE({
            event: 'result',
            data: JSON.stringify(outcome.payload),
          });
        } finally {
          closed = true;
          clearInterval(heartbeat);
        }
      });
    }

    const outcome = await runGenerateField();
    if (!outcome.ok) {
      return sendCoreError(c, outcome.error);
    }
    return c.json(outcome.payload);
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
  const llmPort =
    ctx.llmPort ??
    createOpenAiCompatibleLlmPort(primaryFetch, {
      idleTimeoutMs: runtime.llmRequestTimeoutSeconds * 1000,
    });

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

  await saveCardRevisionSnapshot(ctx, row, {
    action: 'compress',
    summary: result.value.diffSummary,
    createdBy: actorUserId,
  });

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
  const rawTrpgSystem = c.req.query('trpgSystem');
  let requestedTrpgSystem: TrpgSystemKey | undefined;
  if (rawTrpgSystem !== undefined && rawTrpgSystem !== '') {
    const trpgParse = TrpgSystemKeySchema.safeParse(rawTrpgSystem);
    if (!trpgParse.success) {
      return c.json(
        { error: { code: 'INVALID_TRPG_SYSTEM', message: '不支持的 TRPG 规则系统参数' } },
        400,
      );
    }
    requestedTrpgSystem = trpgParse.data;
  }
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
      trpgSystem: requestedTrpgSystem,
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
      trpgSystem: requestedTrpgSystem,
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
  const actor = c.get('actor');
  const actorUserId = actor?.userId ?? 'guest';

  const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  let existingSession: Awaited<ReturnType<typeof findAuthorizedPlaytestSession>> = null;
  if (input.sessionId) {
    existingSession = await findAuthorizedPlaytestSession(
      ctx,
      input.sessionId,
      actorUserId,
      actor?.role,
      id,
    );
    if (!existingSession) {
      return c.json(
        { error: { code: 'PLAYTEST_SESSION_NOT_FOUND', message: '试聊会话不存在' } },
        404,
      );
    }
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
  const llmPort =
    ctx.llmPort ??
    createOpenAiCompatibleLlmPort(chatFetch, {
      idleTimeoutMs: runtime.llmRequestTimeoutSeconds * 1000,
    });

  const metaSummary = parseMetaSummary(row.metaReputationJson);

  const linkedBookRows = await loadLinkedLorebooksForCard(ctx, id);
  const playtestLorebooks = linkedBookRows.map((lb) => ({
    id: lb.id,
    name: lb.name,
    entries: parseJsonArray<LorebookEntry>(lb.entriesJson),
  }));

  let effectiveHistory = input.history;
  if (effectiveHistory.length === 0 && existingSession) {
    const stored = parseJsonArray<{ role: 'user' | 'assistant'; content: string }>(
      existingSession.messagesJson,
    );
    effectiveHistory = stored
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-40)
      .map((m) => ({ role: m.role, content: m.content }));
  }

  const turnResult = await runPlaytestTurn(
    content,
    {
      ...input,
      history: effectiveHistory,
    },
    {
      llmPort,
      llmSlot: effectiveSlot,
      lorebooks: playtestLorebooks,
      enableMetaInChat: row.enableMetaInChat,
      metaReputationSummary: metaSummary,
      fallbackCardType: row.cardType,
    },
  );

  if (!turnResult.ok) {
    return sendCoreError(c, turnResult.error);
  }

  if (input.saveSession !== false) {
    const savedSessionId = await persistPlaytestSessionTurn(ctx, {
      cardId: id,
      actorUserId,
      existingSession,
      request: input,
      response: turnResult.value,
    });
    return c.json({
      ...turnResult.value,
      sessionId: savedSessionId,
    });
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
  const actorUserId = c.get('actor')?.userId ?? 'guest';

  const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  await saveCardRevisionSnapshot(ctx, row, {
    action: 'adopt_example',
    summary: '采纳试聊对话片段至对话示例',
    createdBy: actorUserId,
  });

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
  const result = await fetchRemoteImageBuffer(row.imageUrl, {
    fetchImpl: mediaFetch,
    dnsLookup: ctx.dnsLookup,
    maxBytes: 12 * 1024 * 1024,
  });
  if (!result.ok) {
    return sendCoreError(c, result.error);
  }

  c.header('Content-Type', result.value.contentType);
  c.header('Cache-Control', 'private, max-age=300');
  c.header('X-Content-Type-Options', 'nosniff');
  return c.body(new Uint8Array(result.value.buffer));
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
        allowFakeIp: isFakeIpAllowedByFetch(mediaFetch),
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
  const { system, activate } = c.req.valid('json');
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
  const llmPort =
    ctx.llmPort ??
    createOpenAiCompatibleLlmPort(primaryFetch, {
      idleTimeoutMs: runtime.llmRequestTimeoutSeconds * 1000,
    });
  const systemLabel = system === 'coc7e' ? 'CoC 7e 调查员规则面板' : 'D&D 5e 角色规则面板';

  const runTrpg = async (hooks?: {
    onProgress?: (event: { step: string; message: string }) => void | Promise<void>;
    onReasoningDelta?: (delta: string) => void | Promise<void>;
  }) => {
    const startedAt = Date.now();
    await hooks?.onProgress?.({
      step: 'preparing',
      message: `正在整理「${row.characterName}」角色设定，准备调用 ${runtime.primaryLlm.model} 推演「${systemLabel}」...`,
    });

    const result = await generateTrpgAttributesForCard(currentContent, system, {
      llmPort,
      llmSlot: runtime.primaryLlm,
      activate,
      onProgress: hooks?.onProgress,
      onReasoningDelta: hooks?.onReasoningDelta,
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
      return { ok: false as const, error: result.error };
    }

    await hooks?.onProgress?.({
      step: 'persisting',
      message: `「${systemLabel}」推演校验通过，正在保存规则属性...`,
    });

    const nextVersion = row.version + 1;
    const tokenCount = estimateCardTokens(result.value.content);
    const diffSummary = `已根据角色设定生成 ${system === 'coc7e' ? 'CoC 7e' : 'D&D 5e'} TRPG 规则数据`;

    await saveCardRevisionSnapshot(ctx, row, {
      action: 'trpg_generate',
      summary: diffSummary,
      createdBy: actorUserId,
    });

    const nextCardType = activate === false ? row.cardType : result.value.cardType;
    await ctx.db
      .update(roleCards)
      .set({
        cardType: nextCardType,
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
    return {
      ok: true as const,
      payload: { card: serializeCardRow(updatedRows[0]!) },
    };
  };

  const wantsSse = (c.req.header('accept') ?? '').includes('text/event-stream');
  if (wantsSse) {
    return streamSSE(c, async (stream) => {
      let sentThinkingHeader = false;
      let closed = false;
      const heartbeat = setInterval(() => {
        if (closed) return;
        void stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => {
          closed = true;
        });
      }, 15_000);
      try {
        const outcome = await runTrpg({
          onProgress: async (evt) => {
            await stream.writeSSE({
              event: 'progress',
              data: JSON.stringify({ step: evt.step, message: evt.message }),
            });
          },
          onReasoningDelta: async (delta) => {
            if (!sentThinkingHeader) {
              sentThinkingHeader = true;
              await stream.writeSSE({
                event: 'progress',
                data: JSON.stringify({
                  step: 'thinking',
                  message: `${runtime.primaryLlm.model} 正在思考推演（${systemLabel}）...`,
                }),
              });
            }
            await stream.writeSSE({
              event: 'thinking',
              data: JSON.stringify({ delta }),
            });
          },
        });
        if (!outcome.ok) {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({
              code: outcome.error.code,
              message: outcome.error.message,
              status: outcome.error.status,
            }),
          });
          return;
        }
        await stream.writeSSE({
          event: 'result',
          data: JSON.stringify(outcome.payload),
        });
      } finally {
        closed = true;
        clearInterval(heartbeat);
      }
    });
  }

  const outcome = await runTrpg();
  if (!outcome.ok) {
    return sendCoreError(c, outcome.error);
  }
  return c.json(outcome.payload);
});

cardM1Routes.patch(
  '/cards/:id/trpg/active',
  zValidator('json', SwitchTrpgSystemSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const id = c.req.param('id');
    const { system } = c.req.valid('json');
    const ctx = c.get('ctx');

    const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
    const row = rows[0];
    if (!row) {
      return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
    }

    const currentContent = JSON.parse(row.contentJson) as RoleCardContent;
    const switched = switchActiveTrpgSystem(currentContent, system, row.cardType);
    if (!switched) {
      return c.json(
        {
          error: {
            code: 'TRPG_SYSTEM_NOT_FOUND',
            message: `该角色尚未生成 ${system === 'coc7e' ? 'CoC 7e' : 'D&D 5e'} 规则面板，请先执行 AI 推演`,
          },
        },
        400,
      );
    }

    const nowIso = getNow(ctx).toISOString();
    const nextCardType = trpgSystemToCardType(system);
    const diffSummary = `切换当前默认 TRPG 规则为 ${system === 'coc7e' ? 'CoC 7e' : 'D&D 5e'}`;

    await ctx.db
      .update(roleCards)
      .set({
        cardType: nextCardType,
        contentJson: JSON.stringify(switched),
        diffSummary,
        tokenCount: estimateCardTokens(switched),
        updatedAt: nowIso,
      })
      .where(eq(roleCards.id, id));

    await publishSyncEvent(ctx, {
      eventType: 'card.updated',
      targetType: 'card',
      targetId: id,
      version: row.version,
      payload: {
        characterName: row.characterName,
        diffSummary,
      },
    });

    const updatedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
    return c.json({ card: serializeCardRow(updatedRows[0]!) });
  },
);

cardM1Routes.post(
  '/cards/:id/regenerate',
  zValidator('json', RegenerateCardRequestSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const id = c.req.param('id');
    const { instruction, sourceIndices } = c.req.valid('json');
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
    const sources = parseJsonArray<SourceEntry>(row.sourcesJson);
    const primaryFetch = resolveScopedFetch(ctx, runtime.proxyConfig, 'llm_primary');
    const llmPort =
      ctx.llmPort ??
      createOpenAiCompatibleLlmPort(primaryFetch, {
        idleTimeoutMs: runtime.llmRequestTimeoutSeconds * 1000,
      });

    const runRegenerate = async (hooks?: {
      onProgress?: (event: { step: string; message: string }) => void | Promise<void>;
      onReasoningDelta?: (delta: string) => void | Promise<void>;
    }) => {
      const startedAt = Date.now();
      await hooks?.onProgress?.({
        step: 'preparing',
        message: `正在整理「${row.characterName}」未锁定区块与参考资料，准备调用 ${runtime.primaryLlm.model} 一键生成...`,
      });

      const result = await regenerateRoleCard(currentContent, {
        llmPort,
        llmSlot: runtime.primaryLlm,
        lockedFields,
        sources,
        sourceIndices,
        workName: row.workName,
        cardType: row.cardType,
        entityType: row.entityType,
        instruction,
        customSystemPrompt: runtime.customSystemPrompt,
        onProgress: hooks?.onProgress,
        onReasoningDelta: hooks?.onReasoningDelta,
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
          action: 'regenerate',
          targetId: id,
          provider: runtime.primaryLlm.provider,
          status: 'error',
          latencyMs,
          errorCode: result.error.code,
          errorMessage: result.error.message,
          createdAt: nowIso,
        });
        return { ok: false as const, error: result.error };
      }

      await hooks?.onProgress?.({
        step: 'persisting',
        message: '「一键 AI 生成」结构化校验通过，正在保存结果...',
      });

      await saveCardRevisionSnapshot(ctx, row, {
        action: 'regenerate',
        summary: result.value.diffSummary,
        createdBy: actorUserId,
      });

      const nextVersion = row.version + 1;
      await ctx.db
        .update(roleCards)
        .set({
          characterName: result.value.content.name,
          tagsJson: JSON.stringify(result.value.content.tags),
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
        action: 'regenerate',
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
          diffSummary: result.value.diffSummary,
        },
      });

      const updatedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
      return {
        ok: true as const,
        payload: {
          card: serializeCardRow(updatedRows[0]!),
          regeneratedFields: result.value.regeneratedFields,
          skippedLockedFields: result.value.skippedLockedFields,
          diffSummary: result.value.diffSummary,
        },
      };
    };

    const wantsSse = (c.req.header('accept') ?? '').includes('text/event-stream');
    if (wantsSse) {
      return streamSSE(c, async (stream) => {
        let sentThinkingHeader = false;
        let closed = false;
        const heartbeat = setInterval(() => {
          if (closed) return;
          void stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => {
            closed = true;
          });
        }, 15_000);
        try {
          const outcome = await runRegenerate({
            onProgress: async (evt) => {
              await stream.writeSSE({
                event: 'progress',
                data: JSON.stringify({ step: evt.step, message: evt.message }),
              });
            },
            onReasoningDelta: async (delta) => {
              if (!sentThinkingHeader) {
                sentThinkingHeader = true;
                await stream.writeSSE({
                  event: 'progress',
                  data: JSON.stringify({
                    step: 'thinking',
                    message: `${runtime.primaryLlm.model} 正在思考推演（一键生成未锁定区块）...`,
                  }),
                });
              }
              await stream.writeSSE({
                event: 'thinking',
                data: JSON.stringify({ delta }),
              });
            },
          });
          if (!outcome.ok) {
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({
                code: outcome.error.code,
                message: outcome.error.message,
                status: outcome.error.status,
              }),
            });
            return;
          }
          await stream.writeSSE({
            event: 'result',
            data: JSON.stringify(outcome.payload),
          });
        } finally {
          closed = true;
          clearInterval(heartbeat);
        }
      });
    }

    const outcome = await runRegenerate();
    if (!outcome.ok) {
      return sendCoreError(c, outcome.error);
    }
    return c.json(outcome.payload);
  },
);

function sourceDedupeKey(src: SourceEntry): string {
  if (src.url?.trim()) {
    return `url:${src.url.trim().toLowerCase()}`;
  }
  return `text:${src.title.trim().toLowerCase()}::${src.snippet.trim().slice(0, 120)}`;
}

function mergeSourcesDedupe(
  existing: readonly SourceEntry[],
  incoming: readonly SourceEntry[],
): { merged: SourceEntry[]; addedCount: number } {
  const seen = new Set(existing.map(sourceDedupeKey));
  const merged = [...existing];
  let addedCount = 0;

  for (const item of incoming) {
    const key = sourceDedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
    addedCount += 1;
  }

  return { merged, addedCount };
}

cardM1Routes.post('/cards/:id/sources', zValidator('json', AddCardSourcesRequestSchema), async (c) => {
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

  const incoming: SourceEntry[] = [];
  const failedUrls: Array<{ url: string; message: string }> = [];

  for (const textItem of input.textSources) {
    incoming.push({
      title: textItem.title?.trim() || '用户补充设定',
      snippet: clipToTokenBudget(textItem.content.trim(), 2500),
      origin: 'user_provided',
      provider: 'user_text',
    });
  }

  if (input.urls.length > 0) {
    const searchFetch = await loadScopedFetch(ctx, 'search');
    const fetchedList = await Promise.all(
      input.urls.map(async (url) => ({
        url,
        res: await fetchUserReferenceUrl(url, {
          fetchImpl: searchFetch,
          dnsLookup: ctx.dnsLookup,
        }),
      })),
    );
    for (const item of fetchedList) {
      if (item.res.ok) {
        incoming.push(item.res.source);
      } else {
        failedUrls.push({ url: item.url, message: item.res.message });
      }
    }
  }

  for (const entry of input.entries) {
    incoming.push({
      ...entry,
      snippet: clipToTokenBudget(entry.snippet.trim(), 2500),
    });
  }

  if (incoming.length === 0 && failedUrls.length > 0) {
    return c.json(
      {
        error: {
          code: 'SOURCE_URL_FETCH_FAILED',
          message: failedUrls.map((f) => `${f.url}: ${f.message}`).join('；'),
        },
      },
      400,
    );
  }

  const existingSources = parseJsonArray<SourceEntry>(row.sourcesJson);
  const { merged, addedCount } = mergeSourcesDedupe(existingSources, incoming);
  const nowIso = getNow(ctx).toISOString();

  await ctx.db
    .update(roleCards)
    .set({
      sourcesJson: JSON.stringify(merged),
      updatedAt: nowIso,
    })
    .where(eq(roleCards.id, id));

  const updatedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  return c.json({
    card: serializeCardRow(updatedRows[0]!),
    addedCount,
    failedUrls,
  });
});

cardM1Routes.delete('/cards/:id/sources/:index', async (c) => {
  const denied = guardPermission(c, 'card:update');
  if (denied) return denied;

  const id = c.req.param('id');
  const rawIndex = c.req.param('index');
  const index = Number(rawIndex);
  const ctx = c.get('ctx');

  const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const existingSources = parseJsonArray<SourceEntry>(row.sourcesJson);
  if (!Number.isInteger(index) || index < 0 || index >= existingSources.length) {
    return c.json(
      { error: { code: 'INVALID_SOURCE_INDEX', message: '无效的引用条目索引' } },
      400,
    );
  }

  const removed = existingSources[index]!;
  const nextSources = existingSources.filter((_, i) => i !== index);
  const nowIso = getNow(ctx).toISOString();

  await ctx.db
    .update(roleCards)
    .set({
      sourcesJson: JSON.stringify(nextSources),
      updatedAt: nowIso,
    })
    .where(eq(roleCards.id, id));

  const updatedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  return c.json({
    card: serializeCardRow(updatedRows[0]!),
    removed,
  });
});

cardM1Routes.post(
  '/cards/:id/sources/search',
  zValidator('json', SearchCardSourcesRequestSchema),
  async (c) => {
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

    const runtime = await loadRuntimeServiceConfig(ctx);
    const searchFetch = runtime
      ? resolveScopedFetch(ctx, runtime.proxyConfig, 'search')
      : await loadScopedFetch(ctx, 'search');

    const retrieved = await layeredRetrieve(
      {
        characterName: input.query,
        workName: '',
        enableLayer1Wiki: input.enableLayer1Wiki ?? runtime?.enableLayer1Wiki ?? true,
        searchProvider: runtime?.searchProvider,
        searchApiKey: runtime?.searchApiKey,
        deepSearch: input.deepSearch ?? true,
      },
      {
        fetchImpl: searchFetch,
        dnsLookup: ctx.dnsLookup,
        searchProviderPort: ctx.searchProviderPort,
      },
    );

    let addedCount = 0;
    let updatedCard = serializeCardRow(row);

    if (input.appendToCard && retrieved.sources.length > 0) {
      const existingSources = parseJsonArray<SourceEntry>(row.sourcesJson);
      const { merged, addedCount: delta } = mergeSourcesDedupe(existingSources, retrieved.sources);
      addedCount = delta;
      if (delta > 0) {
        const nowIso = getNow(ctx).toISOString();
        await ctx.db
          .update(roleCards)
          .set({
            sourcesJson: JSON.stringify(merged),
            updatedAt: nowIso,
          })
          .where(eq(roleCards.id, id));
        const refreshedRows = await ctx.db
          .select()
          .from(roleCards)
          .where(eq(roleCards.id, id))
          .limit(1);
        if (refreshedRows[0]) {
          updatedCard = serializeCardRow(refreshedRows[0]);
        }
      }
    }

    return c.json({
      query: input.query,
      sources: retrieved.sources,
      layer1Hits: retrieved.layer1Hits,
      layer2Hits: retrieved.layer2Hits,
      addedCount,
      card: updatedCard,
    });
  },
);

