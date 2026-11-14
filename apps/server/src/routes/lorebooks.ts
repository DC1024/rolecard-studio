import { randomUUID } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import {
  buildThirdPersonLorebookEntry,
  exportLorebookToSillyTavernJson,
} from '@rolecard/core';
import {
  CreateLorebookSchema,
  LinkCharacterToLorebookSchema,
  UpdateLorebookSchema,
  type LorebookCharacterLinkDto,
  type LorebookDto,
  type LorebookEntry,
  type RoleCardContent,
} from '@rolecard/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { getNow, type ServerContext } from '../context.js';
import { lorebookCharacterLinks, lorebooks, roleCards } from '../db/schema.js';
import { guardPermission, type AppEnv } from '../middleware/auth.js';

export const lorebookRoutes = new Hono<AppEnv>();

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export async function loadLinkedLorebooksForCard(
  ctx: ServerContext,
  cardId: string,
): Promise<(typeof lorebooks.$inferSelect)[]> {
  const links = await ctx.db
    .select({ lorebookId: lorebookCharacterLinks.lorebookId })
    .from(lorebookCharacterLinks)
    .where(eq(lorebookCharacterLinks.cardId, cardId));
  if (links.length === 0) return [];
  const ids = [...new Set(links.map((l) => l.lorebookId))];
  return ctx.db.select().from(lorebooks).where(inArray(lorebooks.id, ids));
}

