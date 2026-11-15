import { randomUUID } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import {
  createOpenAiCompatibleLlmPort,
  generateRoleCard,
  type GeneratedCardOutput,
} from '@rolecard/core';
import {
  CardListQuerySchema,
  GenerateCardRequestSchema,
  UpdateCardTagsSchema,
  type GenerateCardRequest,
  type RoleCardContent,
  type SourceEntry,
  type TokenCrop,
} from '@rolecard/shared';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getNow, type ServerContext } from '../context.js';
import { generationLogs, roleCards, userServiceConfigs } from '../db/schema.js';
import { guardPermission, sendCoreError, type AppEnv } from '../middleware/auth.js';
import { loadRuntimeServiceConfig, resolveScopedFetch } from './config.js';

export const cardRoutes = new Hono<AppEnv>();

export interface SerializedRoleCard {
  id: string;
  userId: string;
  parentCardId: string | null;
  version: number;
  publishStatus: 'published' | 'pending_review' | 'archived';
  entityType: 'fictional' | 'real_person';
  characterName: string;
  workName: string;
  tags: string[];
  cardType: 'general' | 'sillytavern_v3' | 'trpg_coc7' | 'trpg_dnd5e' | 'custom';
  mode: 'A' | 'B' | 'C';
  content: RoleCardContent;
  sources: SourceEntry[];
  tokenCount: number;
  imageUrl: string | null;
  tokenImageUrl: string | null;
  tokenCrop: TokenCrop | null;
  imageSource: string | null;
  imagePrompt: string | null;
  lockedFields: string[];
  diffSummary: string | null;
  enableMetaInChat: boolean;
  scheduleEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export function serializeCardRow(row: typeof roleCards.$inferSelect): SerializedRoleCard {
  return {
    id: row.id,
    userId: row.userId,
    parentCardId: row.parentCardId,
    version: row.version,
    publishStatus: row.publishStatus,
    entityType: row.entityType,
    characterName: row.characterName,
    workName: row.workName,
    tags: safeParseJsonArray<string>(row.tagsJson),
    cardType: row.cardType,
    mode: row.mode,
    content: JSON.parse(row.contentJson) as RoleCardContent,
    sources: safeParseJsonArray<SourceEntry>(row.sourcesJson),
    tokenCount: row.tokenCount,
    imageUrl: row.imageUrl,
    tokenImageUrl: row.tokenImageUrl ?? null,
    tokenCrop: safeParseJsonObject<TokenCrop>(row.tokenCropJson),
    imageSource: row.imageSource,
    imagePrompt: row.imagePrompt,
    lockedFields: safeParseJsonArray<string>(row.lockedFieldsJson),
    diffSummary: row.diffSummary,
    enableMetaInChat: row.enableMetaInChat,
    scheduleEnabled: row.scheduleEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeParseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function safeParseJsonObject<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

export interface GenerationStreamHooks {
  onProgress?: (event: { step: string; message: string }) => void | Promise<void>;
  onReasoningDelta?: (delta: string) => void | Promise<void>;
}

export async function executeAndPersistGeneration(
  ctx: ServerContext,
  actorUserId: string,
  input: GenerateCardRequest,
  hooks: GenerationStreamHooks = {},
): Promise<
  | { ok: true; card: SerializedRoleCard; output: GeneratedCardOutput }
  | { ok: false; code: string; message: string; status: number }
> {
  const startedAt = Date.now();
  const runtime = await loadRuntimeServiceConfig(ctx);

  if (!runtime) {
    return {
      ok: false,
      code: 'LLM_NOT_CONFIGURED',
      message: '尚未配置主大模型，请先前往「模型与系统设置」填写至少 1 个 LLM 配置',
      status: 400,
    };
  }

  const primaryFetch = resolveScopedFetch(ctx, runtime.proxyConfig, 'llm_primary');
  const searchFetch = resolveScopedFetch(ctx, runtime.proxyConfig, 'search');
  const llmPort = ctx.llmPort ?? createOpenAiCompatibleLlmPort(primaryFetch);
  const genResult = await generateRoleCard(input, {
    llmPort,
    llmSlot: runtime.primaryLlm,
    fetchImpl: searchFetch,
    dnsLookup: ctx.dnsLookup,
    searchProviderPort: ctx.searchProviderPort,
    enableLayer1Wiki: runtime.enableLayer1Wiki,
    searchProvider: runtime.searchProvider,
    searchApiKey: runtime.searchApiKey,
    customSystemPrompt: runtime.customSystemPrompt,
    onProgress: hooks.onProgress,
    onReasoningDelta: hooks.onReasoningDelta,
    onStrategyDowngraded: async () => {
      await ctx.db
        .update(userServiceConfigs)
        .set({ jsonModeStrategy: 'prompt', updatedAt: getNow(ctx).toISOString() })
        .where(eq(userServiceConfigs.userId, 'global'));
    },
  });

  const latencyMs = Date.now() - startedAt;
  const nowIso = getNow(ctx).toISOString();

  if (!genResult.ok) {
    await ctx.db.insert(generationLogs).values({
      id: randomUUID(),
      userId: actorUserId,
      action: 'generate',
      targetId: null,
      provider: runtime.primaryLlm.provider,
      status: 'error',
      latencyMs,
      errorCode: genResult.error.code,
      errorMessage: genResult.error.message,
      createdAt: nowIso,
    });
    return {
      ok: false,
      code: genResult.error.code,
      message: genResult.error.message,
      status: genResult.error.status,
    };
  }

  await hooks.onProgress?.({
    step: 'persisting',
    message: '结构化校验通过，正在保存角色卡与考据溯源...',
  });

  const cardId = randomUUID();
  const output = genResult.value;
  const newRow: typeof roleCards.$inferInsert = {
    id: cardId,
    userId: actorUserId,
    parentCardId: null,
    version: 1,
    publishStatus: 'published',
    entityType: input.entityType,
    characterName: input.characterName,
    workName: input.workName,
    tagsJson: JSON.stringify(output.content.tags),
    cardType: input.cardType,
    mode: input.mode,
    referenceInfo: input.referenceText,
    contentJson: JSON.stringify(output.content),
    metaReputationJson: null,
    enableMetaInChat: false,
    lockedFieldsJson: '[]',
    diffSummary: null,
    sourcesJson: JSON.stringify(output.sources),
    searchSnapshot: null,
    tokenCount: output.tokenCount,
    imageUrl: null,
    imageSource: null,
    imagePrompt: null,
    scheduleEnabled: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await ctx.db.insert(roleCards).values(newRow);
  await ctx.db.insert(generationLogs).values({
    id: randomUUID(),
    userId: actorUserId,
    action: 'generate',
    targetId: cardId,
    provider: runtime.primaryLlm.provider,
    status: 'success',
    latencyMs,
    errorCode: null,
    errorMessage: null,
    createdAt: nowIso,
  });

  const savedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, cardId)).limit(1);
  const saved = savedRows[0];
  if (!saved) {
    return {
      ok: false,
      code: 'DB_PERSIST_ERROR',
      message: '角色卡写入后读取失败',
      status: 500,
    };
  }

  return {
    ok: true,
    card: serializeCardRow(saved),
    output,
  };
}

cardRoutes.post('/generate', zValidator('json', GenerateCardRequestSchema), async (c) => {
  const denied = guardPermission(c, 'card:create');
  if (denied) return denied;

  const input = c.req.valid('json');
  const ctx = c.get('ctx');
  const actorUserId = c.get('actor')?.userId ?? 'guest';
  const wantsSse = (c.req.header('accept') ?? '').includes('text/event-stream');

  if (wantsSse) {
    return streamSSE(c, async (stream) => {
      let sentThinkingHeader = false;
      const result = await executeAndPersistGeneration(ctx, actorUserId, input, {
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
              data: JSON.stringify({ step: 'thinking', message: '大模型正在思考推演...' }),
            });
          }
          await stream.writeSSE({
            event: 'thinking',
            data: JSON.stringify({ delta }),
          });
        },
      });
      if (!result.ok) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ code: result.code, message: result.message, status: result.status }),
        });
        return;
      }

      await stream.writeSSE({
        event: 'result',
        data: JSON.stringify({
          card: result.card,
          meta: {
            effectiveJsonStrategy: result.output.effectiveJsonStrategy,
            attempts: result.output.attempts,
            temperature: result.output.temperature,
          },
        }),
      });
    });
  }

  const result = await executeAndPersistGeneration(ctx, actorUserId, input);
  if (!result.ok) {
    return sendCoreError(c, {
      code: result.code,
      message: result.message,
      status: result.status,
    });
  }

  return c.json(
    {
      card: result.card,
      meta: {
        effectiveJsonStrategy: result.output.effectiveJsonStrategy,
        attempts: result.output.attempts,
        temperature: result.output.temperature,
      },
    },
    201 as ContentfulStatusCode,
  );
});

