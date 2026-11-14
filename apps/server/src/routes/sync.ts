import { randomUUID } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import {
  decryptSecret,
  deliverWebhookWithRetry,
  encryptSecret,
  generateRandomToken,
  maskSecret,
  validatePublicUrl,
} from '@rolecard/core';
import {
  CreateSyncSubscriptionSchema,
  type SyncEventDto,
  type SyncEventType,
  type SyncSubscriptionDto,
} from '@rolecard/shared';
import { desc, eq, gt } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getNow, type ServerContext } from '../context.js';
import { syncEvents, syncSubscriptions } from '../db/schema.js';
import {
  guardExternalApi,
  guardPermission,
  sendCoreError,
  type AppEnv,
} from '../middleware/auth.js';

export const syncRoutes = new Hono<AppEnv>();

type SyncListener = (event: SyncEventDto) => void;
const listenersByDb = new WeakMap<object, Set<SyncListener>>();

function getListeners(ctx: ServerContext): Set<SyncListener> {
  let set = listenersByDb.get(ctx.db);
  if (!set) {
    set = new Set<SyncListener>();
    listenersByDb.set(ctx.db, set);
  }
  return set;
}

function parseEventsJson(raw: string): SyncEventType[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is SyncEventType => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

export async function publishSyncEvent(
  ctx: ServerContext,
  input: {
    eventType: SyncEventType;
    targetType: 'card' | 'lorebook';
    targetId: string;
    version: number;
    payload: Record<string, unknown>;
  },
): Promise<SyncEventDto> {
  const id = randomUUID();
  const createdAt = getNow(ctx).toISOString();

  await ctx.db.insert(syncEvents).values({
    id,
    eventType: input.eventType,
    targetType: input.targetType,
    targetId: input.targetId,
    version: input.version,
    payloadJson: JSON.stringify(input.payload),
    createdAt,
  });

  const rows = await ctx.db
    .select()
    .from(syncEvents)
    .where(eq(syncEvents.id, id))
    .limit(1);
  const inserted = rows[0];
  const dto: SyncEventDto = {
    cursor: inserted?.cursor ?? 0,
    id,
    eventType: input.eventType,
    targetType: input.targetType,
    targetId: input.targetId,
    version: input.version,
    payload: input.payload,
    createdAt,
  };

  for (const listener of getListeners(ctx)) {
    try {
      listener(dto);
    } catch {
      // ignore closed stream listeners
    }
  }

  // Fire-and-forget webhook delivery for matching active subscriptions
  void dispatchWebhooksForEvent(ctx, dto);

  return dto;
}

export async function dispatchWebhooksForEvent(
  ctx: ServerContext,
  event: SyncEventDto,
): Promise<void> {
  const subs = await ctx.db
    .select()
    .from(syncSubscriptions)
    .where(eq(syncSubscriptions.isActive, true));

  for (const sub of subs) {
    const subscribedEvents = parseEventsJson(sub.eventsJson);
    if (!subscribedEvents.includes(event.eventType)) {
      continue;
    }
    const secret = decryptSecret(sub.secretEncrypted, ctx.masterKey);
    const result = await deliverWebhookWithRetry(sub.webhookUrl, secret, event, {
      fetchImpl: ctx.fetchImpl,
      dnsLookup: ctx.dnsLookup,
      maxAttempts: 2,
      baseDelayMs: 50,
    });
    if (result.ok) {
      await ctx.db
        .update(syncSubscriptions)
        .set({ lastCursor: event.cursor, updatedAt: getNow(ctx).toISOString() })
        .where(eq(syncSubscriptions.id, sub.id));
    }
  }
}

async function querySyncEvents(
  ctx: ServerContext,
  sinceCursor: number,
  limit: number,
): Promise<SyncEventDto[]> {
  const rows = await ctx.db
    .select()
    .from(syncEvents)
    .where(gt(syncEvents.cursor, sinceCursor))
    .limit(limit);

  return rows.map((r) => ({
    cursor: r.cursor,
    id: r.id,
    eventType: r.eventType,
    targetType: r.targetType,
    targetId: r.targetId,
    version: r.version,
    payload: JSON.parse(r.payloadJson) as Record<string, unknown>,
    createdAt: r.createdAt,
  }));
}

syncRoutes.get('/sync/events', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const sinceCursor = Math.max(0, Number.parseInt(c.req.query('since_cursor') ?? '0', 10) || 0);
  const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query('limit') ?? '50', 10) || 50));
  const items = await querySyncEvents(c.get('ctx'), sinceCursor, limit);
  const nextCursor = items.length > 0 ? (items[items.length - 1]?.cursor ?? sinceCursor) : sinceCursor;
  return c.json({ items, nextCursor });
});

