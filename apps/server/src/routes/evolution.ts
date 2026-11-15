import { randomUUID } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import {
  computeCardDiffSummary,
  computeStaggeredNextRunIso,
  createOpenAiCompatibleLlmPort,
  evolveRoleCard,
  generateSingleHopRippleProposals,
  preserveLockedFields,
  resolveProviderBaseUrl,
  type RippleNeighborInput,
} from '@rolecard/core';
import {
  estimateCardTokens,
  ResolveProposalSchema,
  UpdateMetaSettingsSchema,
  UpdateScheduleSchema,
  type ImpressionEventDto,
  type RippleProposalDto,
  type RoleCardContent,
  type SourceEntry,
  type SyncScheduleDto,
} from '@rolecard/shared';
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import { getNow, type ServerContext } from '../context.js';
import {
  impressionEvents,
  lorebookCharacterLinks,
  rippleProposals,
  roleCards,
  syncSchedules,
} from '../db/schema.js';
import { guardPermission, sendCoreError, type AppEnv } from '../middleware/auth.js';
import { serializeCardRow } from './cards.js';
import { loadRuntimeServiceConfig, resolveScopedFetch } from './config.js';
import { publishSyncEvent } from './sync.js';

export const evolutionRoutes = new Hono<AppEnv>();

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function toScheduleDto(row: typeof syncSchedules.$inferSelect): SyncScheduleDto {
  return {
    id: row.id,
    cardId: row.cardId,
    enabled: row.enabled,
    intervalDays: row.intervalDays,
    syncScope: row.syncScope,
    autoApplyThreshold: row.autoApplyThreshold,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    lastSourceHash: row.lastSourceHash,
    updatedAt: row.updatedAt,
  };
}

async function findSingleHopNeighbors(
  ctx: ServerContext,
  sourceCardId: string,
): Promise<RippleNeighborInput[]> {
  const sourceLinks = await ctx.db
    .select()
    .from(lorebookCharacterLinks)
    .where(eq(lorebookCharacterLinks.cardId, sourceCardId));

  if (sourceLinks.length === 0) return [];
  const bookIds = [...new Set(sourceLinks.map((l) => l.lorebookId))];
  const allLinks = await ctx.db
    .select()
    .from(lorebookCharacterLinks)
    .where(inArray(lorebookCharacterLinks.lorebookId, bookIds));

  const neighborIds = [
    ...new Set(allLinks.map((l) => l.cardId).filter((id) => id !== sourceCardId)),
  ];
  if (neighborIds.length === 0) return [];

  const neighborCards = await ctx.db
    .select({ id: roleCards.id, characterName: roleCards.characterName })
    .from(roleCards)
    .where(inArray(roleCards.id, neighborIds));
  const nameMap = new Map(neighborCards.map((c) => [c.id, c.characterName]));

  return allLinks
    .filter((l) => l.cardId !== sourceCardId)
    .map((l) => ({
      targetCardId: l.cardId,
      targetCharacterName: nameMap.get(l.cardId) ?? '关联角色',
      lorebookId: l.lorebookId,
      relationRole: l.relationRole,
    }));
}

async function createSingleHopRipplesForCard(
  ctx: ServerContext,
  sourceCard: typeof roleCards.$inferSelect,
  diffSummary: string,
): Promise<number> {
  const neighbors = await findSingleHopNeighbors(ctx, sourceCard.id);
  const proposals = generateSingleHopRippleProposals(
    sourceCard.id,
    sourceCard.characterName,
    diffSummary,
    neighbors,
  );
  const nowIso = getNow(ctx).toISOString();
  for (const p of proposals) {
    await ctx.db.insert(rippleProposals).values({
      id: randomUUID(),
      sourceCardId: p.sourceCardId,
      targetCardId: p.targetCardId,
      lorebookId: p.lorebookId,
      hop: p.hop,
      proposedAttitude: p.proposedAttitude,
      reason: p.reason,
      status: 'pending_review',
      createdAt: nowIso,
      resolvedAt: null,
    });
  }
  if (proposals.length > 0) {
    await publishSyncEvent(ctx, {
      eventType: 'review.pending',
      targetType: 'card',
      targetId: sourceCard.id,
      version: sourceCard.version,
      payload: {
        reviewType: 'ripple',
        rippleCount: proposals.length,
        characterName: sourceCard.characterName,
        diffSummary,
      },
    });
  }
  return proposals.length;
}

