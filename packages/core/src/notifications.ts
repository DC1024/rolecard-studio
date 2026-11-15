import { createHmac } from 'node:crypto';
import * as net from 'node:net';
import * as tls from 'node:tls';
import type {
  NotificationChannelSettings,
  NotificationChannelType,
  SyncEventDto,
} from '@rolecard/shared';
import {
  defaultDnsLookup,
  defaultHttpFetch,
  isFakeIpAllowedByFetch,
  isUrlProxiedByFetch,
  validatePublicUrl,
} from './ssrf.js';
import { deliverWebhookWithRetry } from './sync.js';
import {
  type CoreError,
  type DnsLookupPort,
  type HttpFetchPort,
  type Result,
  err,
  ok,
} from './types.js';

export interface SmtpSendInput {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
  to: string[];
  subject: string;
  bodyText: string;
}

export type SmtpTransportPort = (input: SmtpSendInput) => Promise<void>;

export interface NotificationDeliveryDeps {
  fetchImpl?: HttpFetchPort;
  dnsLookup?: DnsLookupPort;
  smtpTransport?: SmtpTransportPort;
}

export interface NotificationMessage {
  title: string;
  bodyText: string;
  event: SyncEventDto;
}

function encodeBase64Utf8(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

function formatSmtpSubject(subject: string): string {
  return `=?UTF-8?B?${encodeBase64Utf8(subject)}?=`;
}

function splitRecipients(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}

export function buildNotificationMessage(event: SyncEventDto): NotificationMessage {
  const payload = event.payload ?? {};
  const charName = typeof payload.characterName === 'string' ? payload.characterName : '';
  const diffSummary = typeof payload.diffSummary === 'string' ? payload.diffSummary : '';
  const reviewType = typeof payload.reviewType === 'string' ? payload.reviewType : '';
  const rippleCount = typeof payload.rippleCount === 'number' ? payload.rippleCount : 0;

  let title = `RoleCard Studio 通知：${event.eventType}`;
  if (event.eventType === 'review.pending') {
    if (reviewType === 'ripple') {
      title = `[待审核] 角色「${charName || event.targetId}」新增 ${rippleCount} 条关系涟漪提案`;
    } else {
      title = `[待审核] 角色「${charName || event.targetId}」产生新的演化提案`;
    }
  } else if (event.eventType === 'card.evolved') {
    title = `[已演化] 角色「${charName || event.targetId}」升级至 v${event.version}`;
  } else if (event.eventType === 'ripple.approved') {
    title = `[涟漪已生效] 关联角色卡已更新至 v${event.version}`;
  } else if (event.eventType === 'card.updated') {
    title = `[卡片更新] ${charName || event.targetId} (v${event.version})`;
  } else if (event.eventType === 'lorebook.updated') {
    title = `[世界书更新] ${event.targetId} (v${event.version})`;
  }

  const lines = [
    title,
    `事件类型：${event.eventType}`,
    `目标对象：${event.targetType}:${event.targetId} (v${event.version})`,
    diffSummary ? `变更摘要：${diffSummary}` : '',
    `触发时间：${event.createdAt}`,
    '请前往 RoleCard Studio「审核与同步中心」查看并处理。',
  ].filter(Boolean);

  return {
    title,
    bodyText: lines.join('\n'),
    event,
  };
}

class SmtpLineReader {
  private buffer = '';
  private queue: string[] = [];
  private waiter: ((line: string) => void) | null = null;
  private failure: Error | null = null;
  private failWaiter: ((error: Error) => void) | null = null;

  constructor(socket: net.Socket | tls.TLSSocket) {
    socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      this.drain();
    });
    socket.on('error', (errObj) => {
      this.failure = errObj instanceof Error ? errObj : new Error(String(errObj));
      if (this.failWaiter) {
        this.failWaiter(this.failure);
        this.failWaiter = null;
        this.waiter = null;
      }
    });
    socket.on('close', () => {
      if (!this.failure) {
        this.failure = new Error('SMTP 连接已提前关闭');
      }
      if (this.failWaiter) {
        this.failWaiter(this.failure);
        this.failWaiter = null;
        this.waiter = null;
      }
    });
  }

  private drain(): void {
    while (true) {
      const idx = this.buffer.indexOf('\n');
      if (idx === -1) break;
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      if (this.waiter) {
        const resolve = this.waiter;
        this.waiter = null;
        this.failWaiter = null;
        resolve(line);
      } else {
        this.queue.push(line);
      }
    }
  }

  nextLine(timeoutMs = 15_000): Promise<string> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift()!);
    }
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        this.failWaiter = null;
        reject(new Error('SMTP 服务器响应超时'));
      }, timeoutMs);

      this.waiter = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.failWaiter = (e) => {
        clearTimeout(timer);
        reject(e);
      };
    });
  }

  async readResponse(expectedCodes: number[]): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    let code = 0;
    while (true) {
      const line = await this.nextLine();
      lines.push(line);
      const match = /^(\d{3})([ -])(.*)$/.exec(line);
      if (!match) continue;
      code = Number.parseInt(match[1]!, 10);
      if (match[2] === ' ') {
        break;
      }
    }
    if (!expectedCodes.includes(code)) {
      throw new Error(`SMTP 返回状态异常 (${code}): ${lines.join(' | ')}`);
    }
    return { code, lines };
  }
}

