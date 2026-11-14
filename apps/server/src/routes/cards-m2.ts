import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { zValidator } from '@hono/zod-validator';
import {
  detectImageMagicBytes,
  parseImportedCardPayload,
} from '@rolecard/core';
import { estimateCardTokens, ImportCardRequestSchema } from '@rolecard/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getNow } from '../context.js';
import { lorebookCharacterLinks, lorebooks, roleCards } from '../db/schema.js';
import { guardPermission, sendCoreError, type AppEnv } from '../middleware/auth.js';
import { serializeCardRow } from './cards.js';

export const cardM2Routes = new Hono<AppEnv>();

cardM2Routes.post('/cards/import', zValidator('json', ImportCardRequestSchema), async (c) => {
  const denied = guardPermission(c, 'card:create');
  if (denied) return denied;

  const input = c.req.valid('json');
  const parsed = parseImportedCardPayload(input);
  if (!parsed.ok) {
    return sendCoreError(c, parsed.error);
  }

  const ctx = c.get('ctx');
  const nowIso = getNow(ctx).toISOString();
  const cardId = randomUUID();
  const actorUserId = c.get('actor')?.userId ?? 'guest';

  let imageUrl: string | null = null;
  if (parsed.value.portraitPngBase64) {
    const buf = Buffer.from(parsed.value.portraitPngBase64, 'base64');
    if (detectImageMagicBytes(buf) === 'png') {
      const fileName = `${cardId}-imported.png`;
      if (ctx.dataDir === ':memory:') {
        if (!ctx.memoryUploads) ctx.memoryUploads = new Map();
        ctx.memoryUploads.set(fileName, { data: buf, contentType: 'image/png' });
      } else {
        const uploadsDir = resolve(ctx.dataDir, 'uploads');
        await mkdir(uploadsDir, { recursive: true });
        await writeFile(resolve(uploadsDir, fileName), buf);
      }
      imageUrl = `/uploads/${fileName}`;
    }
  }

  const content = parsed.value.content;
  const tokenCount = estimateCardTokens(content);

  await ctx.db.insert(roleCards).values({
    id: cardId,
    userId: actorUserId,
    parentCardId: null,
    version: 1,
    publishStatus: 'published',
    entityType: 'fictional',
    characterName: content.name,
    workName: '',
    tagsJson: JSON.stringify(content.tags),
    cardType: input.targetCardType,
    mode: 'A',
    referenceInfo: `由旧版角色卡 (${parsed.value.sourceSpec}) 导入升级`,
    contentJson: JSON.stringify(content),
    sourcesJson: JSON.stringify([
      {
        title: `导入文件：${input.filename}`,
        snippet: `自动规范化并升级自 ${parsed.value.sourceSpec}`,
        origin: 'user_provided',
        provider: 'card-import',
      },
    ]),
    tokenCount,
    imageUrl,
    imageSource: imageUrl ? 'upload' : null,
    diffSummary: `从 ${parsed.value.sourceSpec} 导入升级至 CCV3`,
    scheduleEnabled: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  let createdLorebookId: string | null = null;
  if (input.importEmbeddedLorebook && parsed.value.embeddedBook && parsed.value.embeddedBook.entries.length > 0) {
    createdLorebookId = randomUUID();
    const book = parsed.value.embeddedBook;
    await ctx.db.insert(lorebooks).values({
      id: createdLorebookId,
      userId: actorUserId,
      name: book.name || `${content.name} 随卡世界书`,
      description: book.description || `从 ${input.filename} 随卡导入的世界观词条`,
      worldSummary: '',
      scanDepth: book.scan_depth,
      tokenBudget: book.token_budget,
      recursiveScanning: book.recursive_scanning,
      entriesJson: JSON.stringify(book.entries),
      tagsJson: JSON.stringify(content.tags.slice(0, 5)),
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await ctx.db.insert(lorebookCharacterLinks).values({
      id: randomUUID(),
      lorebookId: createdLorebookId,
      cardId,
      entryUid: book.entries[0]!.uid,
      relationRole: '随卡导入世界书',
      createdAt: nowIso,
    });
  }

  const [createdRow] = await ctx.db
    .select()
    .from(roleCards)
    .where(eq(roleCards.id, cardId))
    .limit(1);

  return c.json(
    {
      card: serializeCardRow(createdRow!),
      upgradedFrom: parsed.value.sourceSpec,
      importedLorebookId: createdLorebookId,
    },
    201,
  );
});
