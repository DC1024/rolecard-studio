import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createDefaultPortraitPng,
  verifyWebhookSignature,
  type DnsLookupPort,
  type HttpFetchPort,
  type LlmCompletionPort,
} from '@rolecard/core';
import type { RoleCardContent } from '@rolecard/shared';
import { createApp } from './app.js';
import { createSqliteDatabase, seedInitialState } from './db/client.js';

const mockCardA: RoleCardContent = {
  name: '温蒂',
  summary: '罗德岛工程干员',
  personality: '严谨、温和',
  appearance: '淡蓝色长发',
  background: '负责工程维护',
  speech_style: { tone: '清晰', catchphrases: [], habits: [] },
  relationships: [],
  first_mes: '实验准备就绪。',
  alternate_greetings: [],
  mes_example: '',
  system_prompt: '',
  scenario: '实验室',
  creator_notes: '',
  tags: ['工程'],
  extensions: {},
};

const mockCardB: RoleCardContent = {
  ...mockCardA,
  name: '极境',
  summary: '先锋通信干员',
  personality: '乐观健谈',
};

describe('M3 Server Integration: Evolution, 1-Hop Ripple, Meta Isolation, Sync & Vision', () => {
  it('runs schedule defaults, manual evolution, approval, 1-hop ripple, signed webhook & vision/image search', async () => {
    const dbHandle = createSqliteDatabase(':memory:');
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: 'TestPassword123!',
    });

    const deliveredHooks: Array<{ headers: Headers; body: string }> = [];
    const publicDns: DnsLookupPort = async () => [{ address: '93.184.216.34', family: 4 }];

    const fetchImpl: HttpFetchPort = async (url, init) => {
      if (url.startsWith('https://hooks.example.com/')) {
        deliveredHooks.push({
          headers: new Headers(init?.headers),
          body: String(init?.body ?? ''),
        });
        return new Response('ok', { status: 200 });
      }
      if (url.includes('commons.wikimedia.org')) {
        return new Response(
          JSON.stringify({
            query: {
              pages: {
                '1': {
                  title: 'File:Portrait_Ref.png',
                  imageinfo: [
                    {
                      url: 'https://upload.wikimedia.org/wikipedia/commons/p/Portrait_Ref.png',
                      thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/Portrait_Ref.png',
                      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Portrait_Ref.png',
                      mime: 'image/png',
                    },
                  ],
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/chat/completions')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    appearanceDescription: '淡蓝发工程干员，佩戴便携式护目镜。',
                    suggestedTags: ['蓝发', '工程'],
                    imagePrompt: 'light blue hair engineer anime girl with goggles',
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('extracts')) {
        return new Response(
          JSON.stringify({
            query: {
              pages: {
                '99': { pageid: 99, title: '温蒂', extract: '2026年新增潜能模组与水炮强化记录。' },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          query: {
            search: [{ pageid: 99, title: '温蒂', snippet: '新增模组记录' }],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const llmPort: LlmCompletionPort = async (req) => {
      const sys = req.messages[0]?.content ?? '';
      if (sys.includes('角色演化维护引擎')) {
        return {
          status: 200,
          content: JSON.stringify({
            content: {
              ...mockCardA,
              summary: '罗德岛工程干员（已配备全新水炮模组）',
              personality: '不该被改写的锁定人格',
            },
            metaSummary: '玩家社群常称呼她为高压水枪大师',
            changeReason: '模组档案同步',
          }),
        };
      }
      const last = req.messages[req.messages.length - 1]?.content ?? '';
      return {
        status: 200,
        content: last.includes('极境') ? JSON.stringify(mockCardB) : JSON.stringify(mockCardA),
      };
    };

    const app = createApp({
      db: dbHandle.db,
      masterKey: randomBytes(32),
      dataDir: ':memory:',
      deploymentMode: 'local',
      llmPort,
      fetchImpl,
      dnsLookup: publicDns,
    });

    // 1. Login as admin
    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'TestPassword123!' }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get('set-cookie') ?? '';

    // 2. Configure LLM
    const cfgRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          apiKey: 'sk-test-key',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        searchProvider: 'none',
        enableLayer1Wiki: true,
        dailyAutoRefreshLimit: 20,
        customSystemPrompt: '',
      }),
    });
    expect(cfgRes.status).toBe(200);

    // 3. Create two cards (A fictional with locked personality, B fictional) + 1 real_person card
    const createARes = await app.request('/api/v1/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        mode: 'A',
        characterName: '温蒂',
        workName: '明日方舟',
        entityType: 'fictional',
        referenceText: '温蒂是工程干员。',
      }),
    });
    expect(createARes.status).toBe(201);
    const cardA = ((await createARes.json()) as { card: { id: string } }).card;

    // Lock personality on cardA
    await app.request(`/api/v1/cards/${cardA.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        content: mockCardA,
        lockedFields: ['personality'],
      }),
    });

    const createBRes = await app.request('/api/v1/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        mode: 'A',
        characterName: '极境',
        workName: '明日方舟',
        entityType: 'fictional',
        referenceText: '极境是通讯干员。',
      }),
    });
    expect(createBRes.status).toBe(201);
    const cardB = ((await createBRes.json()) as { card: { id: string } }).card;

    const createRealRes = await app.request('/api/v1/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        mode: 'A',
        characterName: '图灵',
        workName: '历史',
        entityType: 'real_person',
        referenceText: '计算机科学家。',
      }),
    });
    expect(createRealRes.status).toBe(201);
    const cardReal = ((await createRealRes.json()) as { card: { id: string } }).card;

    // real_person meta-settings must forbid enableMetaInChat=true
    const realMetaRes = await app.request(`/api/v1/cards/${cardReal.id}/meta-settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ enableMetaInChat: true }),
    });
    expect(realMetaRes.status).toBe(400);

    // 4. Link Card A & Card B to shared Lorebook
    const lbRes = await app.request('/api/v1/lorebooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: '罗德岛共处世界书',
        description: '工程与先锋干员共处世界',
        worldSummary: '',
        scanDepth: 4,
        tokenBudget: 1500,
        recursiveScanning: false,
        entries: [],
        tags: [],
      }),
    });
    expect(lbRes.status).toBe(201);
    const lbId = ((await lbRes.json()) as { lorebook: { id: string } }).lorebook.id;

    await app.request(`/api/v1/lorebooks/${lbId}/link-card`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ cardId: cardA.id, relationRole: '工程干员', constant: false }),
    });
    await app.request(`/api/v1/lorebooks/${lbId}/link-card`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ cardId: cardB.id, relationRole: '通信搭档', constant: false }),
    });

    // 5. Register webhook subscription for sync events
    const subRes = await app.request('/api/v1/sync/subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: '测试同步终端',
        webhookUrl: 'https://hooks.example.com/sync',
        events: ['card.evolved', 'ripple.approved'],
      }),
    });
    expect(subRes.status).toBe(201);
    const subPayload = (await subRes.json()) as { secret: string };
    expect(subPayload.secret.startsWith('whsec_')).toBe(true);

    // 6. Check default schedule is disabled (enabled=false), then enable with scope='both'
    const getSchedRes = await app.request(`/api/v1/cards/${cardA.id}/schedule`, {
      headers: { cookie },
    });
    expect(getSchedRes.status).toBe(200);
    const defaultSched = ((await getSchedRes.json()) as { schedule: { enabled: boolean } }).schedule;
    expect(defaultSched.enabled).toBe(false);

    const putSchedRes = await app.request(`/api/v1/cards/${cardA.id}/schedule`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        enabled: true,
        intervalDays: 5,
        syncScope: 'both',
        autoApplyThreshold: 'manual_review',
      }),
    });
    expect(putSchedRes.status).toBe(200);

    // 7. Trigger evolution on Card A -> pending impression event
    const evoRes = await app.request(`/api/v1/cards/${cardA.id}/evolve`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(evoRes.status).toBe(200);
    const evoJson = (await evoRes.json()) as { skipped: boolean; impressionId?: string };
    expect(evoJson.skipped).toBe(false);
    expect(evoJson.impressionId).toBeTruthy();

    // Re-running immediately should skip because source hash unchanged
    const evoAgain = await app.request(`/api/v1/cards/${cardA.id}/evolve`, {
      method: 'POST',
      headers: { cookie },
    });
    const evoAgainJson = (await evoAgain.json()) as { skipped: boolean; reason?: string };
    expect(evoAgainJson.skipped).toBe(true);
    expect(evoAgainJson.reason).toBe('SOURCE_HASH_UNCHANGED');

    // 8. Approve impression event -> updates Card A (respecting locked personality) + creates 1-hop ripple for Card B
    const approveImpRes = await app.request(
      `/api/v1/reviews/impressions/${evoJson.impressionId}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ decision: 'approve' }),
      },
    );
    expect(approveImpRes.status).toBe(200);
    const approveImpJson = (await approveImpRes.json()) as { ripplesCreated: number };
    expect(approveImpJson.ripplesCreated).toBe(1);

    // Verify Card A locked personality remained intact & summary updated
    const getCardARes = await app.request(`/api/v1/cards/${cardA.id}`, { headers: { cookie } });
    const updatedCardA = (
      (await getCardARes.json()) as { card: { content: RoleCardContent } }
    ).card;
    expect(updatedCardA.content.summary).toContain('水炮模组');
    expect(updatedCardA.content.personality).toBe('严谨、温和');

    // 9. List reviews and approve 1-hop ripple proposal for Card B
    const reviewsRes = await app.request('/api/v1/reviews', { headers: { cookie } });
    const reviewsJson = (await reviewsRes.json()) as {
      ripples: Array<{ id: string; hop: number; targetCardId: string; status: string }>;
    };
    const pendingRipple = reviewsJson.ripples.find((r) => r.status === 'pending_review');
    expect(pendingRipple).toBeTruthy();
    expect(pendingRipple?.hop).toBe(1);
    expect(pendingRipple?.targetCardId).toBe(cardB.id);

    const approveRipRes = await app.request(
      `/api/v1/reviews/ripples/${pendingRipple!.id}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ decision: 'approve' }),
      },
    );
    expect(approveRipRes.status).toBe(200);

    // 10. Query sync events with since_cursor=0 and verify webhook HMAC signature
    const syncEventsRes = await app.request('/api/v1/sync/events?since_cursor=0', {
      headers: { cookie },
    });
    expect(syncEventsRes.status).toBe(200);
    const syncJson = (await syncEventsRes.json()) as {
      items: Array<{ cursor: number; eventType: string }>;
      nextCursor: number;
    };
    expect(syncJson.items.some((e) => e.eventType === 'card.evolved')).toBe(true);
    expect(syncJson.items.some((e) => e.eventType === 'ripple.approved')).toBe(true);

    // Give async fire-and-forget webhook dispatch a brief tick
    await new Promise((r) => setTimeout(r, 30));
    expect(deliveredHooks.length).toBeGreaterThanOrEqual(1);
    const hookCall = deliveredHooks[0]!;
    const tsHeader = hookCall.headers.get('X-RoleCard-Timestamp') ?? '';
    const sigHeader = hookCall.headers.get('X-RoleCard-Signature') ?? '';
    expect(verifyWebhookSignature(subPayload.secret, tsHeader, hookCall.body, sigHeader)).toBe(true);

    // 11. Test image search & vision analyze routes
    const imgSearchRes = await app.request('/api/v1/images/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ query: 'Portrait', limit: 3 }),
    });
    expect(imgSearchRes.status).toBe(200);
    const imgSearchJson = (await imgSearchRes.json()) as { items: Array<{ title: string }> };
    expect(imgSearchJson.items[0]?.title).toBe('Portrait_Ref.png');

    const pngB64 = createDefaultPortraitPng().toString('base64');
    const visionRes = await app.request('/api/v1/vision/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ imageDataUrl: `data:image/png;base64,${pngB64}` }),
    });
    expect(visionRes.status).toBe(200);
    const visionJson = (await visionRes.json()) as { suggestedTags: string[] };
    expect(visionJson.suggestedTags).toContain('蓝发');

    dbHandle.close();
  });
});
