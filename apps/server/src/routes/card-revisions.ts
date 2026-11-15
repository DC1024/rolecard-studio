import { randomUUID } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import { RollbackCardRequestSchema } from '@rolecard/shared';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getNow, type ServerContext } from '../context.js';
import { roleCardRevisions, roleCards } from '../db/schema.js';
import { guardPermission, type AppEnv } from '../middleware/auth.js';
import { serializeCardRow } from './cards.js';
import { publishSyncEvent } from './sync.js';

const MAX_REVISIONS_PER_CARD = 20;

export const cardRevisionsRoutes = new Hono<AppEnv>();

export async function saveCardRevisionSnapshot(
  ctx: ServerContext,
  row: typeof roleCards.$inferSelect,
  meta: {
    action: string;
    summary: string;
    createdBy?: string;
  },
): Promise<string> {
  const revisionId = randomUUID();
  const nowIso = getNow(ctx).toISOString();

  await ctx.db.insert(roleCardRevisions).values({
    id: revisionId,
    cardId: row.id,
    action: meta.action,
    summary: meta.summary,
    characterName: row.characterName,
    cardType: row.cardType,
    tagsJson: row.tagsJson,
    contentJson: row.contentJson,
    lockedFieldsJson: row.lockedFieldsJson,
    tokenCount: row.tokenCount,
    createdBy: meta.createdBy ?? 'guest',
    createdAt: nowIso,
  });

  const existing = await ctx.db
    .select({ id: roleCardRevisions.id })
    .from(roleCardRevisions)
    .where(eq(roleCardRevisions.cardId, row.id))
    .orderBy(desc(roleCardRevisions.createdAt), desc(sql`rowid`));

  if (existing.length > MAX_REVISIONS_PER_CARD) {
    const staleIds = existing.slice(MAX_REVISIONS_PER_CARD).map((r) => r.id);
    await ctx.db.delete(roleCardRevisions).where(inArray(roleCardRevisions.id, staleIds));
  }

  return revisionId;
}

cardRevisionsRoutes.get('/cards/:id/revisions', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const id = c.req.param('id');
  const ctx = c.get('ctx');
  const cardRows = await ctx.db
    .select({ id: roleCards.id })
    .from(roleCards)
    .where(eq(roleCards.id, id))
    .limit(1);
  if (cardRows.length === 0) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const rows = await ctx.db
    .select({
      id: roleCardRevisions.id,
      cardId: roleCardRevisions.cardId,
      action: roleCardRevisions.action,
      summary: roleCardRevisions.summary,
      tokenCount: roleCardRevisions.tokenCount,
      createdBy: roleCardRevisions.createdBy,
      createdAt: roleCardRevisions.createdAt,
    })
    .from(roleCardRevisions)
    .where(eq(roleCardRevisions.cardId, id))
    .orderBy(desc(roleCardRevisions.createdAt), desc(sql`rowid`))
    .limit(MAX_REVISIONS_PER_CARD);

  return c.json({ revisions: rows });
});

cardRevisionsRoutes.post(
  '/cards/:id/rollback',
  zValidator('json', RollbackCardRequestSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const id = c.req.param('id');
    const { revisionId } = c.req.valid('json');
    const ctx = c.get('ctx');
    const actorUserId = c.get('actor')?.userId ?? 'guest';

    const cardRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
    const currentRow = cardRows[0];
    if (!currentRow) {
      return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
    }

    const candidates = await ctx.db
      .select()
      .from(roleCardRevisions)
      .where(eq(roleCardRevisions.cardId, id))
      .orderBy(desc(roleCardRevisions.createdAt), desc(sql`rowid`))
      .limit(MAX_REVISIONS_PER_CARD);

    const target = revisionId
      ? candidates.find((item) => item.id === revisionId)
      : candidates[0];

    if (!target) {
      return c.json(
        { error: { code: 'REVISION_NOT_FOUND', message: '暂无可撤回的历史版本' } },
        404,
      );
    }

    await saveCardRevisionSnapshot(ctx, currentRow, {
      action: 'rollback',
      summary: `撤回前版本（恢复自：${target.summary || target.action}）`,
      createdBy: actorUserId,
    });

    const nowIso = getNow(ctx).toISOString();
    const nextVersion = currentRow.version + 1;
    const diffSummary = `已撤回至上一版本 (${target.summary || target.action})`;

    await ctx.db
      .update(roleCards)
      .set({
        characterName: target.characterName,
        cardType: target.cardType,
        tagsJson: target.tagsJson,
        contentJson: target.contentJson,
        lockedFieldsJson: target.lockedFieldsJson,
        tokenCount: target.tokenCount,
        diffSummary,
        version: nextVersion,
        updatedAt: nowIso,
      })
      .where(eq(roleCards.id, id));

    await publishSyncEvent(ctx, {
      eventType: 'card.updated',
      targetType: 'card',
      targetId: id,
      version: nextVersion,
      payload: {
        characterName: target.characterName,
        diffSummary,
      },
    });

    const updatedRows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
    return c.json({
      card: serializeCardRow(updatedRows[0]!),
      restoredRevisionId: target.id,
    });
  },
);
