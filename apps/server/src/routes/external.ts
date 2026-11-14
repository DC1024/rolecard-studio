import { zValidator } from '@hono/zod-validator';
import { hashToken, mergeLorebooksToCharacterBook, toCharaCardV3 } from '@rolecard/core';
import { GenerateCardRequestSchema, type LorebookEntry, type RoleCardContent } from '@rolecard/shared';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { lorebooks, roleCards } from '../db/schema.js';
import { guardExternalApi, sendCoreError, type AppEnv } from '../middleware/auth.js';
import { executeAndPersistGeneration, serializeCardRow } from './cards.js';
import { loadLinkedLorebooksForCard } from './lorebooks.js';

export const externalRoutes = new Hono<AppEnv>();

externalRoutes.get('/external/cards', async (c) => {
  const denied = await guardExternalApi(c, 'cards:read');
  if (denied) return denied;

  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const rows = await c.get('ctx').db.select().from(roleCards).orderBy(desc(roleCards.updatedAt));
  const serialized = rows.map(serializeCardRow).filter((card) => {
    if (!q) return true;
    return (
      card.characterName.toLowerCase().includes(q) ||
      card.workName.toLowerCase().includes(q) ||
      card.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  return c.json({ items: serialized.slice(0, 50), total: serialized.length });
});

externalRoutes.get('/external/cards/:id', async (c) => {
  const denied = await guardExternalApi(c, 'cards:read');
  if (denied) return denied;

  const id = c.req.param('id');
  const rows = await c.get('ctx').db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const card = serializeCardRow(row);
  const etag = `"${hashToken(`${card.id}:${card.version}:${card.updatedAt}`).slice(0, 16)}"`;
  c.header('ETag', etag);

  return c.json({
    card,
    version: card.version,
    etag,
  });
});

externalRoutes.get('/external/cards/:id/ccv3', async (c) => {
  const denied = await guardExternalApi(c, 'cards:read');
  if (denied) return denied;

  const id = c.req.param('id');
  const ctx = c.get('ctx');
  const rows = await ctx.db.select().from(roleCards).where(eq(roleCards.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: { code: 'CARD_NOT_FOUND', message: '角色卡不存在' } }, 404);
  }

  const content = JSON.parse(row.contentJson) as RoleCardContent;
  const linkedBooks = await loadLinkedLorebooksForCard(ctx, id);
  const characterBook = mergeLorebooksToCharacterBook(
    linkedBooks.map((lb) => ({
      name: lb.name,
      description: lb.description,
      scanDepth: lb.scanDepth,
      tokenBudget: lb.tokenBudget,
      recursiveScanning: lb.recursiveScanning,
      entries: JSON.parse(lb.entriesJson) as LorebookEntry[],
    })),
  );

  return c.json(toCharaCardV3(content, { version: row.version, characterBook }));
});

externalRoutes.get('/external/lorebooks', async (c) => {
  const denied = await guardExternalApi(c, 'cards:read');
  if (denied) return denied;

  const rows = await c.get('ctx').db.select().from(lorebooks).orderBy(desc(lorebooks.updatedAt));
  return c.json({
    items: rows.map((lb) => ({
      id: lb.id,
      name: lb.name,
      description: lb.description,
      worldSummary: lb.worldSummary,
      scanDepth: lb.scanDepth,
      tokenBudget: lb.tokenBudget,
      entries: JSON.parse(lb.entriesJson) as LorebookEntry[],
      updatedAt: lb.updatedAt,
    })),
  });
});

externalRoutes.post(
  '/external/generate',
  zValidator('json', GenerateCardRequestSchema),
  async (c) => {
    const denied = await guardExternalApi(c, 'cards:write');
    if (denied) return denied;

    const input = c.req.valid('json');
    const result = await executeAndPersistGeneration(c.get('ctx'), 'external_api', input);

    if (!result.ok) {
      return sendCoreError(c, {
        code: result.code,
        message: result.message,
        status: result.status,
      });
    }

    return c.json({ card: result.card }, 201 as ContentfulStatusCode);
  },
);
