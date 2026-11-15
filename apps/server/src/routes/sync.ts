import { randomUUID } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import {
  buildNotificationMessage,
  decryptSecret,
  deliverNotificationToChannel,
  deliverWebhookWithRetry,
  encryptSecret,
  generateRandomToken,
  isFakeIpAllowedByFetch,
  isUrlProxiedByFetch,
  maskSecret,
  validateNotificationChannelSettings,
  validatePublicUrl,
} from '@rolecard/core';
import {
  CreateSyncSubscriptionSchema,
  type NotificationChannelDto,
  type NotificationChannelSettings,
  type SyncEventDto,
  type SyncEventType,
  type SyncSubscriptionDto,
  UpsertNotificationChannelSchema,
} from '@rolecard/shared';
import { desc, eq, gt } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getNow, type ServerContext } from '../context.js';
import { notificationChannels, syncEvents, syncSubscriptions } from '../db/schema.js';
import {
  guardExternalApi,
  guardPermission,
  sendCoreError,
  type AppEnv,
} from '../middleware/auth.js';
import { loadScopedFetch } from './config.js';

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

  // Fire-and-forget webhook & equal-priority multi-channel notifications
  void dispatchWebhooksForEvent(ctx, dto);
  void dispatchNotificationChannelsForEvent(ctx, dto);

  return dto;
}

function parseChannelSettings(rawJson: string): NotificationChannelSettings {
  try {
    const parsed = JSON.parse(rawJson) as Partial<NotificationChannelSettings>;
    return {
      smtpHost: parsed.smtpHost ?? '',
      smtpPort: typeof parsed.smtpPort === 'number' ? parsed.smtpPort : 465,
      smtpSecure: parsed.smtpSecure ?? true,
      smtpUser: parsed.smtpUser ?? '',
      smtpPass: parsed.smtpPass ?? '',
      smtpFrom: parsed.smtpFrom ?? '',
      smtpTo: parsed.smtpTo ?? '',
      webhookUrl: parsed.webhookUrl ?? '',
      secret: parsed.secret ?? '',
      telegramBotToken: parsed.telegramBotToken ?? '',
      telegramChatId: parsed.telegramChatId ?? '',
      telegramApiBaseUrl: parsed.telegramApiBaseUrl ?? 'https://api.telegram.org',
      barkServerUrl: parsed.barkServerUrl ?? 'https://api.day.app',
      barkDeviceKey: parsed.barkDeviceKey ?? '',
      barkGroup: parsed.barkGroup ?? 'RoleCardStudio',
      serverChanSendKey: parsed.serverChanSendKey ?? '',
    };
  } catch {
    return {
      smtpHost: '',
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: '',
      smtpPass: '',
      smtpFrom: '',
      smtpTo: '',
      webhookUrl: '',
      secret: '',
      telegramBotToken: '',
      telegramChatId: '',
      telegramApiBaseUrl: 'https://api.telegram.org',
      barkServerUrl: 'https://api.day.app',
      barkDeviceKey: '',
      barkGroup: 'RoleCardStudio',
      serverChanSendKey: '',
    };
  }
}

