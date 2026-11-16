import { randomUUID } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import {
  UpdatePlaytestSessionSchema,
  type PlaytestRequest,
  type PlaytestResponse,
  type PlaytestSessionDto,
  type PlaytestSessionSummaryDto,
  type PlaytestStoredMessage,
  type PlaytestTrpgMode,
} from '@rolecard/shared';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getNow, type ServerContext } from '../context.js';
import { playtestSessions, roleCards } from '../db/schema.js';
import { guardPermission, type AppEnv } from '../middleware/auth.js';

export const playtestRoutes = new Hono<AppEnv>();

function parseStoredMessages(raw: string | null | undefined): PlaytestStoredMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PlaytestStoredMessage[]) : [];
  } catch {
    return [];
  }
}

function normalizeTrpgMode(raw: string | null | undefined): PlaytestTrpgMode {
  if (raw === 'coc7e' || raw === 'dnd5e' || raw === 'none') {
    return raw;
  }
  return 'auto';
}

function buildSessionTitle(message: string): string {
  const firstLine = message.replace(/\r?\n/g, ' ').trim();
  if (!firstLine) return '新试聊会话';
  return firstLine.length > 26 ? `${firstLine.slice(0, 26)}...` : firstLine;
}

function toSummaryDto(row: typeof playtestSessions.$inferSelect): PlaytestSessionSummaryDto {
  return {
    id: row.id,
    cardId: row.cardId,
    userId: row.userId,
    title: row.title,
    greetingIndex: row.greetingIndex,
    userName: row.userName,
    userPersona: row.userPersona,
    trpgMode: normalizeTrpgMode(row.trpgMode),
    modelOverride: row.modelOverride,
    messageCount: row.messageCount,
    lastMessagePreview: row.lastMessagePreview,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toFullDto(row: typeof playtestSessions.$inferSelect): PlaytestSessionDto {
  return {
    ...toSummaryDto(row),
    messages: parseStoredMessages(row.messagesJson),
  };
}

export async function findAuthorizedPlaytestSession(
  ctx: ServerContext,
  sessionId: string,
  actorUserId: string,
  actorRole?: string,
  expectedCardId?: string,
): Promise<typeof playtestSessions.$inferSelect | null> {
  const rows = await ctx.db
    .select()
    .from(playtestSessions)
    .where(eq(playtestSessions.id, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (expectedCardId && row.cardId !== expectedCardId) return null;
  if (actorRole !== 'admin' && row.userId !== actorUserId) return null;
  return row;
}

export async function persistPlaytestSessionTurn(
  ctx: ServerContext,
  params: {
    cardId: string;
    actorUserId: string;
    existingSession: typeof playtestSessions.$inferSelect | null;
    request: PlaytestRequest;
    response: PlaytestResponse;
  },
): Promise<string> {
  const nowIso = getNow(ctx).toISOString();
  const userTurn: PlaytestStoredMessage = {
    role: 'user',
    content: params.request.message,
    createdAt: nowIso,
  };
  const assistantTurn: PlaytestStoredMessage = {
    role: 'assistant',
    content: params.response.reply,
    createdAt: nowIso,
    debug: {
      hitLorebooks: params.response.hitLorebooks,
      metaInjected: params.response.metaInjected,
      trpgSystemInjected: params.response.trpgSystemInjected ?? null,
      usedModel: params.response.usedModel,
      usedProvider: params.response.usedProvider,
    },
  };

  const trpgMode: PlaytestTrpgMode = params.request.trpgSystem ?? 'auto';
  const modelOverride = params.request.modelOverride?.model?.trim() ?? '';
  const previewRaw = params.response.reply.replace(/\s+/g, ' ').trim();
  const lastMessagePreview = previewRaw.length > 80 ? `${previewRaw.slice(0, 80)}...` : previewRaw;

  if (params.existingSession) {
    const existingMessages = parseStoredMessages(params.existingSession.messagesJson);
    const nextMessages = [...existingMessages, userTurn, assistantTurn];
    await ctx.db
      .update(playtestSessions)
      .set({
        greetingIndex: params.request.greetingIndex,
        userName: params.request.userName,
        userPersona: params.request.userPersona,
        trpgMode,
        modelOverride,
        messagesJson: JSON.stringify(nextMessages),
        messageCount: nextMessages.length,
        lastMessagePreview,
        updatedAt: nowIso,
      })
      .where(eq(playtestSessions.id, params.existingSession.id));
    return params.existingSession.id;
  }

  const seedMessages: PlaytestStoredMessage[] = [
    ...params.request.history.map((h) => ({
      role: h.role,
      content: h.content,
    })),
    userTurn,
    assistantTurn,
  ];
  const sessionId = randomUUID();
  await ctx.db.insert(playtestSessions).values({
    id: sessionId,
    cardId: params.cardId,
    userId: params.actorUserId,
    title: buildSessionTitle(params.request.history[0]?.content ?? params.request.message),
    greetingIndex: params.request.greetingIndex,
    userName: params.request.userName,
    userPersona: params.request.userPersona,
    trpgMode,
    modelOverride,
    messagesJson: JSON.stringify(seedMessages),
    messageCount: seedMessages.length,
    lastMessagePreview,
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  return sessionId;
}

playtestRoutes.get('/cards/:id/playtest/sessions', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const cardId = c.req.param('id');
  const ctx = c.get('ctx');
  const actorUserId = c.get('actor')?.userId ?? 'guest';

  const cardRows = await ctx.db
    .select({ id: roleCards.id })
    .from(roleCards)
    .where(eq(roleCards.id, cardId))
    .limit(1);
  if (cardRows.length === 0) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const rows = await ctx.db
    .select()
    .from(playtestSessions)
    .where(and(eq(playtestSessions.cardId, cardId), eq(playtestSessions.userId, actorUserId)))
    .orderBy(desc(playtestSessions.updatedAt));

  return c.json({ items: rows.map(toSummaryDto) });
});

playtestRoutes.get('/playtest/sessions/:sessionId', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const sessionId = c.req.param('sessionId');
  const ctx = c.get('ctx');
  const actor = c.get('actor');
  const actorUserId = actor?.userId ?? 'guest';

  const row = await findAuthorizedPlaytestSession(ctx, sessionId, actorUserId, actor?.role);
  if (!row) {
    return c.json({ error: { code: 'PLAYTEST_SESSION_NOT_FOUND', message: '试聊会话不存在' } }, 404);
  }

  return c.json({ session: toFullDto(row) });
});

playtestRoutes.patch(
  '/playtest/sessions/:sessionId',
  zValidator('json', UpdatePlaytestSessionSchema),
  async (c) => {
    const denied = guardPermission(c, 'playtest:use');
    if (denied) return denied;

    const sessionId = c.req.param('sessionId');
    const input = c.req.valid('json');
    const ctx = c.get('ctx');
    const actor = c.get('actor');
    const actorUserId = actor?.userId ?? 'guest';

    const row = await findAuthorizedPlaytestSession(ctx, sessionId, actorUserId, actor?.role);
    if (!row) {
      return c.json(
        { error: { code: 'PLAYTEST_SESSION_NOT_FOUND', message: '试聊会话不存在' } },
        404,
      );
    }

    const nowIso = getNow(ctx).toISOString();
    await ctx.db
      .update(playtestSessions)
      .set({
        title: input.title ?? row.title,
        greetingIndex: input.greetingIndex ?? row.greetingIndex,
        userName: input.userName ?? row.userName,
        userPersona: input.userPersona ?? row.userPersona,
        trpgMode: input.trpgMode ?? normalizeTrpgMode(row.trpgMode),
        modelOverride: input.modelOverride ?? row.modelOverride,
        updatedAt: nowIso,
      })
      .where(eq(playtestSessions.id, sessionId));

    const updated = await ctx.db
      .select()
      .from(playtestSessions)
      .where(eq(playtestSessions.id, sessionId))
      .limit(1);

    return c.json({ session: toSummaryDto(updated[0]!) });
  },
);

playtestRoutes.delete('/playtest/sessions/:sessionId', async (c) => {
  const denied = guardPermission(c, 'playtest:use');
  if (denied) return denied;

  const sessionId = c.req.param('sessionId');
  const ctx = c.get('ctx');
  const actor = c.get('actor');
  const actorUserId = actor?.userId ?? 'guest';

  const row = await findAuthorizedPlaytestSession(ctx, sessionId, actorUserId, actor?.role);
  if (!row) {
    return c.json(
      { error: { code: 'PLAYTEST_SESSION_NOT_FOUND', message: '试聊会话不存在' } },
      404,
    );
  }

  await ctx.db.delete(playtestSessions).where(eq(playtestSessions.id, sessionId));
  return c.json({ ok: true, id: sessionId });
});