export async function executeEvolutionForCard(
  ctx: ServerContext,
  cardRow: typeof roleCards.$inferSelect,
  scheduleRow?: typeof syncSchedules.$inferSelect | null,
): Promise<{
  skipped: boolean;
  reason?: string;
  impressionId?: string;
  autoApplied?: boolean;
  ripplesCreated?: number;
}> {
  const runtimeCfg = await loadRuntimeServiceConfig(ctx);
  if (!runtimeCfg) {
    return { skipped: true, reason: 'LLM_NOT_CONFIGURED' };
  }

  const now = getNow(ctx);
  const nowIso = now.toISOString();
  const currentContent = JSON.parse(cardRow.contentJson) as RoleCardContent;
  const lockedFields = parseJsonArray<string>(cardRow.lockedFieldsJson);
  const syncScope = scheduleRow?.syncScope ?? 'canon';

  const primaryFetch = resolveScopedFetch(ctx, runtimeCfg.proxyConfig, 'llm_primary');
  const searchFetch = resolveScopedFetch(ctx, runtimeCfg.proxyConfig, 'search');
  const llmPort =
    ctx.llmPort ??
    createOpenAiCompatibleLlmPort(primaryFetch, {
      idleTimeoutMs: runtimeCfg.llmRequestTimeoutSeconds * 1000,
    });
  const baseUrl = resolveProviderBaseUrl(
    runtimeCfg.primaryLlm.provider,
    runtimeCfg.primaryLlm.baseUrl,
  );

  const evoRes = await evolveRoleCard(
    {
      cardId: cardRow.id,
      characterName: cardRow.characterName,
      workName: cardRow.workName,
      entityType: cardRow.entityType,
      currentContent,
      lockedFields,
      syncScope,
      lastSourceHash: scheduleRow?.lastSourceHash ?? null,
    },
    {
      fetchImpl: searchFetch,
      dnsLookup: ctx.dnsLookup,
      searchProviderPort: ctx.searchProviderPort,
      enableLayer1Wiki: runtimeCfg.enableLayer1Wiki,
      searchProvider: runtimeCfg.searchProvider,
      searchApiKey: runtimeCfg.searchApiKey,
      llmPort,
      llmSlot: {
        ...runtimeCfg.primaryLlm,
        baseUrl,
      },
    },
  );

  if (!evoRes.ok) {
    throw evoRes.error;
  }

  const intervalDays = scheduleRow?.intervalDays ?? 7;
  const nextRunAt = computeStaggeredNextRunIso(now, intervalDays, cardRow.id);

  if (evoRes.value.skipped) {
    if (scheduleRow) {
      await ctx.db
        .update(syncSchedules)
        .set({
          lastRunAt: nowIso,
          nextRunAt,
          updatedAt: nowIso,
        })
        .where(eq(syncSchedules.id, scheduleRow.id));
    }
    return { skipped: true, reason: evoRes.value.reason };
  }

  const autoMinor =
    scheduleRow?.autoApplyThreshold === 'auto_minor' &&
    cardRow.entityType === 'fictional';

  const impressionId = randomUUID();
  const status = autoMinor ? 'applied' : 'pending_review';

  await ctx.db.insert(impressionEvents).values({
    id: impressionId,
    cardId: cardRow.id,
    eventType: evoRes.value.changeReason,
    diffSummary: evoRes.value.diffSummary,
    beforeContentJson: JSON.stringify(currentContent),
    afterContentJson: JSON.stringify(evoRes.value.updatedContent),
    sourcesJson: JSON.stringify(evoRes.value.sources),
    metaSummary: evoRes.value.metaSummary,
    status,
    createdAt: nowIso,
    resolvedAt: autoMinor ? nowIso : null,
  });

  if (scheduleRow) {
    await ctx.db
      .update(syncSchedules)
      .set({
        lastRunAt: nowIso,
        nextRunAt,
        lastSourceHash: evoRes.value.sourceHash,
        updatedAt: nowIso,
      })
      .where(eq(syncSchedules.id, scheduleRow.id));
  }

  let ripplesCreated = 0;
  if (autoMinor) {
    const nextVersion = cardRow.version + 1;
    await ctx.db
      .update(roleCards)
      .set({
        contentJson: JSON.stringify(evoRes.value.updatedContent),
        metaReputationJson: evoRes.value.metaSummary
          ? JSON.stringify({ summary: evoRes.value.metaSummary, updatedAt: nowIso })
          : cardRow.metaReputationJson,
        diffSummary: evoRes.value.diffSummary,
        tokenCount: estimateCardTokens(evoRes.value.updatedContent),
        version: nextVersion,
        updatedAt: nowIso,
      })
      .where(eq(roleCards.id, cardRow.id));

    ripplesCreated = await createSingleHopRipplesForCard(
      ctx,
      cardRow,
      evoRes.value.diffSummary,
    );

    await publishSyncEvent(ctx, {
      eventType: 'card.evolved',
      targetType: 'card',
      targetId: cardRow.id,
      version: nextVersion,
      payload: {
        characterName: cardRow.characterName,
        diffSummary: evoRes.value.diffSummary,
      },
    });
  } else {
    await publishSyncEvent(ctx, {
      eventType: 'review.pending',
      targetType: 'card',
      targetId: cardRow.id,
      version: cardRow.version,
      payload: {
        reviewType: 'impression',
        impressionId,
        characterName: cardRow.characterName,
        diffSummary: evoRes.value.diffSummary,
      },
    });
  }

  return {
    skipped: false,
    impressionId,
    autoApplied: autoMinor,
    ripplesCreated,
  };
}

