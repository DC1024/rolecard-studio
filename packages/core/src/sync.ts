import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SyncEventDto } from '@rolecard/shared';
import {
  defaultDnsLookup,
  defaultHttpFetch,
  isFakeIpAllowedByFetch,
  isUrlProxiedByFetch,
  validatePublicUrl,
} from './ssrf.js';
import {
  type CoreError,
  type DnsLookupPort,
  type HttpFetchPort,
  type Result,
  err,
  ok,
} from './types.js';

export function signWebhookPayload(
  secret: string,
  timestampIso: string,
  bodyJson: string,
): string {
  const mac = createHmac('sha256', secret)
    .update(`${timestampIso}.${bodyJson}`)
    .digest('hex');
  return `sha256=${mac}`;
}

export function verifyWebhookSignature(
  secret: string,
  timestampIso: string,
  bodyJson: string,
  signatureHeader: string,
): boolean {
  const expected = signWebhookPayload(secret, timestampIso, bodyJson);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signatureHeader.trim(), 'utf8');
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

export interface WebhookDeliveryDeps {
  fetchImpl?: HttpFetchPort;
  dnsLookup?: DnsLookupPort;
  maxAttempts?: number;
  baseDelayMs?: number;
}

export interface WebhookEnvelope {
  headers: Record<string, string>;
  bodyJson: string;
}

export function buildWebhookEnvelope(
  secret: string,
  event: SyncEventDto,
  timestampIso: string = new Date().toISOString(),
): WebhookEnvelope {
  const bodyJson = JSON.stringify(event);
  const signature = signWebhookPayload(secret, timestampIso, bodyJson);
  return {
    bodyJson,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'RoleCardStudio-Webhook/1.0',
      'X-RoleCard-Event': event.eventType,
      'X-RoleCard-Cursor': String(event.cursor),
      'X-RoleCard-Timestamp': timestampIso,
      'X-RoleCard-Signature': signature,
    },
  };
}

export async function deliverWebhookWithRetry(
  webhookUrl: string,
  secret: string,
  event: SyncEventDto,
  deps: WebhookDeliveryDeps = {},
): Promise<Result<{ status: number; attempts: number }, CoreError>> {
  const dnsLookup = deps.dnsLookup ?? defaultDnsLookup;
  const fetchImpl = deps.fetchImpl ?? defaultHttpFetch;
  const maxAttempts = Math.max(1, Math.min(deps.maxAttempts ?? 3, 5));
  const baseDelayMs = Math.max(0, deps.baseDelayMs ?? 100);

  const urlCheck = await validatePublicUrl(webhookUrl, dnsLookup, {
    viaProxy: isUrlProxiedByFetch(fetchImpl, webhookUrl),
    allowFakeIp: isFakeIpAllowedByFetch(fetchImpl),
  });
  if (!urlCheck.ok) {
    return urlCheck;
  }

  const envelope = buildWebhookEnvelope(secret, event);
  let lastStatus = 0;
  let lastErrorMessage = 'Webhook 投递失败';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchImpl(urlCheck.value.toString(), {
        method: 'POST',
        headers: envelope.headers,
        body: envelope.bodyJson,
      });

      lastStatus = response.status;
      if (response.status >= 200 && response.status < 300) {
        return ok({ status: response.status, attempts: attempt });
      }
      lastErrorMessage = `目标 Webhook 返回 HTTP ${response.status}`;
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : '网络投递异常';
    }

    if (attempt < maxAttempts && baseDelayMs > 0) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return err({
    code: 'WEBHOOK_DELIVERY_FAILED',
    message: `${lastErrorMessage}（已重试 ${maxAttempts} 次）`,
    status: lastStatus >= 400 ? lastStatus : 502,
  });
}