function toNotificationChannelDto(
  row: typeof notificationChannels.$inferSelect,
  masterKey: Buffer,
): NotificationChannelDto {
  const settings = parseChannelSettings(decryptSecret(row.configEncrypted, masterKey));
  return {
    id: row.id,
    name: row.name,
    channelType: row.channelType,
    enabled: row.enabled,
    events: parseEventsJson(row.eventsJson),
    settingsMasked: {
      smtpHost: settings.smtpHost,
      smtpPort: settings.smtpPort,
      smtpSecure: settings.smtpSecure,
      smtpUser: settings.smtpUser,
      smtpPassMasked: maskSecret(settings.smtpPass),
      hasSmtpPass: Boolean(settings.smtpPass),
      smtpFrom: settings.smtpFrom,
      smtpTo: settings.smtpTo,
      webhookUrl: settings.webhookUrl,
      secretMasked: maskSecret(settings.secret),
      hasSecret: Boolean(settings.secret),
      telegramBotTokenMasked: maskSecret(settings.telegramBotToken),
      hasTelegramBotToken: Boolean(settings.telegramBotToken),
      telegramChatId: settings.telegramChatId,
      telegramApiBaseUrl: settings.telegramApiBaseUrl,
      barkServerUrl: settings.barkServerUrl,
      barkDeviceKeyMasked: maskSecret(settings.barkDeviceKey),
      hasBarkDeviceKey: Boolean(settings.barkDeviceKey),
      barkGroup: settings.barkGroup,
      serverChanSendKeyMasked: maskSecret(settings.serverChanSendKey),
      hasServerChanSendKey: Boolean(settings.serverChanSendKey),
    },
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    lastSentAt: row.lastSentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function dispatchNotificationChannelsForEvent(
  ctx: ServerContext,
  event: SyncEventDto,
): Promise<void> {
  const rows = await ctx.db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.enabled, true));

  const matching = rows.filter((row) => parseEventsJson(row.eventsJson).includes(event.eventType));
  if (matching.length === 0) return;

  const message = buildNotificationMessage(event);
  const webhookFetch = await loadScopedFetch(ctx, 'webhook');
  await Promise.allSettled(
    matching.map(async (row) => {
      const settings = parseChannelSettings(decryptSecret(row.configEncrypted, ctx.masterKey));
      const res = await deliverNotificationToChannel(
        {
          id: row.id,
          name: row.name,
          channelType: row.channelType,
          settings,
        },
        message,
        {
          fetchImpl: webhookFetch,
          dnsLookup: ctx.dnsLookup,
          smtpTransport: ctx.smtpTransport,
        },
      );
      const nowIso = getNow(ctx).toISOString();
      await ctx.db
        .update(notificationChannels)
        .set({
          lastStatus: res.ok ? 'success' : 'error',
          lastError: res.ok ? null : res.error.message,
          lastSentAt: nowIso,
          updatedAt: nowIso,
        })
        .where(eq(notificationChannels.id, row.id));
    }),
  );
}

export async function dispatchWebhooksForEvent(
  ctx: ServerContext,
  event: SyncEventDto,
): Promise<void> {
  const subs = await ctx.db
    .select()
    .from(syncSubscriptions)
    .where(eq(syncSubscriptions.isActive, true));

  if (subs.length === 0) return;
  const webhookFetch = await loadScopedFetch(ctx, 'webhook');

  for (const sub of subs) {
    const subscribedEvents = parseEventsJson(sub.eventsJson);
    if (!subscribedEvents.includes(event.eventType)) {
      continue;
    }
    const secret = decryptSecret(sub.secretEncrypted, ctx.masterKey);
    const result = await deliverWebhookWithRetry(sub.webhookUrl, secret, event, {
      fetchImpl: webhookFetch,
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

    const webhookFetch = await loadScopedFetch(ctx, 'webhook');
    const urlCheck = await validatePublicUrl(input.webhookUrl, ctx.dnsLookup, {
      viaProxy: isUrlProxiedByFetch(webhookFetch, input.webhookUrl),
      allowFakeIp: isFakeIpAllowedByFetch(webhookFetch),
    });
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

syncRoutes.get('/notifications/channels', async (c) => {
  const denied = guardPermission(c, 'card:read');
  if (denied) return denied;

  const ctx = c.get('ctx');
  const rows = await ctx.db
    .select()
    .from(notificationChannels)
    .orderBy(desc(notificationChannels.createdAt));

  return c.json({
    items: rows.map((row) => toNotificationChannelDto(row, ctx.masterKey)),
  });
});

syncRoutes.post(
  '/notifications/channels',
  zValidator('json', UpsertNotificationChannelSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const input = c.req.valid('json');
    const ctx = c.get('ctx');
    const webhookFetch = await loadScopedFetch(ctx, 'webhook');
    const check = await validateNotificationChannelSettings(
      input.channelType,
      input.settings,
      ctx.dnsLookup,
      webhookFetch,
    );
    if (!check.ok) {
      return sendCoreError(c, check.error);
    }

    const id = randomUUID();
    const nowIso = getNow(ctx).toISOString();
    await ctx.db.insert(notificationChannels).values({
      id,
      name: input.name,
      channelType: input.channelType,
      enabled: input.enabled,
      eventsJson: JSON.stringify(input.events),
      configEncrypted: encryptSecret(JSON.stringify(input.settings), ctx.masterKey),
      lastStatus: null,
      lastError: null,
      lastSentAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const [created] = await ctx.db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, id))
      .limit(1);

    return c.json(
      { channel: toNotificationChannelDto(created!, ctx.masterKey) },
      201 as ContentfulStatusCode,
    );
  },
);

syncRoutes.put(
  '/notifications/channels/:id',
  zValidator('json', UpsertNotificationChannelSchema),
  async (c) => {
    const denied = guardPermission(c, 'card:update');
    if (denied) return denied;

    const id = c.req.param('id');
    const input = c.req.valid('json');
    const ctx = c.get('ctx');

    const [existing] = await ctx.db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, id))
      .limit(1);
    if (!existing) {
      return c.json({ error: { code: 'CHANNEL_NOT_FOUND', message: '通知渠道不存在' } }, 404);
    }

    const oldSettings = parseChannelSettings(decryptSecret(existing.configEncrypted, ctx.masterKey));
    const mergedSettings: NotificationChannelSettings = {
      ...input.settings,
      smtpPass: input.settings.smtpPass?.trim() ? input.settings.smtpPass : oldSettings.smtpPass,
      secret: input.settings.secret?.trim() ? input.settings.secret : oldSettings.secret,
      telegramBotToken: input.settings.telegramBotToken?.trim()
        ? input.settings.telegramBotToken
        : oldSettings.telegramBotToken,
      barkDeviceKey: input.settings.barkDeviceKey?.trim()
        ? input.settings.barkDeviceKey
        : oldSettings.barkDeviceKey,
      serverChanSendKey: input.settings.serverChanSendKey?.trim()
        ? input.settings.serverChanSendKey
        : oldSettings.serverChanSendKey,
    };

    const webhookFetch = await loadScopedFetch(ctx, 'webhook');
    const check = await validateNotificationChannelSettings(
      input.channelType,
      mergedSettings,
      ctx.dnsLookup,
      webhookFetch,
    );
    if (!check.ok) {
      return sendCoreError(c, check.error);
    }

    const nowIso = getNow(ctx).toISOString();
    await ctx.db
      .update(notificationChannels)
      .set({
        name: input.name,
        channelType: input.channelType,
        enabled: input.enabled,
        eventsJson: JSON.stringify(input.events),
        configEncrypted: encryptSecret(JSON.stringify(mergedSettings), ctx.masterKey),
        updatedAt: nowIso,
      })
      .where(eq(notificationChannels.id, id));

    const [updated] = await ctx.db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.id, id))
      .limit(1);

    return c.json({ channel: toNotificationChannelDto(updated!, ctx.masterKey) });
  },
);

