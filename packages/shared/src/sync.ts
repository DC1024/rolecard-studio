import { z } from 'zod';

export const SyncEventTypeSchema = z.enum([
  'card.updated',
  'card.evolved',
  'lorebook.updated',
  'ripple.approved',
  'review.pending',
]);
export type SyncEventType = z.infer<typeof SyncEventTypeSchema>;

export const CreateSyncSubscriptionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  webhookUrl: z.string().url().max(1024),
  events: z.array(SyncEventTypeSchema).min(1).default(['card.updated', 'card.evolved']),
});
export type CreateSyncSubscriptionRequest = z.infer<typeof CreateSyncSubscriptionSchema>;

export interface SyncSubscriptionDto {
  id: string;
  name: string;
  webhookUrl: string;
  events: SyncEventType[];
  secretMasked: string;
  isActive: boolean;
  lastCursor: number;
  createdAt: string;
  updatedAt: string;
}

export interface SyncEventDto {
  cursor: number;
  id: string;
  eventType: SyncEventType;
  targetType: 'card' | 'lorebook';
  targetId: string;
  version: number;
  payload: Record<string, unknown>;
  createdAt: string;
}

export const NotificationChannelTypeSchema = z.enum([
  'smtp',
  'feishu',
  'wecom',
  'dingtalk',
  'telegram',
  'discord',
  'bark',
  'serverchan',
  'webhook',
]);
export type NotificationChannelType = z.infer<typeof NotificationChannelTypeSchema>;

export const NotificationChannelSettingsSchema = z.object({
  // SMTP
  smtpHost: z.string().trim().max(255).optional().default(''),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional().default(465),
  smtpSecure: z.boolean().optional().default(true),
  smtpUser: z.string().trim().max(255).optional().default(''),
  smtpPass: z.string().max(512).optional().default(''),
  smtpFrom: z.string().trim().max(255).optional().default(''),
  smtpTo: z.string().trim().max(1000).optional().default(''),
  // Webhook-based bots (feishu / wecom / dingtalk / discord / webhook)
  webhookUrl: z.string().trim().max(1024).optional().default(''),
  secret: z.string().max(512).optional().default(''),
  // Telegram
  telegramBotToken: z.string().trim().max(512).optional().default(''),
  telegramChatId: z.string().trim().max(128).optional().default(''),
  telegramApiBaseUrl: z.string().trim().max(512).optional().default('https://api.telegram.org'),
  // Bark
  barkServerUrl: z.string().trim().max(512).optional().default('https://api.day.app'),
  barkDeviceKey: z.string().trim().max(512).optional().default(''),
  barkGroup: z.string().trim().max(64).optional().default('RoleCardStudio'),
  // ServerChan
  serverChanSendKey: z.string().trim().max(512).optional().default(''),
});
export type NotificationChannelSettings = z.infer<typeof NotificationChannelSettingsSchema>;

export const UpsertNotificationChannelSchema = z.object({
  name: z.string().trim().min(1, '渠道名称不能为空').max(80),
  channelType: NotificationChannelTypeSchema,
  enabled: z.boolean().default(true),
  events: z
    .array(SyncEventTypeSchema)
    .min(1)
    .default(['review.pending', 'card.evolved']),
  settings: NotificationChannelSettingsSchema,
});
export type UpsertNotificationChannelRequest = z.infer<typeof UpsertNotificationChannelSchema>;

export interface NotificationChannelDto {
  id: string;
  name: string;
  channelType: NotificationChannelType;
  enabled: boolean;
  events: SyncEventType[];
  settingsMasked: {
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    smtpPassMasked: string | null;
    hasSmtpPass: boolean;
    smtpFrom: string;
    smtpTo: string;
    webhookUrl: string;
    secretMasked: string | null;
    hasSecret: boolean;
    telegramBotTokenMasked: string | null;
    hasTelegramBotToken: boolean;
    telegramChatId: string;
    telegramApiBaseUrl: string;
    barkServerUrl: string;
    barkDeviceKeyMasked: string | null;
    hasBarkDeviceKey: boolean;
    barkGroup: string;
    serverChanSendKeyMasked: string | null;
    hasServerChanSendKey: boolean;
  };
  lastStatus: 'success' | 'error' | null;
  lastError: string | null;
  lastSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}