export async function defaultSmtpSend(input: SmtpSendInput): Promise<void> {
  if (!input.host.trim()) {
    throw new Error('SMTP 主机地址不能为空');
  }
  if (input.to.length === 0) {
    throw new Error('至少需要一个合法的收件人邮箱');
  }

  let socket: net.Socket | tls.TLSSocket = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SMTP 连接超时')), 15_000);
    const sock = input.secure
      ? tls.connect({ host: input.host, port: input.port, servername: input.host }, () => {
          clearTimeout(timer);
          resolve(sock);
        })
      : net.connect({ host: input.host, port: input.port }, () => {
          clearTimeout(timer);
          resolve(sock);
        });
    sock.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });

  try {
    let reader = new SmtpLineReader(socket);
    const sendCmd = (cmd: string) => {
      socket.write(`${cmd}\r\n`);
    };

    await reader.readResponse([220]);
    sendCmd('EHLO rolecard-studio.local');
    let ehlo = await reader.readResponse([250]);

    if (!input.secure && ehlo.lines.some((l) => l.toUpperCase().includes('STARTTLS'))) {
      sendCmd('STARTTLS');
      await reader.readResponse([220]);
      socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const upgraded = tls.connect({ socket, servername: input.host }, () => {
          resolve(upgraded);
        });
        upgraded.once('error', reject);
      });
      reader = new SmtpLineReader(socket);
      sendCmd('EHLO rolecard-studio.local');
      ehlo = await reader.readResponse([250]);
    }

    if (input.username.trim() && input.password) {
      const capabilities = ehlo.lines.join('\n').toUpperCase();
      if (capabilities.includes('AUTH') && capabilities.includes('PLAIN')) {
        const token = Buffer.from(`\u0000${input.username}\u0000${input.password}`, 'utf8').toString(
          'base64',
        );
        sendCmd(`AUTH PLAIN ${token}`);
        await reader.readResponse([235]);
      } else {
        sendCmd('AUTH LOGIN');
        await reader.readResponse([334]);
        sendCmd(encodeBase64Utf8(input.username));
        await reader.readResponse([334]);
        sendCmd(encodeBase64Utf8(input.password));
        await reader.readResponse([235]);
      }
    }

    const fromAddr = input.from.trim() || input.username.trim();
    sendCmd(`MAIL FROM:<${fromAddr}>`);
    await reader.readResponse([250]);

    for (const rcpt of input.to) {
      sendCmd(`RCPT TO:<${rcpt}>`);
      await reader.readResponse([250, 251]);
    }

    sendCmd('DATA');
    await reader.readResponse([354]);

    const escapedBody = input.bodyText
      .replace(/\r?\n/g, '\r\n')
      .split('\r\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');

    const headers = [
      `From: RoleCard Studio <${fromAddr}>`,
      `To: ${input.to.join(', ')}`,
      `Subject: ${formatSmtpSubject(input.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(escapedBody, 'utf8').toString('base64'),
      '.',
    ].join('\r\n');

    socket.write(`${headers}\r\n`);
    await reader.readResponse([250]);

    sendCmd('QUIT');
    await reader.readResponse([221]).catch(() => undefined);
  } finally {
    socket.destroy();
  }
}

export async function validateNotificationChannelSettings(
  channelType: NotificationChannelType,
  settings: NotificationChannelSettings,
  dnsLookup: DnsLookupPort = defaultDnsLookup,
  fetchImpl?: HttpFetchPort,
): Promise<Result<true, CoreError>> {
  switch (channelType) {
    case 'smtp': {
      if (!settings.smtpHost?.trim()) {
        return err({ code: 'INVALID_SMTP_HOST', message: '请填写 SMTP 服务器地址', status: 400 });
      }
      const hostCheck = await validatePublicUrl(
        `https://${settings.smtpHost.trim()}`,
        dnsLookup,
        { allowFakeIp: isFakeIpAllowedByFetch(fetchImpl) },
      );
      if (!hostCheck.ok) {
        return hostCheck;
      }
      if (splitRecipients(settings.smtpTo ?? '').length === 0) {
        return err({
          code: 'INVALID_SMTP_RECIPIENT',
          message: '请至少填写一个有效收件人邮箱',
          status: 400,
        });
      }
      if (!settings.smtpFrom?.trim() && !settings.smtpUser?.trim()) {
        return err({
          code: 'INVALID_SMTP_FROM',
          message: '请填写发件邮箱或 SMTP 认证账号',
          status: 400,
        });
      }
      return ok(true);
    }
    case 'feishu':
    case 'wecom':
    case 'dingtalk':
    case 'discord':
    case 'webhook': {
      if (!settings.webhookUrl?.trim()) {
        return err({ code: 'MISSING_WEBHOOK_URL', message: '请填写 Webhook 地址', status: 400 });
      }
      const targetUrl = settings.webhookUrl.trim();
      const urlCheck = await validatePublicUrl(targetUrl, dnsLookup, {
        viaProxy: fetchImpl ? isUrlProxiedByFetch(fetchImpl, targetUrl) : false,
        allowFakeIp: isFakeIpAllowedByFetch(fetchImpl),
      });
      if (!urlCheck.ok) return urlCheck;
      return ok(true);
    }
    case 'telegram': {
      if (!settings.telegramBotToken?.trim() || !settings.telegramChatId?.trim()) {
        return err({
          code: 'MISSING_TELEGRAM_CONFIG',
          message: '请填写 Telegram Bot Token 与 Chat ID',
          status: 400,
        });
      }
      const base = settings.telegramApiBaseUrl?.trim() || 'https://api.telegram.org';
      const urlCheck = await validatePublicUrl(base, dnsLookup, {
        viaProxy: fetchImpl ? isUrlProxiedByFetch(fetchImpl, base) : false,
        allowFakeIp: isFakeIpAllowedByFetch(fetchImpl),
      });
      if (!urlCheck.ok) return urlCheck;
      return ok(true);
    }
    case 'bark': {
      if (!settings.barkDeviceKey?.trim()) {
        return err({
          code: 'MISSING_BARK_KEY',
          message: '请填写 Bark Device Key',
          status: 400,
        });
      }
      const base = settings.barkServerUrl?.trim() || 'https://api.day.app';
      const urlCheck = await validatePublicUrl(base, dnsLookup, {
        viaProxy: fetchImpl ? isUrlProxiedByFetch(fetchImpl, base) : false,
        allowFakeIp: isFakeIpAllowedByFetch(fetchImpl),
      });
      if (!urlCheck.ok) return urlCheck;
      return ok(true);
    }
    case 'serverchan': {
      if (!settings.serverChanSendKey?.trim()) {
        return err({
          code: 'MISSING_SERVERCHAN_KEY',
          message: '请填写 Server酱 SendKey',
          status: 400,
        });
      }
      return ok(true);
    }
  }
}