export async function runScheduledEvolutionTick(
  ctx: ServerContext,
): Promise<{ checked: number; evolved: number; skipped: number }> {
  const runtimeCfg = await loadRuntimeServiceConfig(ctx);
  const limit = runtimeCfg?.dailyAutoRefreshLimit ?? 20;
  const nowIso = getNow(ctx).toISOString();

  const dueSchedules = await ctx.db
    .select()
    .from(syncSchedules)
    .where(and(eq(syncSchedules.enabled, true), lte(syncSchedules.nextRunAt, nowIso)))
    .limit(limit);

  let evolved = 0;
  let skipped = 0;
  for (const sched of dueSchedules) {
    const cards = await ctx.db
      .select()
      .from(roleCards)
      .where(eq(roleCards.id, sched.cardId))
      .limit(1);
    const card = cards[0];
    if (!card) continue;
    try {
      const outcome = await executeEvolutionForCard(ctx, card, sched);
      if (outcome.skipped) skipped += 1;
      else evolved += 1;
    } catch {
      skipped += 1;
    }
  }

  return { checked: dueSchedules.length, evolved, skipped };
}

evolutionRoutes.get('/cards/:id/schedule', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const cardId = c.req.param('id');
  const ctx = c.get('ctx');
  const rows = await ctx.db
    .select()
    .from(syncSchedules)
    .where(eq(syncSchedules.cardId, cardId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    const defaultSchedule: SyncScheduleDto = {
      id: '',
      cardId,
      enabled: false,
      intervalDays: 7,
      syncScope: 'canon',
      autoApplyThreshold: 'manual_review',
      lastRunAt: null,
      nextRunAt: null,
      lastSourceHash: null,
      updatedAt: getNow(ctx).toISOString(),
    };
    return c.json({ schedule: defaultSchedule });
  }

  return c.json({ schedule: toScheduleDto(row) });
});