syncRoutes.post('/notifications/channels/:id/test', async (c) => {
  const denied = guardPermission(c, 'card:update');
  if (denied) return denied;

  const id = c.req.param('id');
  const ctx = c.get('ctx');
  const [row] = await ctx.db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.id, id))
    .limit(1);
  if (!row) {
    return c.json({ error: { code: 'CHANNEL_NOT_FOUND', message: '通知渠道不存在' } }, 404);
  }

  const settings = parseChannelSettings(decryptSecret(row.configEncrypted, ctx.masterKey));
  const nowIso = getNow(ctx).toISOString();
  const sampleEvent: SyncEventDto = {
    cursor: 0,
    id: `test-${randomUUID()}`,
    eventType: 'review.pending',
    targetType: 'card',
    targetId: 'sample-card-id',
    version: 1,
    payload: {
      reviewType: 'impression',
      characterName: '测试角色',
      diffSummary: '这是一条来自 RoleCard Studio 通知渠道连通性测试的模拟审核通知。',
    },
    createdAt: nowIso,
  };

  const webhookFetch = await loadScopedFetch(ctx, 'webhook');
  const res = await deliverNotificationToChannel(
    {
      id: row.id,
      name: row.name,
      channelType: row.channelType,
      settings,
    },
    buildNotificationMessage(sampleEvent),
    {
      fetchImpl: webhookFetch,
      dnsLookup: ctx.dnsLookup,
      smtpTransport: ctx.smtpTransport,
    },
  );

  await ctx.db
    .update(notificationChannels)
    .set({
      lastStatus: res.ok ? 'success' : 'error',
      lastError: res.ok ? null : res.error.message,
      lastSentAt: nowIso,
      updatedAt: nowIso,
    })
    .where(eq(notificationChannels.id, id));

  if (!res.ok) {
    return sendCoreError(c, res.error);
  }

  return c.json({ ok: true, message: res.value.detail });
});

syncRoutes.delete('/notifications/channels/:id', async (c) => {
  const denied = guardPermission(c, 'card:delete');
  if (denied) return denied;

  const id = c.req.param('id');
  await c.get('ctx').db.delete(notificationChannels).where(eq(notificationChannels.id, id));
  return c.json({ ok: true });
});