async function postJsonChecked(
  url: string,
  body: unknown,
  deps: NotificationDeliveryDeps,
  channelLabel: string,
): Promise<Result<{ status: number }, CoreError>> {
  const fetchImpl = deps.fetchImpl ?? defaultHttpFetch;
  const dnsLookup = deps.dnsLookup ?? defaultDnsLookup;
  const check = await validatePublicUrl(url, dnsLookup, {
    viaProxy: isUrlProxiedByFetch(fetchImpl, url),
    allowFakeIp: isFakeIpAllowedByFetch(fetchImpl),
  });
  if (!check.ok) return check;

  const response = await fetchImpl(check.value.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'RoleCardStudio-Notify/1.0',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    return err({
      code: 'NOTIFICATION_HTTP_ERROR',
      message: `${channelLabel} 返回 HTTP ${response.status}${errText ? `: ${errText.slice(0, 180)}` : ''}`,
      status: response.status >= 400 ? response.status : 502,
    });
  }
  return ok({ status: response.status });
}

export async function deliverNotificationToChannel(
  channel: {
    id: string;
    name: string;
    channelType: NotificationChannelType;
    settings: NotificationChannelSettings;
  },
  message: NotificationMessage,
  deps: NotificationDeliveryDeps = {},
): Promise<Result<{ channelId: string; detail: string }, CoreError>> {
  const { channelType, settings } = channel;
  const dnsLookup = deps.dnsLookup ?? defaultDnsLookup;

  try {
    switch (channelType) {
      case 'smtp': {
        const hostCheck = await validatePublicUrl(
          `https://${settings.smtpHost.trim()}`,
          dnsLookup,
          { allowFakeIp: isFakeIpAllowedByFetch(deps.fetchImpl) },
        );
        if (!hostCheck.ok) return hostCheck;

        const transport = deps.smtpTransport ?? defaultSmtpSend;
        await transport({
          host: settings.smtpHost.trim(),
          port: Number(settings.smtpPort) || 465,
          secure: settings.smtpSecure ?? true,
          username: settings.smtpUser ?? '',
          password: settings.smtpPass ?? '',
          from: settings.smtpFrom?.trim() || settings.smtpUser?.trim() || '',
          to: splitRecipients(settings.smtpTo ?? ''),
          subject: message.title,
          bodyText: message.bodyText,
        });
        return ok({ channelId: channel.id, detail: 'SMTP 邮件发送成功' });
      }

      case 'feishu': {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const payload: Record<string, unknown> = {
          msg_type: 'text',
          content: { text: message.bodyText },
        };
        if (settings.secret?.trim()) {
          const stringToSign = `${timestamp}\n${settings.secret.trim()}`;
          payload.timestamp = timestamp;
          payload.sign = createHmac('sha256', stringToSign).digest('base64');
        }
        const res = await postJsonChecked(settings.webhookUrl, payload, deps, '飞书机器人');
        if (!res.ok) return res;
        return ok({ channelId: channel.id, detail: `飞书通知成功 (HTTP ${res.value.status})` });
      }

      case 'wecom': {
        const res = await postJsonChecked(
          settings.webhookUrl,
          {
            msgtype: 'markdown',
            markdown: { content: `**${message.title}**\n\n${message.bodyText}` },
          },
          deps,
          '企业微信机器人',
        );
        if (!res.ok) return res;
        return ok({ channelId: channel.id, detail: `企业微信通知成功 (HTTP ${res.value.status})` });
      }

      case 'dingtalk': {
        let targetUrl = settings.webhookUrl.trim();
        if (settings.secret?.trim()) {
          const ts = Date.now();
          const stringToSign = `${ts}\n${settings.secret.trim()}`;
          const sign = encodeURIComponent(
            createHmac('sha256', settings.secret.trim()).update(stringToSign).digest('base64'),
          );
          const sep = targetUrl.includes('?') ? '&' : '?';
          targetUrl = `${targetUrl}${sep}timestamp=${ts}&sign=${sign}`;
        }
        const res = await postJsonChecked(
          targetUrl,
          {
            msgtype: 'markdown',
            markdown: { title: message.title, text: `### ${message.title}\n\n${message.bodyText}` },
          },
          deps,
          '钉钉机器人',
        );
        if (!res.ok) return res;
        return ok({ channelId: channel.id, detail: `钉钉通知成功 (HTTP ${res.value.status})` });
      }

      case 'telegram': {
        const base = (settings.telegramApiBaseUrl?.trim() || 'https://api.telegram.org').replace(
          /\/+$/,
          '',
        );
        const url = `${base}/bot${encodeURIComponent(settings.telegramBotToken.trim())}/sendMessage`;
        const res = await postJsonChecked(
          url,
          {
            chat_id: settings.telegramChatId.trim(),
            text: `${message.title}\n\n${message.bodyText}`,
          },
          deps,
          'Telegram Bot',
        );
        if (!res.ok) return res;
        return ok({ channelId: channel.id, detail: `Telegram 推送成功 (HTTP ${res.value.status})` });
      }

      case 'discord': {
        const res = await postJsonChecked(
          settings.webhookUrl,
          {
            content: `**${message.title}**\n\`\`\`\n${message.bodyText}\n\`\`\``,
          },
          deps,
          'Discord Webhook',
        );
        if (!res.ok) return res;
        return ok({ channelId: channel.id, detail: `Discord 推送成功 (HTTP ${res.value.status})` });
      }

      case 'bark': {
        const base = (settings.barkServerUrl?.trim() || 'https://api.day.app').replace(/\/+$/, '');
        const url = `${base}/${encodeURIComponent(settings.barkDeviceKey.trim())}`;
        const res = await postJsonChecked(
          url,
          {
            title: message.title,
            body: message.bodyText,
            group: settings.barkGroup?.trim() || 'RoleCardStudio',
          },
          deps,
          'Bark 推送',
        );
        if (!res.ok) return res;
        return ok({ channelId: channel.id, detail: `Bark 推送成功 (HTTP ${res.value.status})` });
      }

      case 'serverchan': {
        const url = `https://sctapi.ftqq.com/${encodeURIComponent(settings.serverChanSendKey.trim())}.send`;
        const res = await postJsonChecked(
          url,
          {
            title: message.title.slice(0, 32),
            desp: message.bodyText,
          },
          deps,
          'Server酱',
        );
        if (!res.ok) return res;
        return ok({ channelId: channel.id, detail: `Server酱推送成功 (HTTP ${res.value.status})` });
      }

      case 'webhook': {
        const res = await deliverWebhookWithRetry(
          settings.webhookUrl.trim(),
          settings.secret?.trim() || 'rolecard_notify',
          message.event,
          {
            fetchImpl: deps.fetchImpl,
            dnsLookup: deps.dnsLookup,
            maxAttempts: 2,
            baseDelayMs: 50,
          },
        );
        if (!res.ok) return res;
        return ok({ channelId: channel.id, detail: `Webhook 投递成功 (HTTP ${res.value.status})` });
      }
    }
  } catch (error) {
    return err({
      code: 'NOTIFICATION_DELIVERY_FAILED',
      message: error instanceof Error ? error.message : '通知投递失败',
      status: 502,
    });
  }
}

export async function deliverNotificationsInParallel(
  channels: readonly {
    id: string;
    name: string;
    channelType: NotificationChannelType;
    settings: NotificationChannelSettings;
  }[],
  event: SyncEventDto,
  deps: NotificationDeliveryDeps = {},
): Promise<Array<Result<{ channelId: string; detail: string }, CoreError>>> {
  const message = buildNotificationMessage(event);
  return Promise.all(
    channels.map((ch) => deliverNotificationToChannel(ch, message, deps)),
  );
}