evolutionRoutes.put(
  '/cards/:id/schedule',
  zValidator('json', UpdateScheduleSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const cardId = c.req.param('id');
    const input = c.req.valid('json');
    const ctx = c.get('ctx');

    const cardRows = await ctx.db
      .select()
      .from(roleCards)
      .where(eq(roleCards.id, cardId))
      .limit(1);
    const card = cardRows[0];
    if (!card) {
      return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
    }

    // Respect user-selected syncScope (defaults to 'canon' unless user explicitly enables meta)
    const safeScope = input.syncScope;
    const now = getNow(ctx);
    const nowIso = now.toISOString();
    const nextRunAt = input.enabled
      ? computeStaggeredNextRunIso(now, input.intervalDays, cardId)
      : null;

    const existing = await ctx.db
      .select()
      .from(syncSchedules)
      .where(eq(syncSchedules.cardId, cardId))
      .limit(1);

    const savedId = existing[0]?.id ?? randomUUID();
    if (existing[0]) {
      await ctx.db
        .update(syncSchedules)
        .set({
          enabled: input.enabled,
          intervalDays: input.intervalDays,
          syncScope: safeScope,
          autoApplyThreshold: input.autoApplyThreshold,
          nextRunAt,
          updatedAt: nowIso,
        })
        .where(eq(syncSchedules.id, savedId));
    } else {
      await ctx.db.insert(syncSchedules).values({
        id: savedId,
        cardId,
        enabled: input.enabled,
        intervalDays: input.intervalDays,
        syncScope: safeScope,
        autoApplyThreshold: input.autoApplyThreshold,
        lastRunAt: null,
        nextRunAt,
        lastSourceHash: null,
        updatedAt: nowIso,
      });
    }

    await ctx.db
      .update(roleCards)
      .set({ scheduleEnabled: input.enabled, updatedAt: nowIso })
      .where(eq(roleCards.id, cardId));

    const updated = await ctx.db
      .select()
      .from(syncSchedules)
      .where(eq(syncSchedules.id, savedId))
      .limit(1);

    return c.json({ schedule: toScheduleDto(updated[0]!) });
  },
);

evolutionRoutes.patch(
  '/cards/:id/meta-settings',
  zValidator('json', UpdateMetaSettingsSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const cardId = c.req.param('id');
    const input = c.req.valid('json');
    const ctx = c.get('ctx');

    const rows = await ctx.db
      .select()
      .from(roleCards)
      .where(eq(roleCards.id, cardId))
      .limit(1);
    const card = rows[0];
    if (!card) {
      return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
    }

    const nowIso = getNow(ctx).toISOString();
    const updatePatch: Partial<typeof roleCards.$inferInsert> = {
      updatedAt: nowIso,
    };
    if (input.enableMetaInChat !== undefined) {
      updatePatch.enableMetaInChat = input.enableMetaInChat;
    }
    if (input.metaSummary !== undefined) {
      const trimmedMeta = input.metaSummary?.trim() ?? '';
      updatePatch.metaReputationJson = trimmedMeta
        ? JSON.stringify({ summary: trimmedMeta, updatedAt: nowIso })
        : null;
    }

    await ctx.db
      .update(roleCards)
      .set(updatePatch)
      .where(eq(roleCards.id, cardId));

    const updated = await ctx.db
      .select()
      .from(roleCards)
      .where(eq(roleCards.id, cardId))
      .limit(1);
    return c.json({ card: serializeCardRow(updated[0]!) });
  },
);

evolutionRoutes.post('/cards/:id/evolve', async (c) => {
  const denied = guardPermission(c, 'card:update');
  if (denied) return denied;

  const cardId = c.req.param('id');
  const ctx = c.get('ctx');

  const cardRows = await ctx.db
    .select()
    .from(roleCards)
    .where(eq(roleCards.id, cardId))
    .limit(1);
  const card = cardRows[0];
  if (!card) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const schedRows = await ctx.db
    .select()
    .from(syncSchedules)
    .where(eq(syncSchedules.cardId, cardId))
    .limit(1);

  try {
    const result = await executeEvolutionForCard(ctx, card, schedRows[0] ?? null);
    if (result.skipped && result.reason === 'LLM_NOT_CONFIGURED') {
      return c.json(
        { error: { code: 'CONFIG_MISSING', message: '请先配置主推理大模型后再执行角色演化' } },
        400,
      );
    }
    return c.json(result);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && 'status' in error) {
      return sendCoreError(
        c,
        error as { code: string; message: string; status: number },
      );
    }
    throw error;
  }
});

evolutionRoutes.post('/evolution/tick', async (c) => {
  const denied = guardPermission(c, 'card:update');
  if (denied) return denied;

  const summary = await runScheduledEvolutionTick(c.get('ctx'));
  return c.json(summary);
});