syncRoutes.get('/external/sync/events', async (c) => {
  const denied = await guardExternalApi(c, 'cards:read');
  if (denied) return denied;

  const sinceCursor = Math.max(0, Number.parseInt(c.req.query('since_cursor') ?? '0', 10) || 0);
  const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query('limit') ?? '50', 10) || 50));
  const items = await querySyncEvents(c.get('ctx'), sinceCursor, limit);
  const nextCursor = items.length > 0 ? (items[items.length - 1]?.cursor ?? sinceCursor) : sinceCursor;
  return c.json({ items, nextCursor });
});

syncRoutes.get('/sync/stream', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const ctx = c.get('ctx');
  const sinceCursor = Math.max(0, Number.parseInt(c.req.query('since_cursor') ?? '0', 10) || 0);

  return streamSSE(c, async (stream) => {
    const replay = await querySyncEvents(ctx, sinceCursor, 50);
    for (const evt of replay) {
      await stream.writeSSE({
        id: String(evt.cursor),
        event: evt.eventType,
        data: JSON.stringify(evt),
      });
    }

    const listener: SyncListener = (evt) => {
      void stream.writeSSE({
        id: String(evt.cursor),
        event: evt.eventType,
        data: JSON.stringify(evt),
      });
    };

    const listeners = getListeners(ctx);
    listeners.add(listener);

    const heartbeat = setInterval(() => {
      void stream.writeSSE({
        event: 'ping',
        data: JSON.stringify({ ts: new Date().toISOString() }),
      });
    }, 25_000);

    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(heartbeat);
        listeners.delete(listener);
        resolve();
      });
    });
  });
});

syncRoutes.get('/external/sync/stream', async (c) => {
  const denied = await guardExternalApi(c, 'cards:read');
  if (denied) return denied;

  const ctx = c.get('ctx');
  const sinceCursor = Math.max(0, Number.parseInt(c.req.query('since_cursor') ?? '0', 10) || 0);

  return streamSSE(c, async (stream) => {
    const replay = await querySyncEvents(ctx, sinceCursor, 50);
    for (const evt of replay) {
      await stream.writeSSE({
        id: String(evt.cursor),
        event: evt.eventType,
        data: JSON.stringify(evt),
      });
    }

    const listener: SyncListener = (evt) => {
      void stream.writeSSE({
        id: String(evt.cursor),
        event: evt.eventType,
        data: JSON.stringify(evt),
      });
    };

    const listeners = getListeners(ctx);
    listeners.add(listener);

    const heartbeat = setInterval(() => {
      void stream.writeSSE({
        event: 'ping',
        data: JSON.stringify({ ts: new Date().toISOString() }),
      });
    }, 25_000);

    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(heartbeat);
        listeners.delete(listener);
        resolve();
      });
    });
  });
});

syncRoutes.get('/sync/subscriptions', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const ctx = c.get('ctx');
  const rows = await ctx.db
    .select()
    .from(syncSubscriptions)
    .orderBy(desc(syncSubscriptions.createdAt));

  const items: SyncSubscriptionDto[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    webhookUrl: row.webhookUrl,
    events: parseEventsJson(row.eventsJson),
    secretMasked: maskSecret(decryptSecret(row.secretEncrypted, ctx.masterKey)) ?? '****',
    isActive: row.isActive,
    lastCursor: row.lastCursor,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  return c.json({ items });
});

syncRoutes.post(
  '/sync/subscriptions',
  zValidator('json', CreateSyncSubscriptionSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const input = c.req.valid('json');
    const ctx = c.get('ctx');

    const urlCheck = await validatePublicUrl(input.webhookUrl, ctx.dnsLookup);
    if (!urlCheck.ok) {
      return sendCoreError(c, urlCheck.error);
    }

    const id = randomUUID();
    const rawSecret = `whsec_${generateRandomToken(20)}`;
    const nowIso = getNow(ctx).toISOString();

    await ctx.db.insert(syncSubscriptions).values({
      id,
      name: input.name,
      webhookUrl: urlCheck.value.toString(),
      secretEncrypted: encryptSecret(rawSecret, ctx.masterKey),
      eventsJson: JSON.stringify(input.events),
      isActive: true,
      lastCursor: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const subscription: SyncSubscriptionDto = {
      id,
      name: input.name,
      webhookUrl: urlCheck.value.toString(),
      events: input.events,
      secretMasked: maskSecret(rawSecret) ?? '****',
      isActive: true,
      lastCursor: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    return c.json(
      { subscription, secret: rawSecret },
      201 as ContentfulStatusCode,
    );
  },
);

syncRoutes.delete('/sync/subscriptions/:id', async (c) => {
  const denied = guardPermission(c, 'card:delete');
  if (denied) return denied;

  const id = c.req.param('id');
  await c.get('ctx').db.delete(syncSubscriptions).where(eq(syncSubscriptions.id, id));
  return c.json({ ok: true });
});
