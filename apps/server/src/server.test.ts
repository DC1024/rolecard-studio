import { randomBytes } from 'node:crypto';
import type { LlmCompletionPort } from '@rolecard/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createSqliteDatabase, seedInitialState, type DatabaseHandle } from './db/client.js';

describe('RoleCard Studio Server M0 integration', () => {
  let dbHandle: DatabaseHandle;
  let masterKey: Buffer;
  let llmCallCount = 0;

  const mockLlmPort: LlmCompletionPort = async () => {
    llmCallCount += 1;
    return {
      status: 200,
      content: JSON.stringify({
        name: '阿米娅',
        summary: '罗德岛的公开领袖，坚毅温柔的兔耳少女',
        personality: '富有同理心且极具责任感，关键时刻果断坚定',
        appearance: '棕发兔耳、蓝色眼睛与黑色风衣',
        background: '在凯尔希与博士的支持下领导罗德岛',
        speech_style: { tone: '温柔坚定', catchphrases: ['博士，请下达指令吧'], habits: [] },
        relationships: [{ target: '博士', relation: '战友与领袖', attitude: '信赖' }],
        first_mes: '博士，您还有许多事情需要处理，现在还不能休息哦。',
        alternate_greetings: [],
        mes_example: '<START>\n{{user}}: 辛苦了。\n{{char}}: 博士也是，请保重身体。',
        system_prompt: '扮演阿米娅。',
        scenario: '罗德岛舰桥',
        creator_notes: '测试生成卡片',
        tags: ['明日方舟', '罗德岛'],
        extensions: {},
      }),
    };
  };

  beforeEach(async () => {
    llmCallCount = 0;
    dbHandle = createSqliteDatabase(':memory:');
    masterKey = randomBytes(32);
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: 'AdminPassword!123',
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
      llmPort: mockLlmPort,
      searchProviderPort: async () => [
        {
          title: '阿米娅 - PRTS',
          url: 'https://prts.wiki/w/阿米娅',
          snippet: '罗德岛的公开领袖，在内部拥有最高执行权。',
          origin: 'search_supplement',
          provider: 'tavily',
        },
      ],
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
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
    const data = (await res.json()) as { token: string };
    return data.token;
  }

  it('handles health, RBAC policy switching, and ordinary user 403 boundaries', async () => {
    const app = buildApp();

    const healthRes = await app.request('/api/v1/health');
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as {
      status: string;
      siteAccessMode: string;
      apiAccessMode: string;
    };
    expect(health.status).toBe('ok');
    expect(health.siteAccessMode).toBe('public');
    expect(health.apiAccessMode).toBe('authenticated');

    const adminToken = await loginAs(app, 'admin', 'AdminPassword!123');

    // Create normal user with only card:read and card:create
    const createUserRes = await app.request('/api/v1/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        username: 'member1',
        password: 'MemberPass!123',
        role: 'user',
        permissions: ['card:read', 'card:create'],
      }),
    });
    expect(createUserRes.status).toBe(201);

    const memberToken = await loginAs(app, 'member1', 'MemberPass!123');

    // Member cannot touch admin endpoints or write global LLM config
    const adminDenied = await app.request('/api/v1/admin/access-policy', {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(adminDenied.status).toBe(403);

    const configWriteDenied = await app.request('/api/v1/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${memberToken}`,
      },
      body: JSON.stringify({
        primaryLlm: { provider: 'deepseek', apiKey: 'sk-123456', model: 'deepseek-chat' },
      }),
    });
    expect(configWriteDenied.status).toBe(403);

    // Switch site to login_required
    const policyRes = await app.request('/api/v1/admin/access-policy', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        siteAccessMode: 'login_required',
        apiAccessMode: 'authenticated',
        guestPermissions: ['card:read'],
      }),
    });
    expect(policyRes.status).toBe(200);

    // Anonymous guest is now blocked with 401
    const guestBlocked = await app.request('/api/v1/cards');
    expect(guestBlocked.status).toBe(401);

    // Authenticated member with card:read succeeds
    const memberAllowed = await app.request('/api/v1/cards', {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(memberAllowed.status).toBe(200);
  });

  it('encrypts API keys, masks last 4 chars, generates Mode C cards, filters & updates tags, and enforces dual-mode external API', async () => {
    const app = buildApp();
    const adminToken = await loginAs(app, 'admin', 'AdminPassword!123');

    // Save global LLM + Search config
    const saveCfgRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'deepseek',
          apiKey: 'sk-deepseek-secret-7890',
          model: 'deepseek-chat',
          jsonModeStrategy: 'auto',
        },
        searchProvider: 'tavily',
        searchApiKey: 'tvly-secret-4321',
        enableLayer1Wiki: false,
      }),
    });
    expect(saveCfgRes.status).toBe(200);
    const cfgBody = (await saveCfgRes.json()) as {
      configured: boolean;
      primaryLlm: { apiKeyMasked: string };
      searchApiKeyMasked: string;
    };
    expect(cfgBody.configured).toBe(true);
    expect(cfgBody.primaryLlm.apiKeyMasked).toBe('****7890');
    expect(cfgBody.searchApiKeyMasked).toBe('****4321');
    expect(JSON.stringify(cfgBody)).not.toContain('sk-deepseek-secret');

    // Test LLM connectivity endpoint
    const testCfgRes = await app.request('/api/v1/config/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        provider: 'deepseek',
        model: 'deepseek-chat',
        useSavedKeySlot: 'primary',
      }),
    });
    expect(testCfgRes.status).toBe(200);
    const testCfgBody = (await testCfgRes.json()) as { ok: boolean; latencyMs: number };
    expect(testCfgBody.ok).toBe(true);

    // Generate card in Mode C
    const genRes = await app.request('/api/v1/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        mode: 'C',
        characterName: '阿米娅',
        workName: '明日方舟',
        cardType: 'sillytavern_v3',
        referenceText: '补充：在咖啡厅休息时喜欢喝黑咖啡。',
        tags: ['常用', '指挥'],
      }),
    });
    expect(genRes.status).toBe(201);
    expect(llmCallCount).toBe(1);
    const genBody = (await genRes.json()) as {
      card: { id: string; mode: string; tags: string[]; sources: { origin: string }[] };
    };
    expect(genBody.card.mode).toBe('C');
    expect(genBody.card.sources.some((s) => s.origin === 'user_provided')).toBe(true);
    expect(genBody.card.sources.some((s) => s.origin === 'search_supplement')).toBe(true);

    // Patch tags & query multi-dimensionally
    const cardId = genBody.card.id;
    const tagRes = await app.request(`/api/v1/cards/${cardId}/tags`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ tags: ['明日方舟', '核心领袖'] }),
    });
    expect(tagRes.status).toBe(200);

    const listRes = await app.request('/api/v1/cards?mode=C&tags=核心领袖', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      total: number;
      commonTags: { tag: string; count: number }[];
    };
    expect(listBody.total).toBe(1);
    expect(listBody.commonTags.length).toBe(2);

    // External API dual-state check: authenticated by default -> 401 without key
    const extUnauthorized = await app.request(`/api/v1/external/cards/${cardId}`);
    expect(extUnauthorized.status).toBe(401);

    // Create external API key -> 200
    const keyRes = await app.request('/api/v1/admin/api-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ name: 'SillyTavern Sync', scopes: ['cards:read'] }),
    });
    expect(keyRes.status).toBe(201);
    const keyBody = (await keyRes.json()) as { apiKey: string };

    const extAuthorized = await app.request(`/api/v1/external/cards/${cardId}`, {
      headers: { Authorization: `Bearer ${keyBody.apiKey}` },
    });
    expect(extAuthorized.status).toBe(200);

    // Switch external API to public -> works without key
    await app.request('/api/v1/admin/access-policy', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        siteAccessMode: 'public',
        apiAccessMode: 'public',
        guestPermissions: ['card:read'],
      }),
    });

    const extPublic = await app.request(`/api/v1/external/cards/${cardId}`);
    expect(extPublic.status).toBe(200);

    // SSE generation stream test
    const sseRes = await app.request('/api/v1/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        mode: 'A',
        characterName: '阿米娅',
        workName: '明日方舟',
        referenceText: '阿米娅是罗德岛的领导者。',
      }),
    });
    expect(sseRes.status).toBe(200);
    const sseText = await sseRes.text();
    expect(sseText).toContain('event: progress');
    expect(sseText).toContain('event: result');
  });
});