evolutionRoutes.get('/reviews', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const ctx = c.get('ctx');
  const impRows = await ctx.db
    .select()
    .from(impressionEvents)
    .orderBy(desc(impressionEvents.createdAt))
    .limit(100);

  const ripRows = await ctx.db
    .select()
    .from(rippleProposals)
    .orderBy(desc(rippleProposals.createdAt))
    .limit(100);

  const cardIds = new Set<string>();
  for (const r of impRows) cardIds.add(r.cardId);
  for (const r of ripRows) {
    cardIds.add(r.sourceCardId);
    cardIds.add(r.targetCardId);
  }

  const cardRows =
    cardIds.size > 0
      ? await ctx.db
          .select({ id: roleCards.id, characterName: roleCards.characterName })
          .from(roleCards)
          .where(inArray(roleCards.id, [...cardIds]))
      : [];
  const nameMap = new Map(cardRows.map((row) => [row.id, row.characterName]));

  const impressions: ImpressionEventDto[] = impRows.map((row) => ({
    id: row.id,
    cardId: row.cardId,
    characterName: nameMap.get(row.cardId) ?? '未知角色',
    eventType: row.eventType,
    diffSummary: row.diffSummary,
    beforeContent: JSON.parse(row.beforeContentJson) as RoleCardContent,
    afterContent: JSON.parse(row.afterContentJson) as RoleCardContent,
    sources: parseJsonArray<SourceEntry>(row.sourcesJson),
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  }));

  const ripples: RippleProposalDto[] = ripRows.map((row) => ({
    id: row.id,
    sourceCardId: row.sourceCardId,
    sourceCharacterName: nameMap.get(row.sourceCardId) ?? '源角色',
    targetCardId: row.targetCardId,
    targetCharacterName: nameMap.get(row.targetCardId) ?? '目标角色',
    lorebookId: row.lorebookId,
    hop: row.hop,
    proposedAttitude: row.proposedAttitude,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  }));

  return c.json({ impressions, ripples });
});

evolutionRoutes.post(
  '/reviews/impressions/:id',
  zValidator('json', ResolveProposalSchema),
  async (c) => {
    const denied = guardPermission(c, 'review:resolve');
    if (denied) return denied;

    const id = c.req.param('id');
    const { decision } = c.req.valid('json');
    const ctx = c.get('ctx');

    const rows = await ctx.db
      .select()
      .from(impressionEvents)
      .where(eq(impressionEvents.id, id))
      .limit(1);
    const imp = rows[0];
    if (!imp) {
      return c.json({ error: { code: 'IMPRESSION_NOT_FOUND', message: '演化记录不存在' } }, 404);
    }
    if (imp.status !== 'pending_review') {
      return c.json({ error: { code: 'ALREADY_RESOLVED', message: '该演化记录已处理' } }, 409);
    }

    const nowIso = getNow(ctx).toISOString();
    if (decision === 'reject') {
      await ctx.db
        .update(impressionEvents)
        .set({ status: 'rejected', resolvedAt: nowIso })
        .where(eq(impressionEvents.id, id));
      return c.json({ ok: true, status: 'rejected' });
    }

    const cardRows = await ctx.db
      .select()
      .from(roleCards)
      .where(eq(roleCards.id, imp.cardId))
      .limit(1);
    const card = cardRows[0];
    if (!card) {
      return c.json({ error: { code: 'CARD_NOT_FOUND', message: '关联角色卡不存在' } }, 404);
    }

    const currentContent = JSON.parse(card.contentJson) as RoleCardContent;
    const candidateContent = JSON.parse(imp.afterContentJson) as RoleCardContent;
    const lockedFields = parseJsonArray<string>(card.lockedFieldsJson);
    const mergedContent = preserveLockedFields(currentContent, candidateContent, lockedFields);
    const diffSummary = computeCardDiffSummary(currentContent, mergedContent);
    const nextVersion = card.version + 1;

    await ctx.db
      .update(roleCards)
      .set({
        characterName: mergedContent.name,
        contentJson: JSON.stringify(mergedContent),
        metaReputationJson:
          imp.metaSummary
            ? JSON.stringify({ summary: imp.metaSummary, updatedAt: nowIso })
            : card.metaReputationJson,
        diffSummary,
        tokenCount: estimateCardTokens(mergedContent),
        version: nextVersion,
        updatedAt: nowIso,
      })
      .where(eq(roleCards.id, card.id));

    await ctx.db
      .update(impressionEvents)
      .set({ status: 'applied', resolvedAt: nowIso })
      .where(eq(impressionEvents.id, id));

    const ripplesCreated = await createSingleHopRipplesForCard(ctx, card, diffSummary);

    await publishSyncEvent(ctx, {
      eventType: 'card.evolved',
      targetType: 'card',
      targetId: card.id,
      version: nextVersion,
      payload: {
        characterName: mergedContent.name,
        diffSummary,
      },
    });

    return c.json({ ok: true, status: 'applied', ripplesCreated });
  },
);

