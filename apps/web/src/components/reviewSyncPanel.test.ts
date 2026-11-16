import { describe, expect, it } from 'vitest';
import type { NotificationChannelSettings } from '@rolecard/shared';
import { computeChannelFormValid } from './ReviewSyncPanel';

const baseSettings: NotificationChannelSettings = {
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

const maskedBase = {
  smtpHost: '',
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: '',
  smtpPassMasked: null,
  hasSmtpPass: false,
  smtpFrom: '',
  smtpTo: '',
  webhookUrl: '',
  secretMasked: null,
  hasSecret: false,
  telegramBotTokenMasked: null,
  hasTelegramBotToken: false,
  telegramChatId: '',
  telegramApiBaseUrl: 'https://api.telegram.org',
  barkServerUrl: 'https://api.day.app',
  barkDeviceKeyMasked: null,
  hasBarkDeviceKey: false,
  barkGroup: 'RoleCardStudio',
  serverChanSendKeyMasked: null,
  hasServerChanSendKey: false,
} as const;

describe('computeChannelFormValid', () => {
  it('rejects an empty channel name regardless of other fields', () => {
    expect(
      computeChannelFormValid('  ', 'webhook', { ...baseSettings, webhookUrl: 'https://x' }),
    ).toBe(false);
  });

  it('requires all SMTP fields', () => {
    const smtp = { ...baseSettings, smtpHost: 'smtp.qq.com' };
    expect(computeChannelFormValid('邮件', 'smtp', smtp)).toBe(false);
    expect(computeChannelFormValid('邮件', 'smtp', { ...smtp, smtpFrom: 'a@b.com' })).toBe(false);
    expect(computeChannelFormValid('邮件', 'smtp', { ...smtp, smtpTo: 'c@d.com' })).toBe(false);
    expect(
      computeChannelFormValid('邮件', 'smtp', {
        ...smtp,
        smtpFrom: 'a@b.com',
        smtpTo: 'c@d.com',
      }),
    ).toBe(true);
  });

  it.each(['feishu', 'wecom', 'dingtalk', 'discord', 'webhook'] as const)(
    'requires webhookUrl for %s',
    (type) => {
      expect(computeChannelFormValid('群', type, baseSettings)).toBe(false);
      expect(computeChannelFormValid('群', type, { ...baseSettings, webhookUrl: '' })).toBe(false);
      expect(
        computeChannelFormValid('群', type, {
          ...baseSettings,
          webhookUrl: 'https://hooks.example.com/x',
        }),
      ).toBe(true);
    },
  );

  it('requires telegram chat id and bot token', () => {
    expect(
      computeChannelFormValid('TG', 'telegram', {
        ...baseSettings,
        telegramBotToken: '123:abc',
      }),
    ).toBe(false);
    expect(
      computeChannelFormValid('TG', 'telegram', { ...baseSettings, telegramChatId: '-100123' }),
    ).toBe(false);
    expect(
      computeChannelFormValid('TG', 'telegram', {
        ...baseSettings,
        telegramBotToken: '123:abc',
        telegramChatId: '-100123',
      }),
    ).toBe(true);
  });

  it('accepts an edit that keeps the stored telegram bot token', () => {
    expect(
      computeChannelFormValid(
        'TG',
        'telegram',
        { ...baseSettings, telegramChatId: '-100123' },
        { ...maskedBase, hasTelegramBotToken: true, telegramBotTokenMasked: '123:****' },
      ),
    ).toBe(true);
  });

  it('requires bark server url and device key', () => {
    // 服务器地址有默认值，因此只填 Device Key 即为有效
    expect(
      computeChannelFormValid('Bark', 'bark', { ...baseSettings, barkDeviceKey: 'k' }),
    ).toBe(true);
    expect(
      computeChannelFormValid('Bark', 'bark', { ...baseSettings, barkServerUrl: '' }),
    ).toBe(false);
    expect(
      computeChannelFormValid('Bark', 'bark', {
        ...baseSettings,
        barkServerUrl: '',
        barkDeviceKey: 'k',
      }),
    ).toBe(false);
    expect(
      computeChannelFormValid('Bark', 'bark', {
        ...baseSettings,
        barkServerUrl: 'https://api.day.app',
        barkDeviceKey: 'k',
      }),
    ).toBe(true);
  });

  it('accepts an edit that keeps the stored bark device key', () => {
    expect(
      computeChannelFormValid('Bark', 'bark', baseSettings, {
        ...maskedBase,
        hasBarkDeviceKey: true,
        barkDeviceKeyMasked: 'ab****',
      }),
    ).toBe(true);
  });

  it('requires a serverchan send key', () => {
    expect(computeChannelFormValid('SC', 'serverchan', baseSettings)).toBe(false);
    expect(
      computeChannelFormValid('SC', 'serverchan', { ...baseSettings, serverChanSendKey: 'SCT123' }),
    ).toBe(true);
    expect(
      computeChannelFormValid('SC', 'serverchan', baseSettings, {
        ...maskedBase,
        hasServerChanSendKey: true,
        serverChanSendKeyMasked: 'SCT****',
      }),
    ).toBe(true);
  });
});