async function hydrateLorebooks(
  ctx: ServerContext,
  rows: (typeof lorebooks.$inferSelect)[],
): Promise<LorebookDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const linkRows = await ctx.db
    .select()
    .from(lorebookCharacterLinks)
    .where(inArray(lorebookCharacterLinks.lorebookId, ids));

  const cardIds = [...new Set(linkRows.map((l) => l.cardId))];
  const cardRows =
    cardIds.length > 0
      ? await ctx.db
          .select({ id: roleCards.id, characterName: roleCards.characterName })
          .from(roleCards)
          .where(inArray(roleCards.id, cardIds))
      : [];
  const cardNameMap = new Map(cardRows.map((c) => [c.id, c.characterName]));

  const linksByBook = new Map<string, LorebookCharacterLinkDto[]>();
  for (const link of linkRows) {
    const list = linksByBook.get(link.lorebookId) ?? [];
    list.push({
      id: link.id,
      lorebookId: link.lorebookId,
      cardId: link.cardId,
      characterName: cardNameMap.get(link.cardId) ?? '未知角色',
      entryUid: link.entryUid,
      relationRole: link.relationRole,
      createdAt: link.createdAt,
    });
    linksByBook.set(link.lorebookId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    worldSummary: row.worldSummary,
    scanDepth: row.scanDepth,
    tokenBudget: row.tokenBudget,
    recursiveScanning: row.recursiveScanning,
    entries: parseJsonArray<LorebookEntry>(row.entriesJson),
    tags: parseJsonArray<string>(row.tagsJson),
    linkedCards: linksByBook.get(row.id) ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

lorebookRoutes.get('/lorebooks', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const ctx = c.get('ctx');
  const rows = await ctx.db.select().from(lorebooks).orderBy(desc(lorebooks.updatedAt));
  const items = await hydrateLorebooks(ctx, rows);
  return c.json({ items });
});

lorebookRoutes.post('/lorebooks', zValidator('json', CreateLorebookSchema), async (c) => {
  const denied = guardPermission(c, 'card:create');
  if (denied) return denied;

  const input = c.req.valid('json');
  const ctx = c.get('ctx');
  const nowIso = getNow(ctx).toISOString();
  const id = randomUUID();

  await ctx.db.insert(lorebooks).values({
    id,
    userId: c.get('actor')?.userId ?? 'guest',
    name: input.name,
    description: input.description,
    worldSummary: input.worldSummary,
    scanDepth: input.scanDepth,
    tokenBudget: input.tokenBudget,
    recursiveScanning: input.recursiveScanning,
    entriesJson: JSON.stringify(input.entries),
    tagsJson: JSON.stringify(input.tags),
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const rows = await ctx.db.select().from(lorebooks).where(eq(lorebooks.id, id)).limit(1);
  const [dto] = await hydrateLorebooks(ctx, rows);
  return c.json({ lorebook: dto }, 201);
});

lorebookRoutes.get('/lorebooks/:id', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const ctx = c.get('ctx');
  const rows = await ctx.db
    .select()
    .from(lorebooks)
    .where(eq(lorebooks.id, c.req.param('id')))
    .limit(1);
  if (rows.length === 0) {
    return c.json({ error: { code: 'LOREBOOK_NOT_FOUND', message: '世界书不存在' } }, 404);
  }
  const [dto] = await hydrateLorebooks(ctx, rows);
  return c.json({ lorebook: dto });
});

lorebookRoutes.put('/lorebooks/:id', zValidator('json', UpdateLorebookSchema), async (c) => {
  const denied = guardPermission(c, 'card:update');
  if (denied) return denied;

  const id = c.req.param('id');
  const input = c.req.valid('json');
  const ctx = c.get('ctx');

  const rows = await ctx.db.select().from(lorebooks).where(eq(lorebooks.id, id)).limit(1);
  const existing = rows[0];
  if (!existing) {
    return c.json({ error: { code: 'LOREBOOK_NOT_FOUND', message: '世界书不存在' } }, 404);
  }

  const nowIso = getNow(ctx).toISOString();
  await ctx.db
    .update(lorebooks)
    .set({
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      worldSummary: input.worldSummary ?? existing.worldSummary,
      scanDepth: input.scanDepth ?? existing.scanDepth,
      tokenBudget: input.tokenBudget ?? existing.tokenBudget,
      recursiveScanning: input.recursiveScanning ?? existing.recursiveScanning,
      entriesJson: input.entries ? JSON.stringify(input.entries) : existing.entriesJson,
      tagsJson: input.tags ? JSON.stringify(input.tags) : existing.tagsJson,
      updatedAt: nowIso,
    })
    .where(eq(lorebooks.id, id));

  const updated = await ctx.db.select().from(lorebooks).where(eq(lorebooks.id, id)).limit(1);
  const [dto] = await hydrateLorebooks(ctx, updated);
  return c.json({ lorebook: dto });
});

lorebookRoutes.delete('/lorebooks/:id', async (c) => {
  const denied = guardPermission(c, 'card:delete');
  if (denied) return denied;

  const id = c.req.param('id');
  const ctx = c.get('ctx');
  const existing = await ctx.db.select({ id: lorebooks.id }).from(lorebooks).where(eq(lorebooks.id, id)).limit(1);
  if (existing.length === 0) {
    return c.json({ error: { code: 'LOREBOOK_NOT_FOUND', message: '世界书不存在' } }, 404);
  }
  await ctx.db.delete(lorebooks).where(eq(lorebooks.id, id));
  return c.json({ ok: true, id });
});

lorebookRoutes.post(
  '/lorebooks/:id/link-card',
  zValidator('json', LinkCharacterToLorebookSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const lorebookId = c.req.param('id');
    const input = c.req.valid('json');
    const ctx = c.get('ctx');

    const [book] = await ctx.db
      .select()
      .from(lorebooks)
      .where(eq(lorebooks.id, lorebookId))
      .limit(1);
    if (!book) {
      return c.json({ error: { code: 'LOREBOOK_NOT_FOUND', message: '世界书不存在' } }, 404);
    }

    const [card] = await ctx.db
      .select()
      .from(roleCards)
      .where(eq(roleCards.id, input.cardId))
      .limit(1);
    if (!card) {
      return c.json({ error: { code: 'CARD_NOT_FOUND', message: '目标角色卡不存在' } }, 404);
    }

    const content = JSON.parse(card.contentJson) as RoleCardContent;
    const summaryEntry = buildThirdPersonLorebookEntry({
      cardId: card.id,
      content,
      workName: card.workName,
      relationRole: input.relationRole,
      customKeys: input.keys,
      constant: input.constant,
    });

    const entries = parseJsonArray<LorebookEntry>(book.entriesJson);
    const existingIdx = entries.findIndex((e) => e.uid === summaryEntry.uid);
    if (existingIdx >= 0) {
      entries[existingIdx] = summaryEntry;
    } else {
      entries.push(summaryEntry);
    }

    const nowIso = getNow(ctx).toISOString();
    await ctx.db
      .update(lorebooks)
      .set({
        entriesJson: JSON.stringify(entries),
        updatedAt: nowIso,
      })
      .where(eq(lorebooks.id, lorebookId));

    const existingLinks = await ctx.db
      .select()
      .from(lorebookCharacterLinks)
      .where(
        and(
          eq(lorebookCharacterLinks.lorebookId, lorebookId),
          eq(lorebookCharacterLinks.cardId, card.id),
        ),
      )
      .limit(1);

    if (existingLinks.length > 0) {
      await ctx.db
        .update(lorebookCharacterLinks)
        .set({ relationRole: input.relationRole, entryUid: summaryEntry.uid })
        .where(eq(lorebookCharacterLinks.id, existingLinks[0]!.id));
    } else {
      await ctx.db.insert(lorebookCharacterLinks).values({
        id: randomUUID(),
        lorebookId,
        cardId: card.id,
        entryUid: summaryEntry.uid,
        relationRole: input.relationRole,
        createdAt: nowIso,
      });
    }

    const refreshed = await ctx.db
      .select()
      .from(lorebooks)
      .where(eq(lorebooks.id, lorebookId))
      .limit(1);
    const [dto] = await hydrateLorebooks(ctx, refreshed);
    return c.json({ lorebook: dto, generatedEntry: summaryEntry });
  },
);

lorebookRoutes.delete('/lorebooks/:id/links/:cardId', async (c) => {
  const denied = guardPermission(c, 'card:update');
  if (denied) return denied;

  const lorebookId = c.req.param('id');
  const cardId = c.req.param('cardId');
  const ctx = c.get('ctx');

  const [book] = await ctx.db
    .select()
    .from(lorebooks)
    .where(eq(lorebooks.id, lorebookId))
    .limit(1);
  if (!book) {
    return c.json({ error: { code: 'LOREBOOK_NOT_FOUND', message: '世界书不存在' } }, 404);
  }

  await ctx.db
    .delete(lorebookCharacterLinks)
    .where(
      and(
        eq(lorebookCharacterLinks.lorebookId, lorebookId),
        eq(lorebookCharacterLinks.cardId, cardId),
      ),
    );

  const entries = parseJsonArray<LorebookEntry>(book.entriesJson).filter(
    (e) => e.uid !== `char_${cardId}`,
  );
  await ctx.db
    .update(lorebooks)
    .set({
      entriesJson: JSON.stringify(entries),
      updatedAt: getNow(ctx).toISOString(),
    })
    .where(eq(lorebooks.id, lorebookId));

  const refreshed = await ctx.db
    .select()
    .from(lorebooks)
    .where(eq(lorebooks.id, lorebookId))
    .limit(1);
  const [dto] = await hydrateLorebooks(ctx, refreshed);
  return c.json({ lorebook: dto });
});

lorebookRoutes.get('/lorebooks/:id/export', async (c) => {
  const denied = guardPermission(c, 'card:export');
  if (denied) return denied;

  const ctx = c.get('ctx');
  const [book] = await ctx.db
    .select()
    .from(lorebooks)
    .where(eq(lorebooks.id, c.req.param('id')))
    .limit(1);
  if (!book) {
    return c.json({ error: { code: 'LOREBOOK_NOT_FOUND', message: '世界书不存在' } }, 404);
  }

  const payload = exportLorebookToSillyTavernJson({
    name: book.name,
    description: book.description,
    worldSummary: book.worldSummary,
    scanDepth: book.scanDepth,
    tokenBudget: book.tokenBudget,
    recursiveScanning: book.recursiveScanning,
    entries: parseJsonArray<LorebookEntry>(book.entriesJson),
  });

  const safeName = book.name.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim() || 'lorebook';
  c.header('Content-Type', 'application/json; charset=utf-8');
  c.header(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}.worldinfo.json`)}`,
  );
  return c.body(JSON.stringify(payload, null, 2));
});