evolutionRoutes.post(
  '/reviews/ripples/:id',
  zValidator('json', ResolveProposalSchema),
  async (c) => {
    const denied = guardPermission(c, 'review:resolve');
    if (denied) return denied;

    const id = c.req.param('id');
    const { decision } = c.req.valid('json');
    const ctx = c.get('ctx');

    const rows = await ctx.db
      .select()
      .from(rippleProposals)
      .where(eq(rippleProposals.id, id))
      .limit(1);
    const proposal = rows[0];
    if (!proposal) {
      return c.json({ error: { code: 'RIPPLE_NOT_FOUND', message: '涟漪提案不存在' } }, 404);
    }
    if (proposal.status !== 'pending_review') {
      return c.json({ error: { code: 'ALREADY_RESOLVED', message: '该涟漪提案已处理' } }, 409);
    }

    const nowIso = getNow(ctx).toISOString();
    if (decision === 'reject') {
      await ctx.db
        .update(rippleProposals)
        .set({ status: 'rejected', resolvedAt: nowIso })
        .where(eq(rippleProposals.id, id));
      return c.json({ ok: true, status: 'rejected' });
    }

    const targetRows = await ctx.db
      .select()
      .from(roleCards)
      .where(eq(roleCards.id, proposal.targetCardId))
      .limit(1);
    const targetCard = targetRows[0];
    if (!targetCard) {
      return c.json({ error: { code: 'CARD_NOT_FOUND', message: '目标角色卡不存在' } }, 404);
    }

    const sourceRows = await ctx.db
      .select({ characterName: roleCards.characterName })
      .from(roleCards)
      .where(eq(roleCards.id, proposal.sourceCardId))
      .limit(1);
    const sourceName = sourceRows[0]?.characterName ?? '关联角色';

    const content = JSON.parse(targetCard.contentJson) as RoleCardContent;
    const lockedFields = parseJsonArray<string>(targetCard.lockedFieldsJson);
    const updatedContent: RoleCardContent = {
      ...content,
      relationships: [
        ...content.relationships.filter((r) => r.target !== sourceName),
        {
          target: sourceName,
          relation: '世界书关联角色',
          attitude: proposal.proposedAttitude,
        },
      ],
    };
    const finalContent = preserveLockedFields(content, updatedContent, lockedFields);
    const nextVersion = targetCard.version + 1;

    await ctx.db
      .update(roleCards)
      .set({
        contentJson: JSON.stringify(finalContent),
        diffSummary: `已应用来自「${sourceName}」的关系涟漪调整`,
        tokenCount: estimateCardTokens(finalContent),
        version: nextVersion,
        updatedAt: nowIso,
      })
      .where(eq(roleCards.id, targetCard.id));

    await ctx.db
      .update(rippleProposals)
      .set({ status: 'approved', resolvedAt: nowIso })
      .where(eq(rippleProposals.id, id));

    await publishSyncEvent(ctx, {
      eventType: 'ripple.approved',
      targetType: 'card',
      targetId: targetCard.id,
      version: nextVersion,
      payload: {
        sourceCardId: proposal.sourceCardId,
        targetCardId: targetCard.id,
        proposedAttitude: proposal.proposedAttitude,
      },
    });

    return c.json({ ok: true, status: 'approved' });
  },
);
