import { randomBytes } from 'node:crypto';
import type { LlmCompletionPort } from '@rolecard/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createSqliteDatabase, seedInitialState, type DatabaseHandle } from './db/client.js';

const noopLlmPort: LlmCompletionPort = async () => ({ status: 200, content: '{}' });

describe('issue #17: sensitive config is not exposed to guests or other users', () => {
  let dbHandle: DatabaseHandle;
  let masterKey: Buffer;

  beforeEach(async () => {
    dbHandle = createSqliteDatabase(':memory:');
    masterKey = randomBytes(32);
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: '{{SECRET_kh8fh3bc}}',
    });
  });

  afterEach(() => {
    dbHandle.close();
  });

  function buildApp() {
    return createApp({
      db: dbHandle.db,
      masterKey,
      dataDir: ':memory:',
      deploymentMode: 'local',
      llmPort: noopLlmPort,
      dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
      smtpTransport: async () => {},
      memoryUploads: new Map(),
      searchProviderPort: async () => [],
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
  }

  async function loginAs(
    app: ReturnType<typeof createApp>,
    username: string,
    password: string,
  ): Promise<string> {
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { token: string }).token;
  }

  async function setupGlobalConfig(app: ReturnType<typeof createApp>, adminToken: string) {
    const saveRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'deepseek',
          apiKey: '{{SECRET_9s6p4c2m}}',
          baseUrl: 'https://internal-llm.example.com/v1',
          model: 'deepseek-chat',
          jsonModeStrategy: 'auto',
        },
        searchProvider: 'tavily',
        searchApiKey: '{{SECRET_q1b2n3m4}}',
        enableLayer1Wiki: false,
      }),
    });
    expect(saveRes.status).toBe(200);
  }

  it('anonymous visitors only learn whether the service is configured', async () => {
    const app = buildApp();
    const adminToken = await loginAs(app, 'admin', '{{SECRET_kh8fh3bc}}');
    await setupGlobalConfig(app, adminToken);

    const res = await app.request('/api/v1/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.configured).toBe(true);
    expect(Object.keys(body).sort()).toEqual(['configured']);
    expect(JSON.stringify(body)).not.toContain('deepseek-chat');
    expect(JSON.stringify(body)).not.toContain('internal-llm.example.com');
    expect(body.primaryLlm).toBeUndefined();
    expect(body.searchProvider).toBeUndefined();
    expect(body.proxyConfig).toBeUndefined();
    expect(body.searchApiKeyMasked).toBeUndefined();
  });

  it('a regular user cannot read the global service config details', async () => {
    const app = buildApp();
    const adminToken = await loginAs(app, 'admin', '{{SECRET_kh8fh3bc}}');
    await setupGlobalConfig(app, adminToken);

    const createUserRes = await app.request('/api/v1/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        username: 'member1',
        password: '{{SECRET_4jd2lq7r}}',
        role: 'user',
        permissions: ['card:read', 'card:create', 'card:update'],
      }),
    });
    expect(createUserRes.status).toBe(201);
    const memberToken = await loginAs(app, 'member1', '{{SECRET_4jd2lq7r}}');

    const res = await app.request('/api/v1/config', {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.configured).toBe(true);
    expect(Object.keys(body).sort()).toEqual(['configured']);
    expect(JSON.stringify(body)).not.toContain('deepseek-chat');
    expect(JSON.stringify(body)).not.toContain('internal-llm.example.com');
  });

  it('admin still reads the masked config without leaking api keys', async () => {
    const app = buildApp();
    const adminToken = await loginAs(app, 'admin', '{{SECRET_kh8fh3bc}}');
    await setupGlobalConfig(app, adminToken);

    const res = await app.request('/api/v1/config', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      configured: boolean;
      primaryLlm: { model: string; apiKeyMasked: string };
    };
    expect(body.configured).toBe(true);
    expect(body.primaryLlm.model).toBe('deepseek-chat');
    expect(body.primaryLlm.apiKeyMasked.startsWith('****')).toBe(true);
    expect(body.primaryLlm.apiKeyMasked.length).toBeLessThanOrEqual(8);
  });

  it('notification channels are readable only by admins', async () => {
    const app = buildApp();
    const adminToken = await loginAs(app, 'admin', '{{SECRET_kh8fh3bc}}');

    const createChannelRes = await app.request('/api/v1/notifications/channels', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: '审核邮件',
        channelType: 'smtp',
        enabled: true,
        events: ['review.pending'],
        settings: {
          smtpHost: 'smtp.example.com',
          smtpPort: 465,
          smtpSecure: true,
          smtpUser: 'bot@example.com',
          smtpPass: '{{SECRET_7f8g9h0j}}',
          smtpFrom: 'secret-from@example.com',
          smtpTo: 'secret-to@example.com',
        },
      }),
    });
    expect(createChannelRes.status).toBe(201);

    const anonymous = await app.request('/api/v1/notifications/channels');
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).not.toContain('secret-from@example.com');

    const createUserRes = await app.request('/api/v1/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        username: 'member2',
        password: '{{SECRET_2w3e4r5t}}',
        role: 'user',
        permissions: ['card:read', 'card:create', 'card:update'],
      }),
    });
    expect(createUserRes.status).toBe(201);
    const memberToken = await loginAs(app, 'member2', '{{SECRET_2w3e4r5t}}');

    const asMember = await app.request('/api/v1/notifications/channels', {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(asMember.status).toBe(403);
    expect(await asMember.text()).not.toContain('secret-to@example.com');

    const asAdmin = await app.request('/api/v1/notifications/channels', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(asAdmin.status).toBe(200);
    const adminBody = (await asAdmin.json()) as {
      items: Array<{ settingsMasked: { hasSmtpPass: boolean; smtpPassMasked: string } }>;
    };
    expect(adminBody.items).toHaveLength(1);
    expect(adminBody.items[0]!.settingsMasked.hasSmtpPass).toBe(true);
    expect(JSON.stringify(adminBody)).not.toContain('{{SECRET_7f8g9h0j}}');
  });

  it('sync subscriptions are readable only by admins', async () => {
    const app = buildApp();
    const adminToken = await loginAs(app, 'admin', '{{SECRET_kh8fh3bc}}');

    const createSubRes = await app.request('/api/v1/sync/subscriptions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        name: '内部同步终端',
        webhookUrl: 'https://hooks.example.com/secret-endpoint',
        events: ['card.evolved'],
      }),
    });
    expect(createSubRes.status).toBe(201);

    const anonymous = await app.request('/api/v1/sync/subscriptions');
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).not.toContain('hooks.example.com');

    const createUserRes = await app.request('/api/v1/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        username: 'member3',
        password: '{{SECRET_6y7u8i9o}}',
        role: 'user',
        permissions: ['card:read', 'card:update'],
      }),
    });
    expect(createUserRes.status).toBe(201);
    const memberToken = await loginAs(app, 'member3', '{{SECRET_6y7u8i9o}}');

    const asMember = await app.request('/api/v1/sync/subscriptions', {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(asMember.status).toBe(403);
    expect(await asMember.text()).not.toContain('hooks.example.com');

    const asAdmin = await app.request('/api/v1/sync/subscriptions', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(asAdmin.status).toBe(200);
    const adminBody = (await asAdmin.json()) as { items: Array<{ webhookUrl: string }> };
    expect(adminBody.items).toHaveLength(1);
    expect(adminBody.items[0]!.webhookUrl).toBe('https://hooks.example.com/secret-endpoint');
  });
});
