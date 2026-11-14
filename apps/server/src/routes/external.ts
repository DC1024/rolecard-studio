import { zValidator } from '@hono/zod-validator';
import { hashToken } from '@rolecard/core';
import { GenerateCardRequestSchema } from '@rolecard/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { roleCards } from '../db/schema.js';
import { guardExternalApi, sendCoreError, type AppEnv } from '../middleware/auth.js';
import { executeAndPersistGeneration, serializeCardRow } from './cards.js';

export const externalRoutes = new Hono<AppEnv>();

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