cardRoutes.get('/cards', zValidator('query', CardListQuerySchema), async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const query = c.req.valid('query');
  const ctx = c.get('ctx');
  const allRows = await ctx.db.select().from(roleCards).orderBy(desc(roleCards.updatedAt));

  // Aggregate common tags by frequency across all cards
  const tagCounts = new Map<string, number>();
  for (const row of allRows) {
    const tags = safeParseJsonArray<string>(row.tagsJson);
    for (const tag of tags) {
      const clean = tag.trim();
      if (clean) {
        tagCounts.set(clean, (tagCounts.get(clean) ?? 0) + 1);
      }
    }
  }
  const commonTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));

  const requiredTags = query.tags
    ? query.tags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const keyword = query.q?.toLowerCase();

  const filtered = allRows.filter((row) => {
    if (query.cardType && row.cardType !== query.cardType) return false;
    if (query.mode && row.mode !== query.mode) return false;
    if (query.scheduleEnabled !== undefined && row.scheduleEnabled !== query.scheduleEnabled) {
      return false;
    }

    const rowTags = safeParseJsonArray<string>(row.tagsJson);
    if (requiredTags.length > 0) {
      const lowerSet = new Set(rowTags.map((t) => t.toLowerCase()));
      for (const reqTag of requiredTags) {
        if (!lowerSet.has(reqTag)) return false;
      }
    }

    if (keyword) {
      const haystack = `${row.characterName} ${row.workName} ${rowTags.join(' ')} ${row.contentJson}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }

    return true;
  });

  const total = filtered.length;
  const offset = (query.page - 1) * query.pageSize;
  const paged = filtered.slice(offset, offset + query.pageSize).map(serializeCardRow);

  return c.json({
    items: paged,
    total,
    page: query.page,
    pageSize: query.pageSize,
    commonTags,
  });
});

cardRoutes.get('/cards/:id', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const id = c.req.param('id');
  const rows = await c.get('ctx').db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }
  return c.json({ card: serializeCardRow(row) });
});

cardRoutes.patch('/cards/:id/tags', zValidator('json', UpdateCardTagsSchema), async (c) => {
  const denied = guardPermission(c, 'card:update');
  if (denied) return denied;

  const id = c.req.param('id');
  const { tags } = c.req.valid('json');
  const ctx = c.get('ctx');

  const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const deduped = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  const content = JSON.parse(row.contentJson) as RoleCardContent;
  content.tags = deduped;

  const nowIso = getNow(ctx).toISOString();
  await ctx.db
    .update(roleCards)
    .set({
      tagsJson: JSON.stringify(deduped),
      contentJson: JSON.stringify(content),
      updatedAt: nowIso,
    })
    .where(eq(roleCards.id, id));

  return c.json({
    id,
    tags: deduped,
    updatedAt: nowIso,
  });
});

cardRoutes.delete('/cards/:id', async (c) => {
  const denied = guardPermission(c, 'card:delete');
  if (denied) return denied;

  const id = c.req.param('id');
  const ctx = c.get('ctx');
  const rows = await ctx.db
    .select({ id: roleCards.id })
    .from(roleCards)
    .where(eq(roleCards.id, id))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  await ctx.db.delete(roleCards).where(eq(roleCards.id, id));
  return c.json({ ok: true, id });
});
