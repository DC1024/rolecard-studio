import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DnsLookupPort, HttpFetchPort, SmtpSendInput } from '@rolecard/core';
import type { RoleCardContent } from '@rolecard/shared';
import { createApp } from './app.js';
import { createSqliteDatabase, seedInitialState } from './db/client.js';

const baseCard: RoleCardContent = {
  name: '凯尔希',
  summary: '罗德岛最高管理者之一，冷静睿智的医疗与战术核心。',
  personality: '理性克制、言语精密、隐含深切关怀。',
  appearance: '银绿色长发与翠绿双眸，身着医生白大褂。',
  background: '历经泰拉数百年兴衰的观察者。',
  speech_style: { tone: '冷静而富有哲理', catchphrases: [], habits: [] },
  relationships: [],
  scenario: '罗德岛医疗部办公室',
  first_mes: '你的生命体征还算稳定，博士。',
  mes_example: '',
  system_prompt: '',
  creator_notes: '',
  tags: ['医疗', '罗德岛'],
  alternate_greetings: [],
  extensions: {},
};

describe('Server Enhancements (Batches 2 & 3)', () => {
  it('supports account self-service & admin user updates, slot validation, image generation, streaming, TRPG derive/export, and parallel notifications', async () => {
    const dbHandle = createSqliteDatabase(':memory:');
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: 'TestPassword123!',
    });

    const publicDns: DnsLookupPort = async () => [{ address: '93.184.216.34', family: 4 }];
    const smtpSent: SmtpSendInput[] = [];
    const webhookHits: Array<{ url: string; body: string }> = [];

    const fetchImpl: HttpFetchPort = async (url, init) => {
      if (url.includes('open.feishu.cn/')) {
        webhookHits.push({ url, body: String(init?.body ?? '') });
        return new Response(JSON.stringify({ code: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('api.telegram.org/')) {
        return new Response('Bad Request', { status: 400 });
      }
      if (url.endsWith('/images/generations')) {
        return new Response(
          JSON.stringify({
            data: [{ url: 'https://cdn.example.com/kaltsit.png' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/chat/completions')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          stream?: boolean;
          messages?: Array<{ role: string; content: string }>;
        };
        const userText = body.messages?.map((m) => m.content).join('\n') ?? '';

        if (body.stream) {
          const encoder = new TextEncoder();
          const generatedJson = JSON.stringify(baseCard);
          const chunks = [
            `data: ${JSON.stringify({ choices: [{ delta: { content: '<think>分析凯尔希的医疗与历史背景。</think>' } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: generatedJson } }] })}\n\n`,
            'data: [DONE]\n\n',
          ];
          return new Response(
            new ReadableStream({
              start(controller) {
                for (const chunk of chunks) {
                  controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
              },
            }),
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          );
        }

        if (userText.includes('资深 TRPG 规则构筑师')) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      trpg: {
                        system: 'D&D 5e',
                        race: '菲林',
                        className: '生命牧师 / 智者',
                        alignment: '守序中立',
                        level: 10,
                        abilityScores: { STR: 10, DEX: 12, CON: 14, INT: 19, WIS: 18, CHA: 13 },
                        combat: { AC: 15, MaxHP: 72, Speed: '30 ft', ProficiencyBonus: 4 },
                        proficiencies: ['医药', '奥秘', '历史'],
                        featuresAndTraits: ['Mon3tr 协同召唤', '高阶急救'],
                      },
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    content: {
                      ...baseCard,
                      summary: '已演化：补充维多利亚危机时期行动记录。',
                    },
                    metaSummary: null,
                    changeReason: '补充最新主线剧情动态',
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
                '77': {
                  pageid: 77,
                  title: '凯尔希',
                  extract:
                    '凯尔希是罗德岛的重要领导者之一，掌握大量泰拉远古秘密并操控 Mon3tr 协同作战。'.repeat(
                      4,
                    ),
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    };

    const app = createApp({
      db: dbHandle.db,
      masterKey: randomBytes(32),
      dataDir: ':memory:',
      deploymentMode: 'local',
      memoryUploads: new Map(),
      fetchImpl,
      dnsLookup: publicDns,
      smtpTransport: async (input) => {
        smtpSent.push(input);
      },
    });

    // 1. Admin login
    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'TestPassword123!' }),
    });
    expect(loginRes.status).toBe(200);
    const adminCookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0]!;

    // 2. Create normal user, admin updates them, user self-updates username & password
    const createUserRes = await app.request('/api/v1/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'creator_a',
        password: 'OldPassword123',
        role: 'user',
        permissions: ['card:read', 'card:create', 'card:update', 'card:delete'],
      }),
    });
    expect(createUserRes.status).toBe(201);
    const createdUser = (await createUserRes.json()) as { id: string };

    const adminPatchRes = await app.request(
      `/api/v1/admin/users/${createdUser.id}/permissions`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          username: 'creator_b',
          password: 'ResetPassword123',
          permissions: ['card:read', 'card:create', 'card:update', 'card:delete'],
          isActive: true,
        }),
      },
    );
    expect(adminPatchRes.status).toBe(200);

    const userLoginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'creator_b', password: 'ResetPassword123' }),
    });
    expect(userLoginRes.status).toBe(200);
    const userCookie = (userLoginRes.headers.get('set-cookie') ?? '').split(';')[0]!;

    const selfUpdateRes = await app.request('/api/v1/auth/account', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: userCookie },
      body: JSON.stringify({
        currentPassword: 'ResetPassword123',
        newUsername: 'creator_final',
        newPassword: 'FinalPassword123',
      }),
    });
    expect(selfUpdateRes.status).toBe(200);

    const reloginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'creator_final', password: 'FinalPassword123' }),
    });
    expect(reloginRes.status).toBe(200);

    // 3. Reject mismatched model slot capability on /config
    const badCfgRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          apiKey: 'sk-primary',
          baseUrl: 'https://api.openai.com/v1',
          model: 'text-embedding-3-large',
          jsonModeStrategy: 'auto',
        },
        searchProvider: 'none',
        enableLayer1Wiki: true,
        dailyAutoRefreshLimit: 20,
      }),
    });
    expect(badCfgRes.status).toBe(400);

    // Save valid primary slot (without image slot first) -> /images/generate must fail clearly
    await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          apiKey: 'sk-primary',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        searchProvider: 'none',
        enableLayer1Wiki: true,
        dailyAutoRefreshLimit: 20,
      }),
    });

    const missingImgGen = await app.request('/api/v1/images/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ prompt: 'silver hair doctor' }),
    });
    expect(missingImgGen.status).toBe(400);

    // Configure dedicated imageLlm slot -> /images/generate succeeds
    const goodCfgRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          apiKey: 'sk-primary',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        imageLlm: {
          provider: 'openai',
          apiKey: 'sk-image',
          baseUrl: 'https://api.openai.com/v1',
          model: 'dall-e-3',
          jsonModeStrategy: 'auto',
        },
        searchProvider: 'none',
        enableLayer1Wiki: true,
        dailyAutoRefreshLimit: 20,
      }),
    });
    expect(goodCfgRes.status).toBe(200);

    const imgGenRes = await app.request('/api/v1/images/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ prompt: 'silver hair doctor' }),
    });
    expect(imgGenRes.status).toBe(200);
    const imgGenJson = (await imgGenRes.json()) as { imageUrl?: string };
    expect(imgGenJson.imageUrl).toBe('https://cdn.example.com/kaltsit.png');

    // 4. Streaming card generation SSE emits progress + thinking + result
    const streamRes = await app.request('/api/v1/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        cookie: adminCookie,
      },
      body: JSON.stringify({
        mode: 'A',
        cardType: 'sillytavern_v3',
        entityType: 'fictional',
        characterName: '凯尔希',
        workName: '明日方舟',
        referenceText: '罗德岛核心管理者，拥有生物构造体 Mon3tr。',
      }),
    });
    expect(streamRes.status).toBe(200);
    const sseBody = await streamRes.text();
    expect(sseBody).toContain('event: progress');
    expect(sseBody).toContain('event: thinking');
    expect(sseBody).toContain('分析凯尔希的医疗与历史背景');
    expect(sseBody).toContain('event: result');

    const resultLine = sseBody
      .split(/\r?\n\r?\n/)
      .find((b) => b.includes('event: result'));
    expect(resultLine).toBeTruthy();
    const resultDataRaw = resultLine!
      .split(/\r?\n/)
      .find((l) => l.startsWith('data:'))!
      .slice(5)
      .trim();
    const createdCard = (JSON.parse(resultDataRaw) as { card: { id: string } }).card;

    // 5. Derive TRPG D&D 5e attributes & export Foundry VTT JSON + HTML/MD sheets
    const trpgRes = await app.request(`/api/v1/cards/${createdCard.id}/trpg`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ system: 'dnd5e' }),
    });
    expect(trpgRes.status).toBe(200);
    const trpgJson = (await trpgRes.json()) as {
      card: { cardType: string; content: RoleCardContent };
    };
    expect(trpgJson.card.cardType).toBe('trpg_dnd5e');
    const trpgObj = trpgJson.card.content.extensions.trpg as Record<string, unknown>;
    expect(trpgObj.className).toBe('生命牧师 / 智者');

    const foundryExport = await app.request(
      `/api/v1/cards/${createdCard.id}/export?format=foundry_dnd5e_json`,
      { headers: { cookie: adminCookie } },
    );
    expect(foundryExport.status).toBe(200);
    const foundryJson = (await foundryExport.json()) as {
      type: string;
      system: { abilities: { int: { value: number } } };
    };
    expect(foundryJson.type).toBe('character');
    expect(foundryJson.system.abilities.int.value).toBe(19);

    const htmlExport = await app.request(
      `/api/v1/cards/${createdCard.id}/export?format=trpg_sheet_html`,
      { headers: { cookie: adminCookie } },
    );
    expect(htmlExport.status).toBe(200);
    const sheetHtml = await htmlExport.text();
    expect(sheetHtml).toContain('@media print');
    expect(sheetHtml).toContain('Mon3tr 协同召唤');

    // 6. Notification channels CRUD (preserving secrets on blank update) + test + review.pending parallel dispatch
    const smtpCreate = await app.request('/api/v1/notifications/channels', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
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
          smtpPass: 'smtp-secret-pass',
          smtpFrom: 'bot@example.com',
          smtpTo: 'reviewer@example.com',
        },
      }),
    });
    expect(smtpCreate.status).toBe(201);
    const smtpChannel = ((await smtpCreate.json()) as { channel: { id: string } }).channel;

    // Update with blank password -> keeps previous secret intact
    const smtpUpdate = await app.request(`/api/v1/notifications/channels/${smtpChannel.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        name: '审核邮件（已更新）',
        channelType: 'smtp',
        enabled: true,
        events: ['review.pending'],
        settings: {
          smtpHost: 'smtp.example.com',
          smtpPort: 465,
          smtpSecure: true,
          smtpUser: 'bot@example.com',
          smtpPass: '',
          smtpFrom: 'bot@example.com',
          smtpTo: 'reviewer@example.com',
        },
      }),
    });
    expect(smtpUpdate.status).toBe(200);
    const smtpUpdateJson = (await smtpUpdate.json()) as {
      channel: { settingsMasked: { hasSmtpPass: boolean } };
    };
    expect(smtpUpdateJson.channel.settingsMasked.hasSmtpPass).toBe(true);

    // Add Feishu + failing Telegram channel to verify equal-priority non-blocking parallel delivery
    await app.request('/api/v1/notifications/channels', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        name: '飞书审核群',
        channelType: 'feishu',
        enabled: true,
        events: ['review.pending'],
        settings: {
          webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-room',
        },
      }),
    });
    await app.request('/api/v1/notifications/channels', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        name: '异常Telegram',
        channelType: 'telegram',
        enabled: true,
        events: ['review.pending'],
        settings: {
          telegramBotToken: 'bad',
          telegramChatId: '123',
        },
      }),
    });

    const testSmtpRes = await app.request(
      `/api/v1/notifications/channels/${smtpChannel.id}/test`,
      { method: 'POST', headers: { cookie: adminCookie } },
    );
    expect(testSmtpRes.status).toBe(200);
    expect(smtpSent).toHaveLength(1);

    // Trigger manual evolution -> creates pending_review impression -> triggers review.pending -> dispatches SMTP + Feishu in parallel
    const evolveRes = await app.request(`/api/v1/cards/${createdCard.id}/evolve`, {
      method: 'POST',
      headers: { cookie: adminCookie },
    });
    expect(evolveRes.status).toBe(200);

    await new Promise((r) => setTimeout(r, 40));
    expect(smtpSent).toHaveLength(2);
    expect(smtpSent[1]?.subject).toContain('[待审核]');
    expect(webhookHits).toHaveLength(1);
    expect(webhookHits[0]?.body).toContain('凯尔希');

    dbHandle.close();
  });
});
