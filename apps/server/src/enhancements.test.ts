import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDefaultPortraitPng, type DnsLookupPort, type HttpFetchPort, type SmtpSendInput } from '@rolecard/core';
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

  it('supports two-tier proxy persistence/testing, SSE streaming config test, and card-aware portrait prompt generation', async () => {
    const dbHandle = createSqliteDatabase(':memory:');
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: 'AdminTestPassword!99',
    });

    const publicDns: DnsLookupPort = async () => [{ address: '93.184.216.34', family: 4 }];
    const capturedUserPrompts: string[] = [];

    const fetchImpl: HttpFetchPort = async (url, init) => {
      if (url.includes('cp.cloudflare.com/generate_204')) {
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/chat/completions')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          stream?: boolean;
          messages?: Array<{ role: string; content: string }>;
        };
        const joined = body.messages?.map((m) => m.content).join('\n') ?? '';

        if (joined.includes('角色视觉美术总监')) {
          capturedUserPrompts.push(joined);
        }

        if (body.stream) {
          const encoder = new TextEncoder();
          const streamContent = joined.includes('凯尔希') ? JSON.stringify(baseCard) : 'OK';
          const chunks = [
            `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '正在验证 DeepSeek Reasoner 通道...' } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: streamContent }, finish_reason: 'stop' }] })}\n\n`,
            'data: [DONE]\n\n',
          ];
          return new Response(
            new ReadableStream({
              start(controller) {
                for (const c of chunks) controller.enqueue(encoder.encode(c));
                controller.close();
              },
            }),
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          );
        }

        if (joined.includes('角色视觉美术总监')) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      prompt:
                        '1girl, Kaltsit, silver-green long hair, emerald eyes, white medical coat, Rhodes Island clinic',
                      negativePrompt: 'lowres, bad hands, blurry',
                      notes: '结合凯尔希的银绿色长发、翠绿双眸与医生白大褂特征生成立绘提示词。',
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }

        if (joined.includes('凯尔希')) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify(baseCard),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }

        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
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
    });

    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'AdminTestPassword!99' }),
    });
    expect(loginRes.status).toBe(200);
    const adminCookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0]!;

    // 1. Reject invalid proxy URL
    const badProxyRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          apiKey: 'sk-primary-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        proxyConfig: {
          globalEnabled: true,
          globalUrl: 'ftp://bad-proxy.local:21',
          bypassLocal: true,
          overrides: {},
        },
      }),
    });
    expect(badProxyRes.status).toBe(400);
    const badProxyBody = (await badProxyRes.json()) as { error?: { code?: string } };
    expect(badProxyBody.error?.code).toBe('INVALID_PROXY_CONFIG');

    // 2. Save valid two-tier proxy config & check masked output
    const saveCfgRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          apiKey: 'sk-primary-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        proxyConfig: {
          globalEnabled: true,
          globalUrl: 'http://alice:mysecret@127.0.0.1:7897',
          bypassLocal: true,
          overrides: {
            llm_chat: { mode: 'direct', url: '' },
            llm_image: { mode: 'custom', url: 'socks5://bob:imgsecret@127.0.0.1:1080' },
          },
        },
      }),
    });
    expect(saveCfgRes.status).toBe(200);
    const savedCfg = (await saveCfgRes.json()) as {
      proxyConfig: {
        globalEnabled: boolean;
        globalUrlMasked: string | null;
        hasGlobalUrl: boolean;
        overrides: Record<string, { mode: string; urlMasked: string | null; hasUrl: boolean }>;
      };
    };
    expect(savedCfg.proxyConfig.globalEnabled).toBe(true);
    expect(savedCfg.proxyConfig.hasGlobalUrl).toBe(true);
    expect(savedCfg.proxyConfig.globalUrlMasked).toBe('http://alice:****@127.0.0.1:7897');
    expect(savedCfg.proxyConfig.overrides.llm_image?.urlMasked).toBe(
      'socks5://bob:****@127.0.0.1:1080',
    );
    expect(savedCfg.proxyConfig.overrides.llm_chat?.mode).toBe('direct');

    // 3. Re-save with preserveStored flags -> keeps existing proxy URLs intact
    const preserveRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        proxyConfig: {
          globalEnabled: true,
          globalUrl: '',
          preserveStoredGlobalUrl: true,
          bypassLocal: false,
          overrides: {
            llm_chat: { mode: 'direct', url: '' },
            llm_image: { mode: 'custom', url: '', preserveStoredUrl: true },
          },
        },
      }),
    });
    expect(preserveRes.status).toBe(200);
    const preservedCfg = (await preserveRes.json()) as typeof savedCfg;
    expect(preservedCfg.proxyConfig.globalUrlMasked).toBe('http://alice:****@127.0.0.1:7897');
    expect(preservedCfg.proxyConfig.overrides.llm_image?.urlMasked).toBe(
      'socks5://bob:****@127.0.0.1:1080',
    );

    // 4. Test proxy connectivity endpoint (direct plaintext, saved scope, and direct-mode rejection)
    const proxyTestSaved = await app.request('/api/v1/config/proxy/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ useSavedScope: 'global' }),
    });
    expect(proxyTestSaved.status).toBe(200);
    const proxyTestSavedJson = (await proxyTestSaved.json()) as { ok: boolean; status?: number };
    expect(proxyTestSavedJson.ok).toBe(true);
    expect(proxyTestSavedJson.status).toBe(204);

    const proxyTestDirectRejected = await app.request('/api/v1/config/proxy/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ useSavedScope: 'llm_chat' }),
    });
    expect(proxyTestDirectRejected.status).toBe(400);

    // 5. SSE streaming model validation endpoint emits progress, thinking, content, result
    const sseTestRes = await app.request('/api/v1/config/test', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        cookie: adminCookie,
      },
      body: JSON.stringify({
        slotType: 'primary',
        provider: 'deepseek',
        useSavedKeySlot: 'primary',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-reasoner',
      }),
    });
    expect(sseTestRes.status).toBe(200);
    const sseBodyText = await sseTestRes.text();
    expect(sseBodyText).toContain('event: progress');
    expect(sseBodyText).toContain('event: thinking');
    expect(sseBodyText).toContain('正在验证 DeepSeek Reasoner 通道');
    expect(sseBodyText).toContain('event: content');
    expect(sseBodyText).toContain('event: result');

    // 6. Card-aware portrait prompt generation, optimization & imagePrompt persistence
    const createCardRes = await app.request('/api/v1/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        mode: 'A',
        entityType: 'fictional',
        characterName: '凯尔希',
        workName: '明日方舟',
        referenceText: '银绿色长发与翠绿双眸，罗德岛医疗部核心。',
      }),
    });
    expect(createCardRes.status).toBe(201);
    const createdCard = (await createCardRes.json()) as { card: { id: string } };

    const genPromptRes = await app.request('/api/v1/images/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        cardId: createdCard.card.id,
        mode: 'generate',
        style: 'anime',
        instruction: '强调银绿色长发和医疗部氛围',
      }),
    });
    expect(genPromptRes.status).toBe(200);
    const genPromptJson = (await genPromptRes.json()) as {
      prompt: string;
      negativePrompt: string;
      notes: string;
    };
    expect(genPromptJson.prompt).toContain('silver-green long hair');
    expect(genPromptJson.notes).toContain('凯尔希');
    expect(capturedUserPrompts[0]).toContain('银绿色长发与翠绿双眸');
    expect(capturedUserPrompts[0]).toContain('强调银绿色长发和医疗部氛围');

    const optPromptRes = await app.request('/api/v1/images/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        cardId: createdCard.card.id,
        mode: 'optimize',
        style: 'semi_realistic',
        draftPrompt: 'silver hair doctor',
        instruction: '补充冷静锐利的眼神',
      }),
    });
    expect(optPromptRes.status).toBe(200);
    expect(capturedUserPrompts[1]).toContain('silver hair doctor');
    expect(capturedUserPrompts[1]).toContain('补充冷静锐利的眼神');

    const saveImageRes = await app.request(`/api/v1/cards/${createdCard.card.id}/image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        mode: 'search_url',
        imageUrl: 'https://cdn.example.com/kaltsit.png',
        imagePrompt: genPromptJson.prompt,
      }),
    });
    expect(saveImageRes.status).toBe(200);

    const detailRes = await app.request(`/api/v1/cards/${createdCard.card.id}`, {
      headers: { cookie: adminCookie },
    });
    expect(detailRes.status).toBe(200);
    const detailJson = (await detailRes.json()) as { card: { imagePrompt: string | null } };
    expect(detailJson.card.imagePrompt).toBe(genPromptJson.prompt);

    dbHandle.close();
  });

  it('supports 2:3 portrait upload with derived 1:1 token, portrait-source proxy, crop_token update, and vtt_token_png / foundry export', async () => {
    const dbHandle = createSqliteDatabase(':memory:');
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: 'TestPassword123!',
    });

    const publicDns: DnsLookupPort = async () => [{ address: '93.184.216.34', family: 4 }];
    const pngBuf = createDefaultPortraitPng();
    const pngDataUrl = `data:image/png;base64,${pngBuf.toString('base64')}`;

    const fetchImpl: HttpFetchPort = async (url) => {
      if (url === 'https://cdn.example.com/kaltsit-2x3.png') {
        return new Response(new Uint8Array(pngBuf), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response('Not Found', { status: 404 });
    };

    const app = createApp({
      db: dbHandle.db,
      masterKey: randomBytes(32),
      dataDir: ':memory:',
      deploymentMode: 'local',
      memoryUploads: new Map(),
      dnsLookup: publicDns,
      fetchImpl,
    });

    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'TestPassword123!' }),
    });
    expect(loginRes.status).toBe(200);
    const adminCookie = loginRes.headers.get('set-cookie')?.split(';')[0] ?? '';

    const createCardRes = await app.request('/api/v1/cards/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        filename: 'kaltsit.json',
        format: 'json',
        targetCardType: 'general',
        jsonText: JSON.stringify({
          name: baseCard.name,
          description: baseCard.summary,
          personality: baseCard.personality,
          scenario: baseCard.scenario,
          first_mes: baseCard.first_mes,
          mes_example: baseCard.mes_example,
          tags: baseCard.tags,
        }),
      }),
    });
    expect(createCardRes.status).toBe(201);
    const createdJson = (await createCardRes.json()) as { card: { id: string } };
    const cardId = createdJson.card.id;

    // 1. Upload 2:3 portrait alongside derived 1:1 token
    const uploadRes = await app.request(`/api/v1/cards/${cardId}/image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        mode: 'upload',
        dataUrl: pngDataUrl,
        tokenDataUrl: pngDataUrl,
        tokenCrop: { x: 0.08, y: 0.04, size: 0.84 },
      }),
    });
    expect(uploadRes.status).toBe(200);
    const uploadJson = (await uploadRes.json()) as {
      card: {
        imageUrl: string | null;
        tokenImageUrl: string | null;
        tokenCrop: { x: number; y: number; size: number } | null;
      };
    };
    expect(uploadJson.card.imageUrl).toMatch(/^\/uploads\/.*portrait.*\.png$/);
    expect(uploadJson.card.tokenImageUrl).toMatch(/^\/uploads\/.*token.*\.png$/);
    expect(uploadJson.card.tokenCrop).toEqual({ x: 0.08, y: 0.04, size: 0.84 });

    // 2. Same-origin portrait-source serves local upload
    const localSourceRes = await app.request(`/api/v1/cards/${cardId}/portrait-source`, {
      headers: { cookie: adminCookie },
    });
    expect(localSourceRes.status).toBe(200);
    expect(localSourceRes.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await localSourceRes.arrayBuffer()).length).toBe(pngBuf.length);

    // 3. Independent 1:1 crop_token update keeps original imageUrl
    const cropTokenRes = await app.request(`/api/v1/cards/${cardId}/image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        mode: 'crop_token',
        tokenDataUrl: pngDataUrl,
        tokenCrop: { x: 0.15, y: 0.12, size: 0.7 },
      }),
    });
    expect(cropTokenRes.status).toBe(200);
    const cropTokenJson = (await cropTokenRes.json()) as {
      card: {
        imageUrl: string | null;
        tokenImageUrl: string | null;
        tokenCrop: { x: number; y: number; size: number } | null;
      };
    };
    expect(cropTokenJson.card.imageUrl).toBe(uploadJson.card.imageUrl);
    expect(cropTokenJson.card.tokenCrop).toEqual({ x: 0.15, y: 0.12, size: 0.7 });

    // 4. vtt_token_png export & foundry_dnd5e_json export preferring tokenImageUrl
    const tokenExportRes = await app.request(`/api/v1/cards/${cardId}/export?format=vtt_token_png`, {
      headers: { cookie: adminCookie },
    });
    expect(tokenExportRes.status).toBe(200);
    expect(tokenExportRes.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await tokenExportRes.arrayBuffer()).length).toBe(pngBuf.length);

    const foundryExportRes = await app.request(
      `/api/v1/cards/${cardId}/export?format=foundry_dnd5e_json`,
      { headers: { cookie: adminCookie } },
    );
    expect(foundryExportRes.status).toBe(200);
    const foundryActor = (await foundryExportRes.json()) as {
      img?: string;
      prototypeToken?: { texture?: { src?: string } };
    };
    expect(foundryActor.img).toBe(cropTokenJson.card.tokenImageUrl);

    // 5. External search_url portrait-source proxy fetch
    const searchUrlRes = await app.request(`/api/v1/cards/${cardId}/image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        mode: 'search_url',
        imageUrl: 'https://cdn.example.com/kaltsit-2x3.png',
      }),
    });
    expect(searchUrlRes.status).toBe(200);

    const remoteSourceRes = await app.request(`/api/v1/cards/${cardId}/portrait-source`, {
      headers: { cookie: adminCookie },
    });
    expect(remoteSourceRes.status).toBe(200);
    expect(remoteSourceRes.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await remoteSourceRes.arrayBuffer()).length).toBe(pngBuf.length);

    dbHandle.close();
  });

  it('supports search connectivity probe endpoint and single-field AI generation with lock enforcement', async () => {
    const dbHandle = createSqliteDatabase(':memory:');
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: 'TestPassword123!',
    });

    const publicDns: DnsLookupPort = async () => [{ address: '93.184.216.34', family: 4 }];
    const fetchImpl: HttpFetchPort = async (url, init) => {
      if (url.includes('meta=siteinfo')) {
        return new Response(JSON.stringify({ query: { general: { sitename: 'PRTS' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('api.bochaai.com')) {
        const auth = new Headers(init?.headers).get('authorization') ?? '';
        if (!auth.includes('saved-bocha-key')) {
          return new Response('Unauthorized', { status: 401 });
        }
        return new Response(
          JSON.stringify({
            data: {
              webPages: {
                value: [
                  { name: 'Alan Turing Bio', url: 'https://example.com/turing', snippet: 'Mathematician' },
                ],
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/chat/completions')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    value: 'AI 重新生成的角色背景故事：历经漫长岁月与巴别塔变迁的医药学者。',
                  }),
                },
              },
            ],
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
      dnsLookup: publicDns,
      fetchImpl,
    });

    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'TestPassword123!' }),
    });
    expect(loginRes.status).toBe(200);
    const adminCookie = loginRes.headers.get('set-cookie')?.split(';')[0] ?? '';

    // 1. Save config with Bocha search key and primary LLM
    const saveCfgRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          apiKey: 'sk-primary-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        searchProvider: 'bocha',
        searchApiKey: 'saved-bocha-key',
        enableLayer1Wiki: true,
        dailyAutoRefreshLimit: 20,
      }),
    });
    expect(saveCfgRes.status).toBe(200);

    // 2. Test search connectivity using saved key + Layer 1 wiki probe
    const searchOkRes = await app.request('/api/v1/config/search/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        provider: 'bocha',
        useSavedKey: true,
        testLayer1Wiki: true,
      }),
    });
    expect(searchOkRes.status).toBe(200);
    const searchOkJson = (await searchOkRes.json()) as {
      ok: boolean;
      hitCount: number;
      sampleTitles: string[];
      layer1Reachable?: boolean;
    };
    expect(searchOkJson.ok).toBe(true);
    expect(searchOkJson.hitCount).toBe(1);
    expect(searchOkJson.sampleTitles).toContain('Alan Turing Bio');
    expect(searchOkJson.layer1Reachable).toBe(true);

    const searchBadRes = await app.request('/api/v1/config/search/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        provider: 'bocha',
        apiKey: 'wrong-key',
      }),
    });
    expect(searchBadRes.status).toBe(502);
    const searchBadJson = (await searchBadRes.json()) as { ok: boolean; error?: string };
    expect(searchBadJson.ok).toBe(false);
    expect(searchBadJson.error).toContain('401');

    // 3. Import a card, lock personality, and test single-field AI generation
    const importRes = await app.request('/api/v1/cards/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        filename: 'kaltsit.json',
        format: 'json',
        targetCardType: 'general',
        jsonText: JSON.stringify({
          name: baseCard.name,
          description: baseCard.summary,
          personality: baseCard.personality,
          scenario: baseCard.scenario,
          first_mes: baseCard.first_mes,
          mes_example: baseCard.mes_example,
          tags: baseCard.tags,
        }),
      }),
    });
    expect(importRes.status).toBe(201);
    const imported = (await importRes.json()) as {
      card: { id: string; version: number; content: RoleCardContent };
    };

    const lockRes = await app.request(`/api/v1/cards/${imported.card.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        content: imported.card.content,
        lockedFields: ['personality'],
      }),
    });
    expect(lockRes.status).toBe(200);

    const lockedGenRes = await app.request(`/api/v1/cards/${imported.card.id}/generate-field`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ field: 'personality' }),
    });
    expect(lockedGenRes.status).toBe(400);
    const lockedGenJson = (await lockedGenRes.json()) as { error?: { code?: string } };
    expect(lockedGenJson.error?.code).toBe('FIELD_LOCKED');

    const bgGenRes = await app.request(`/api/v1/cards/${imported.card.id}/generate-field`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ field: 'background' }),
    });
    expect(bgGenRes.status).toBe(200);
    const bgGenJson = (await bgGenRes.json()) as {
      field: string;
      card: { version: number; content: RoleCardContent };
    };
    expect(bgGenJson.field).toBe('background');
    expect(bgGenJson.card.content.background).toContain('AI 重新生成的角色背景故事');
    expect(bgGenJson.card.version).toBeGreaterThan(imported.card.version);

    dbHandle.close();
  });

  it('supports portrait style preset CRUD, per-user custom isolation, shared built-ins, reset, and prompt override', async () => {
    const dbHandle = createSqliteDatabase(':memory:');
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: 'TestPassword123!',
    });

    const capturedSystemMessages: string[] = [];
    const fetchImpl: HttpFetchPort = async (url, init) => {
      if (url.endsWith('/chat/completions')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          messages?: Array<{ role?: string; content?: string }>;
        };
        const sys = body.messages?.find((m) => m.role === 'system')?.content ?? '';
        capturedSystemMessages.push(sys);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    prompt: '1girl, Kaltsit, photorealistic portrait',
                    negativePrompt: 'anime, cartoon',
                    notes: '按选定画风预设提炼英文提示词。',
                  }),
                },
              },
            ],
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
    });

    const loginAdminRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'TestPassword123!' }),
    });
    expect(loginAdminRes.status).toBe(200);
    const adminCookie = loginAdminRes.headers.get('set-cookie')?.split(';')[0] ?? '';

    // Configure primary LLM & create a second user to verify per-user custom preset isolation
    const saveCfgRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          apiKey: 'sk-primary-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        searchProvider: 'none',
        enableLayer1Wiki: true,
        dailyAutoRefreshLimit: 20,
      }),
    });
    expect(saveCfgRes.status).toBe(200);

    const createUserBRes = await app.request('/api/v1/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'artist_b',
        password: 'AdminTestPassword!99',
        role: 'user',
        permissions: ['card:read', 'card:update'],
      }),
    });
    expect(createUserBRes.status).toBe(201);

    const loginUserBRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'artist_b', password: 'AdminTestPassword!99' }),
    });
    expect(loginUserBRes.status).toBe(200);
    const userBCookie = loginUserBRes.headers.get('set-cookie')?.split(';')[0] ?? '';

    // 1. Built-in presets include blank + realistic + original 6
    const listAdmin1 = await app.request('/api/v1/images/styles', {
      headers: { cookie: adminCookie },
    });
    expect(listAdmin1.status).toBe(200);
    const listAdmin1Json = (await listAdmin1.json()) as {
      styles: Array<{ id: string; name: string; stylePrompt: string; isBuiltin: boolean; isCustomized: boolean }>;
    };
    expect(listAdmin1Json.styles.some((s) => s.id === 'blank' && s.stylePrompt === '')).toBe(true);
    expect(listAdmin1Json.styles.some((s) => s.id === 'realistic' && s.isBuiltin)).toBe(true);
    expect(listAdmin1Json.styles).toHaveLength(8);

    // 2. Admin creates a custom style preset (isolated to admin)
    const createCustomRes = await app.request('/api/v1/images/styles', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        name: '管理员赛博水墨',
        stylePrompt: 'cyberpunk Chinese ink wash painting, neon rain',
        negativePromptHint: '3d render',
        instructionHint: '仰视构图',
      }),
    });
    expect(createCustomRes.status).toBe(201);
    const createdCustom = (await createCustomRes.json()) as {
      style: { id: string; name: string; isBuiltin: boolean };
    };
    expect(createdCustom.style.isBuiltin).toBe(false);

    // User B cannot see, modify, or delete admin's custom style, but shares built-in presets
    const listUserBRes = await app.request('/api/v1/images/styles', {
      headers: { cookie: userBCookie },
    });
    expect(listUserBRes.status).toBe(200);
    const listUserBJson = (await listUserBRes.json()) as {
      styles: Array<{ id: string }>;
    };
    expect(listUserBJson.styles.some((s) => s.id === createdCustom.style.id)).toBe(false);
    expect(listUserBJson.styles.some((s) => s.id === 'realistic')).toBe(true);

    const forbiddenPutRes = await app.request(`/api/v1/images/styles/${createdCustom.style.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: userBCookie },
      body: JSON.stringify({ name: '窃取名称' }),
    });
    expect(forbiddenPutRes.status).toBe(403);

    const forbiddenDelRes = await app.request(`/api/v1/images/styles/${createdCustom.style.id}`, {
      method: 'DELETE',
      headers: { cookie: userBCookie },
    });
    expect(forbiddenDelRes.status).toBe(403);

    // 3. Admin renames custom style and uses it for prompt generation
    const renameRes = await app.request(`/api/v1/images/styles/${createdCustom.style.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ name: '管理员新水墨风' }),
    });
    expect(renameRes.status).toBe(200);
    const renameJson = (await renameRes.json()) as { style: { name: string } };
    expect(renameJson.style.name).toBe('管理员新水墨风');

    const promptCustomRes = await app.request('/api/v1/images/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        mode: 'generate',
        stylePresetId: createdCustom.style.id,
        characterName: '凯尔希',
      }),
    });
    expect(promptCustomRes.status).toBe(200);
    expect(capturedSystemMessages[0]).toContain('cyberpunk Chinese ink wash painting');

    // Blank/free override clears stylePrompt constraint
    const promptBlankRes = await app.request('/api/v1/images/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        mode: 'generate',
        stylePresetId: 'realistic',
        customStylePrompt: '',
        customNegativeHint: '',
        characterName: '凯尔希',
        instruction: '纯手绘儿童绘本风格',
      }),
    });
    expect(promptBlankRes.status).toBe(200);
    expect(capturedSystemMessages[1]).toContain('自由风格');
    expect(capturedSystemMessages[1]).not.toContain('photorealistic character portrait');

    // 4. Built-in preset can be edited directly, protected from deletion, and reset to default
    const editBuiltinRes = await app.request('/api/v1/images/styles/realistic', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        stylePrompt: 'film grain 35mm Leica street portrait, natural daylight',
      }),
    });
    expect(editBuiltinRes.status).toBe(200);
    const editBuiltinJson = (await editBuiltinRes.json()) as {
      style: { isCustomized: boolean; stylePrompt: string };
    };
    expect(editBuiltinJson.style.isCustomized).toBe(true);
    expect(editBuiltinJson.style.stylePrompt).toContain('35mm Leica');

    const delBuiltinRes = await app.request('/api/v1/images/styles/realistic', {
      method: 'DELETE',
      headers: { cookie: adminCookie },
    });
    expect(delBuiltinRes.status).toBe(400);
    const delBuiltinJson = (await delBuiltinRes.json()) as { error?: { code?: string } };
    expect(delBuiltinJson.error?.code).toBe('BUILTIN_STYLE_PROTECTED');

    const resetBuiltinRes = await app.request('/api/v1/images/styles/realistic/reset', {
      method: 'POST',
      headers: { cookie: adminCookie },
    });
    expect(resetBuiltinRes.status).toBe(200);
    const resetBuiltinJson = (await resetBuiltinRes.json()) as {
      style: { isCustomized: boolean; stylePrompt: string };
    };
    expect(resetBuiltinJson.style.isCustomized).toBe(false);
    expect(resetBuiltinJson.style.stylePrompt).toContain('photorealistic character portrait');

    // 5. Admin deletes their custom style
    const delCustomRes = await app.request(`/api/v1/images/styles/${createdCustom.style.id}`, {
      method: 'DELETE',
      headers: { cookie: adminCookie },
    });
    expect(delCustomRes.status).toBe(200);

    dbHandle.close();
  });

  it('supports TUN Fake-IP toggle and env proxy fallback in config and image search routes', async () => {
    const dbHandle = createSqliteDatabase(':memory:');
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: 'TestPassword123!',
    });

    const fakeIpDns: DnsLookupPort = async () => [{ address: '198.18.3.185', family: 4 }];
    const fetchImpl: HttpFetchPort = async (url) => {
      if (url.includes('cp.cloudflare.com/generate_204')) {
        return new Response(null, { status: 204 });
      }
      if (url.includes('commons.wikimedia.org/w/api.php')) {
        return new Response(
          JSON.stringify({
            query: {
              pages: {
                '42': {
                  pageid: 42,
                  title: 'File:Kaltsit_portrait.png',
                  imageinfo: [
                    {
                      url: 'https://upload.wikimedia.org/wikipedia/commons/4/42/Kaltsit.png',
                      thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Kaltsit.png',
                      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Kaltsit_portrait.png',
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
      return new Response('{}', { status: 404 });
    };

    const app = createApp({
      db: dbHandle.db,
      masterKey: randomBytes(32),
      dataDir: ':memory:',
      deploymentMode: 'local',
      memoryUploads: new Map(),
      dnsLookup: fakeIpDns,
      fetchImpl,
      env: {
        HTTPS_PROXY: 'http://envuser:envpass@127.0.0.1:7897',
      },
    });

    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'TestPassword123!' }),
    });
    expect(loginRes.status).toBe(200);
    const adminCookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    // 1. Save proxyConfig with useEnvProxy=false and allowFakeIp=false -> Fake-IP search is blocked with guidance
    const saveBlockedRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          apiKey: 'sk-primary-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        proxyConfig: {
          globalEnabled: false,
          globalUrl: '',
          bypassLocal: true,
          allowFakeIp: false,
          useEnvProxy: false,
          overrides: {},
        },
      }),
    });
    expect(saveBlockedRes.status).toBe(200);
    const saveBlockedJson = (await saveBlockedRes.json()) as {
      proxyConfig: { allowFakeIp: boolean; useEnvProxy: boolean; envProxyDetected: string | null };
    };
    expect(saveBlockedJson.proxyConfig.allowFakeIp).toBe(false);
    expect(saveBlockedJson.proxyConfig.useEnvProxy).toBe(false);
    expect(saveBlockedJson.proxyConfig.envProxyDetected).toBe('http://envuser:****@127.0.0.1:7897');

    const searchBlockedRes = await app.request('/api/v1/images/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ query: 'Kaltsit', limit: 4 }),
    });
    expect(searchBlockedRes.status).toBe(400);
    const searchBlockedJson = (await searchBlockedRes.json()) as { error?: { code?: string; message?: string } };
    expect(searchBlockedJson.error?.code).toBe('SSRF_IP_BLOCKED');
    expect(searchBlockedJson.error?.message).toContain('198.18.3.185');
    expect(searchBlockedJson.error?.message).toContain('TUN/Fake-IP');

    // 2. Enable allowFakeIp=true (still without proxy) -> Fake-IP image search succeeds
    const saveFakeIpRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        proxyConfig: {
          globalEnabled: false,
          globalUrl: '',
          bypassLocal: true,
          allowFakeIp: true,
          useEnvProxy: false,
          overrides: {},
        },
      }),
    });
    expect(saveFakeIpRes.status).toBe(200);

    const searchFakeIpRes = await app.request('/api/v1/images/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ query: 'Kaltsit', limit: 4 }),
    });
    expect(searchFakeIpRes.status).toBe(200);
    const searchFakeIpJson = (await searchFakeIpRes.json()) as { items: Array<{ title: string }> };
    expect(searchFakeIpJson.items).toHaveLength(1);
    expect(searchFakeIpJson.items[0]?.title).toContain('Kaltsit_portrait');

    // 3. Disable allowFakeIp but enable useEnvProxy=true -> falls back to HTTPS_PROXY from env
    const saveEnvProxyRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        proxyConfig: {
          globalEnabled: false,
          globalUrl: '',
          bypassLocal: true,
          allowFakeIp: false,
          useEnvProxy: true,
          overrides: {},
        },
      }),
    });
    expect(saveEnvProxyRes.status).toBe(200);

    const searchEnvProxyRes = await app.request('/api/v1/images/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ query: 'Kaltsit', limit: 4 }),
    });
    expect(searchEnvProxyRes.status).toBe(200);

    const testEnvScopeRes = await app.request('/api/v1/config/proxy/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ useSavedScope: 'media' }),
    });
    expect(testEnvScopeRes.status).toBe(200);
    const testEnvScopeJson = (await testEnvScopeRes.json()) as { ok: boolean; status?: number };
    expect(testEnvScopeJson.ok).toBe(true);
    expect(testEnvScopeJson.status).toBe(204);

    dbHandle.close();
  });

  it('proxies remote search thumbnails and portrait URLs via GET /api/v1/images/proxy', async () => {
    const dbHandle = createSqliteDatabase(':memory:');
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: 'TestPassword123!',
    });

    const pngBuf = createDefaultPortraitPng();
    const publicDns: DnsLookupPort = async (host) => {
      if (host === '127.0.0.1' || host === 'localhost') {
        return [{ address: '127.0.0.1', family: 4 }];
      }
      return [{ address: '93.184.216.34', family: 4 }];
    };

    const fetchImpl: HttpFetchPort = async (url) => {
      if (url === 'https://upload.wikimedia.org/wikipedia/commons/thumb/amiya.png') {
        return new Response(new Uint8Array(pngBuf), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      if (url === 'https://upload.wikimedia.org/wikipedia/commons/not-image.html') {
        return new Response('<html>error</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (url === 'https://upload.wikimedia.org/wikipedia/commons/throttled.png') {
        return new Response('rate limited', { status: 429 });
      }
      return new Response('Not Found', { status: 404 });
    };

    const app = createApp({
      db: dbHandle.db,
      masterKey: randomBytes(32),
      dataDir: ':memory:',
      deploymentMode: 'local',
      memoryUploads: new Map(),
      dnsLookup: publicDns,
      fetchImpl,
      env: {},
    });

    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'TestPassword123!' }),
    });
    expect(loginRes.status).toBe(200);
    const adminCookie = loginRes.headers.get('set-cookie')?.split(';')[0] ?? '';

    // 1. Missing or invalid URL rejected
    const missingUrlRes = await app.request('/api/v1/images/proxy', {
      headers: { cookie: adminCookie },
    });
    expect(missingUrlRes.status).toBe(400);

    // 2. Private IP SSRF rejected
    const ssrfRes = await app.request(
      `/api/v1/images/proxy?url=${encodeURIComponent('http://127.0.0.1:8080/secret.png')}`,
      { headers: { cookie: adminCookie } },
    );
    expect(ssrfRes.status).toBe(400);

    // 3. Valid remote image proxied with nosniff + cache headers
    const okRes = await app.request(
      `/api/v1/images/proxy?url=${encodeURIComponent('https://upload.wikimedia.org/wikipedia/commons/thumb/amiya.png')}`,
      { headers: { cookie: adminCookie } },
    );
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get('content-type')).toBe('image/png');
    expect(okRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(okRes.headers.get('cache-control')).toContain('max-age=600');
    expect(Buffer.from(await okRes.arrayBuffer())).toEqual(pngBuf);

    // 4. Non-image response rejected
    const badMagicRes = await app.request(
      `/api/v1/images/proxy?url=${encodeURIComponent('https://upload.wikimedia.org/wikipedia/commons/not-image.html')}`,
      { headers: { cookie: adminCookie } },
    );
    expect(badMagicRes.status).toBe(400);

    // 5. Upstream 429 propagated cleanly
    const throttledRes = await app.request(
      `/api/v1/images/proxy?url=${encodeURIComponent('https://upload.wikimedia.org/wikipedia/commons/throttled.png')}`,
      { headers: { cookie: adminCookie } },
    );
    expect(throttledRes.status).toBe(429);

    dbHandle.close();
  });

  it('supports free preset providers, negativePrompt forwarding, and server-side image dataUrl localization', async () => {
    const dbHandle = createSqliteDatabase(':memory:');
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: 'TestPassword123!',
    });

    const pngBuf = createDefaultPortraitPng();
    const publicDns: DnsLookupPort = async () => [{ address: '93.184.216.34', family: 4 }];
    let capturedImagePayload: Record<string, unknown> = {};

    const fetchImpl: HttpFetchPort = async (url, init) => {
      if (url === 'https://api.siliconflow.cn/v1/images/generations') {
        capturedImagePayload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            images: [{ url: 'https://sf-oss.example.com/generated-portrait.png' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url === 'https://sf-oss.example.com/generated-portrait.png') {
        return new Response(new Uint8Array(pngBuf), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response('Not Found', { status: 404 });
    };

    const app = createApp({
      db: dbHandle.db,
      masterKey: randomBytes(32),
      dataDir: ':memory:',
      deploymentMode: 'local',
      memoryUploads: new Map(),
      dnsLookup: publicDns,
      fetchImpl,
      env: {},
    });

    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'TestPassword123!' }),
    });
    expect(loginRes.status).toBe(200);
    const adminCookie = loginRes.headers.get('set-cookie')?.split(';')[0] ?? '';

    // Save Zhipu + SiliconFlow mixed free preset config
    const saveCfgRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'zhipu',
          apiKey: 'zhipu-test-key',
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          model: 'glm-4.7-flash',
          jsonModeStrategy: 'auto',
        },
        visionLlm: {
          provider: 'zhipu',
          apiKey: 'zhipu-test-key',
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          model: 'glm-4.6v-flash',
          jsonModeStrategy: 'auto',
        },
        imageLlm: {
          provider: 'siliconflow',
          apiKey: 'sf-test-key',
          baseUrl: 'https://api.siliconflow.cn/v1',
          model: 'Kwai-Kolors/Kolors',
          jsonModeStrategy: 'auto',
        },
      }),
    });
    expect(saveCfgRes.status).toBe(200);

    const genImgRes = await app.request('/api/v1/images/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        prompt: '1girl, Kaltsit, anime style',
        negativePrompt: 'lowres, bad anatomy',
        size: '1024x1536',
      }),
    });
    expect(genImgRes.status).toBe(200);
    const genImgJson = (await genImgRes.json()) as { dataUrl?: string; imageUrl?: string };
    expect(genImgJson.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(capturedImagePayload.image_size).toBe('960x1280');
    expect(capturedImagePayload.negative_prompt).toBe('lowres, bad anatomy');

    dbHandle.close();
  });

  it('supports adding/searching/deleting sources on existing cards and injecting selected sources into refine & generate-field', async () => {
    const dbHandle = createSqliteDatabase(':memory:');
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: 'TestPassword123!',
    });

    const publicDns: DnsLookupPort = async (host) => {
      if (host === '127.0.0.1' || host === 'localhost') {
        return [{ address: '127.0.0.1', family: 4 }];
      }
      return [{ address: '93.184.216.34', family: 4 }];
    };

    const capturedLlmPrompts: string[] = [];
    const fetchImpl: HttpFetchPort = async (url, init) => {
      if (url === 'https://lore.example.com/kaltsit-update') {
        return new Response(
          '<html><head><title>凯尔希巴别塔补充档案</title></head><body><article><h1>凯尔希巴别塔补充档案</h1><p>凯尔希曾长期担任巴别塔的核心顾问与医疗部门负责人。</p></article></body></html>',
          { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      if (url.includes('prts.wiki/api.php') && url.includes('list=search')) {
        return new Response(
          JSON.stringify({
            query: {
              search: [{ pageid: 101, title: '凯尔希' }],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('prts.wiki/api.php') && url.includes('extracts')) {
        return new Response(
          JSON.stringify({
            query: {
              pages: {
                '101': {
                  pageid: 101,
                  title: '凯尔希',
                  extract: 'PRTS 检索摘录：凯尔希与 Mon3tr 共同守护罗德岛核心秘密。'.repeat(8),
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('api.bochaai.com')) {
        return new Response(
          JSON.stringify({
            data: {
              webPages: {
                value: [
                  {
                    name: '凯尔希最新剧情解析',
                    url: 'https://news.example.com/kaltsit-15',
                    snippet: '第十五章中凯尔希揭示了更多源石计划的真相。',
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/chat/completions')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          messages?: Array<{ role?: string; content?: string }>;
        };
        const joined = body.messages?.map((m) => m.content ?? '').join('\n') ?? '';
        capturedLlmPrompts.push(joined);

        if (joined.includes('角色卡局部微调专家')) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      ...baseCard,
                      personality: '会被锁定还原的性格',
                      background: '已结合巴别塔档案与第十五章解析更新背景。',
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
                    value: '已参考指定考据重写的作者备注。',
                  }),
                },
              },
            ],
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
      dnsLookup: publicDns,
      fetchImpl,
    });

    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'TestPassword123!' }),
    });
    expect(loginRes.status).toBe(200);
    const adminCookie = loginRes.headers.get('set-cookie')?.split(';')[0] ?? '';

    const cfgRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          apiKey: 'sk-primary-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        searchProvider: 'bocha',
        searchApiKey: 'saved-bocha-key',
        enableLayer1Wiki: true,
      }),
    });
    expect(cfgRes.status).toBe(200);

    // 1. Import an existing card and lock personality
    const importRes = await app.request('/api/v1/cards/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        filename: 'kaltsit.json',
        format: 'json',
        targetCardType: 'general',
        jsonText: JSON.stringify({
          name: baseCard.name,
          description: baseCard.summary,
          personality: baseCard.personality,
          scenario: baseCard.scenario,
          first_mes: baseCard.first_mes,
          mes_example: baseCard.mes_example,
          tags: baseCard.tags,
        }),
      }),
    });
    expect(importRes.status).toBe(201);
    const imported = (await importRes.json()) as {
      card: { id: string; content: RoleCardContent; sources: Array<{ title: string }> };
    };
    const cardId = imported.card.id;
    const initialCount = imported.card.sources.length;

    await app.request(`/api/v1/cards/${cardId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        content: imported.card.content,
        lockedFields: ['personality'],
      }),
    });

    // 2. Reject SSRF private URL on POST /sources
    const ssrfSourceRes = await app.request(`/api/v1/cards/${cardId}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ urls: ['http://127.0.0.1:8080/internal'] }),
    });
    expect(ssrfSourceRes.status).toBe(400);

    // 3. Add manual text + public URL source
    const addSourceRes = await app.request(`/api/v1/cards/${cardId}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        textSources: [{ title: '手动补充台词', content: '阿米娅，现状不允许我们犹豫。' }],
        urls: ['https://lore.example.com/kaltsit-update'],
      }),
    });
    expect(addSourceRes.status).toBe(200);
    const addSourceJson = (await addSourceRes.json()) as {
      addedCount: number;
      card: { sources: Array<{ title: string; snippet: string; origin: string }> };
    };
    expect(addSourceJson.addedCount).toBe(2);
    expect(addSourceJson.card.sources).toHaveLength(initialCount + 2);
    expect(addSourceJson.card.sources[initialCount + 1]?.title).toContain('凯尔希巴别塔补充档案');

    // Duplicate addition is deduped
    const dupRes = await app.request(`/api/v1/cards/${cardId}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        textSources: [{ title: '手动补充台词', content: '阿米娅，现状不允许我们犹豫。' }],
      }),
    });
    expect(dupRes.status).toBe(200);
    const dupJson = (await dupRes.json()) as { addedCount: number };
    expect(dupJson.addedCount).toBe(0);

    // 4. Online search preview (appendToCard: false) and adopt selected entries
    const searchRes = await app.request(`/api/v1/cards/${cardId}/sources/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        query: '凯尔希 明日方舟',
        deepSearch: true,
        appendToCard: false,
      }),
    });
    expect(searchRes.status).toBe(200);
    const searchJson = (await searchRes.json()) as {
      layer1Hits: number;
      layer2Hits: number;
      sources: Array<{ title: string; snippet: string; origin: string; url?: string; provider?: string }>;
    };
    expect(searchJson.layer1Hits).toBeGreaterThanOrEqual(1);
    expect(searchJson.layer2Hits).toBe(1);

    const adoptSearchRes = await app.request(`/api/v1/cards/${cardId}/sources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ entries: searchJson.sources }),
    });
    expect(adoptSearchRes.status).toBe(200);
    const adoptSearchJson = (await adoptSearchRes.json()) as {
      addedCount: number;
      card: { sources: Array<{ title: string }> };
    };
    expect(adoptSearchJson.addedCount).toBe(searchJson.sources.length);

    // 5. Refine card using explicit sourceIndices pointing to the URL source and verify prompt injection + locked field preservation
    const refineRes = await app.request(`/api/v1/cards/${cardId}/refine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        instruction: '结合参考资料更新背景',
        sourceIndices: [initialCount + 1],
      }),
    });
    expect(refineRes.status).toBe(200);
    const refineJson = (await refineRes.json()) as {
      card: { content: RoleCardContent };
    };
    expect(capturedLlmPrompts[0]).toContain('凯尔希巴别塔补充档案');
    expect(capturedLlmPrompts[0]).not.toContain('手动补充台词');
    expect(refineJson.card.content.personality).toBe(baseCard.personality);
    expect(refineJson.card.content.background).toContain('第十五章解析');

    // 6. Generate single field using explicit sourceIndices pointing to the manual text source
    const fieldRes = await app.request(`/api/v1/cards/${cardId}/generate-field`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        field: 'creator_notes',
        sourceIndices: [initialCount],
      }),
    });
    expect(fieldRes.status).toBe(200);
    expect(capturedLlmPrompts[1]).toContain('手动补充台词');
    expect(capturedLlmPrompts[1]).not.toContain('凯尔希巴别塔补充档案');

    // 7. Delete a source entry and verify invalid index returns 400
    const delBadRes = await app.request(`/api/v1/cards/${cardId}/sources/999`, {
      method: 'DELETE',
      headers: { cookie: adminCookie },
    });
    expect(delBadRes.status).toBe(400);

    const beforeCount = adoptSearchJson.card.sources.length;
    const delOkRes = await app.request(`/api/v1/cards/${cardId}/sources/0`, {
      method: 'DELETE',
      headers: { cookie: adminCookie },
    });
    expect(delOkRes.status).toBe(200);
    const delOkJson = (await delOkRes.json()) as { card: { sources: unknown[] } };
    expect(delOkJson.card.sources).toHaveLength(beforeCount - 1);

    dbHandle.close();
  });

  it('persists llmRequestTimeoutSeconds & llmMaxTokens and streams SSE thinking on refine & generate-field', async () => {
    const dbHandle = createSqliteDatabase(':memory:');
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: 'TestPassword123!',
    });

    let capturedMaxTokens: number | undefined;
    const fetchImpl: HttpFetchPort = async (url, init) => {
      if (url.endsWith('/chat/completions')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          stream?: boolean;
          max_tokens?: number;
          messages?: Array<{ role?: string; content?: string }>;
        };
        capturedMaxTokens = body.max_tokens;
        const prompt = body.messages?.map((m) => m.content ?? '').join('\n') ?? '';

        const payloadObj = prompt.includes('角色卡局部微调专家')
          ? { ...baseCard, summary: 'SSE 微调后的新简介' }
          : { value: 'SSE 生成的性格特征内容' };

        if (body.stream) {
          const encoder = new TextEncoder();
          const chunks = [
            `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '先分析角色性格与语境。' } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(payloadObj) }, finish_reason: 'stop' }] })}\n\n`,
            'data: [DONE]\n\n',
          ];
          return new Response(
            new ReadableStream({
              start(controller) {
                for (const c of chunks) controller.enqueue(encoder.encode(c));
                controller.close();
              },
            }),
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          );
        }

        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(payloadObj) }, finish_reason: 'stop' }],
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
    });

    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'TestPassword123!' }),
    });
    expect(loginRes.status).toBe(200);
    const adminCookie = loginRes.headers.get('set-cookie')?.split(';')[0] ?? '';

    // 1. Reject out-of-range timeout / maxTokens
    const invalidCfgRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          apiKey: 'sk-primary-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        llmRequestTimeoutSeconds: 5,
        llmMaxTokens: 100,
      }),
    });
    expect(invalidCfgRes.status).toBe(400);

    // 2. Save valid llmRequestTimeoutSeconds & llmMaxTokens and verify GET /config round-trip
    const saveCfgRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          apiKey: 'sk-primary-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        llmRequestTimeoutSeconds: 420,
        llmMaxTokens: 24576,
      }),
    });
    expect(saveCfgRes.status).toBe(200);
    const savedCfgJson = (await saveCfgRes.json()) as {
      llmRequestTimeoutSeconds: number;
      llmMaxTokens: number;
    };
    expect(savedCfgJson.llmRequestTimeoutSeconds).toBe(420);
    expect(savedCfgJson.llmMaxTokens).toBe(24576);

    const getCfgRes = await app.request('/api/v1/config', {
      headers: { cookie: adminCookie },
    });
    expect(getCfgRes.status).toBe(200);
    const getCfgJson = (await getCfgRes.json()) as {
      llmRequestTimeoutSeconds: number;
      llmMaxTokens: number;
    };
    expect(getCfgJson.llmRequestTimeoutSeconds).toBe(420);
    expect(getCfgJson.llmMaxTokens).toBe(24576);

    // 3. Import card and test SSE streaming on /refine & /generate-field
    const importRes = await app.request('/api/v1/cards/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        filename: 'kaltsit.json',
        format: 'json',
        targetCardType: 'general',
        jsonText: JSON.stringify({
          name: baseCard.name,
          description: baseCard.summary,
          personality: baseCard.personality,
          scenario: baseCard.scenario,
          first_mes: baseCard.first_mes,
          mes_example: baseCard.mes_example,
          tags: baseCard.tags,
        }),
      }),
    });
    expect(importRes.status).toBe(201);
    const imported = (await importRes.json()) as { card: { id: string } };

    const refineSseRes = await app.request(`/api/v1/cards/${imported.card.id}/refine`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        cookie: adminCookie,
      },
      body: JSON.stringify({ instruction: '强化角色简介表述' }),
    });
    expect(refineSseRes.status).toBe(200);
    expect(refineSseRes.headers.get('content-type')).toContain('text/event-stream');
    const refineSseText = await refineSseRes.text();
    expect(refineSseText).toContain('event: progress');
    expect(refineSseText).toContain('event: thinking');
    expect(refineSseText).toContain('先分析角色性格与语境');
    expect(refineSseText).toContain('event: result');
    expect(refineSseText).toContain('SSE 微调后的新简介');
    expect(capturedMaxTokens).toBe(24576);

    const fieldSseRes = await app.request(`/api/v1/cards/${imported.card.id}/generate-field`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        cookie: adminCookie,
      },
      body: JSON.stringify({ field: 'personality' }),
    });
    expect(fieldSseRes.status).toBe(200);
    expect(fieldSseRes.headers.get('content-type')).toContain('text/event-stream');
    const fieldSseText = await fieldSseRes.text();
    expect(fieldSseText).toContain('event: progress');
    expect(fieldSseText).toContain('event: thinking');
    expect(fieldSseText).toContain('先分析角色性格与语境');
    expect(fieldSseText).toContain('event: result');
    expect(fieldSseText).toContain('SSE 生成的性格特征内容');

    dbHandle.close();
  });

  it('supports AI tag append-dedupe, TRPG SSE thinking & manual edit, compress TRPG exemption, whole-card regenerate, and revision rollback', async () => {
    const dbHandle = createSqliteDatabase(':memory:');
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: 'TestPassword123!',
    });

    const trpgData = {
      system: 'Call of Cthulhu 7e',
      occupation: '医药学者',
      era: '泰拉历',
      characteristics: { STR: 45, CON: 60, SIZ: 50, DEX: 65, APP: 70, INT: 95, POW: 90, EDU: 95 },
      derived: { HP: 11, MP: 18, SAN: 80, Luck: 55, Move: 8 },
      keySkills: ['医学 85%', '神秘学 80%'],
    };

    const fetchImpl: HttpFetchPort = async (url, init) => {
      if (url.endsWith('/chat/completions')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          stream?: boolean;
          messages?: Array<{ role?: string; content?: string }>;
        };
        const sys = body.messages?.find((m) => m.role === 'system')?.content ?? '';
        const joined = body.messages?.map((m) => m.content ?? '').join('\n') ?? '';

        let payloadObj: Record<string, unknown>;
        let thinkingText = '';

        if (sys.includes('目标区块：角色标签')) {
          payloadObj = { value: ['#罗德岛', '医疗', '泰拉学者', 'Mon3tr'] };
          thinkingText = '提炼角色标签...';
        } else if (sys.includes('目标区块：开场白')) {
          payloadObj = { value: '统一文案后的新开场白，博士。' };
          thinkingText = '设计角色开场白...';
        } else if (sys.includes('TRPG 规则构筑师')) {
          payloadObj = { trpg: trpgData };
          thinkingText = '推演 CoC 7e 调查员属性与衍生数值...';
        } else if (sys.includes('资深角色卡重构专家')) {
          payloadObj = {
            ...baseCard,
            summary: '一键重生成后的简介',
            personality: '被模型擅自改动的性格（应被锁定保护）',
            first_mes: '一键重生成后的开场白',
            tags: ['重生成标签'],
          };
          thinkingText = '协同重写所有未锁定区块...';
        } else if (sys.includes('语义精简专家')) {
          expect(joined).not.toContain('医药学者');
          payloadObj = {
            ...baseCard,
            summary: '语义精简后的简介',
          };
        } else {
          payloadObj = { value: '生成结果' };
        }

        if (body.stream) {
          const encoder = new TextEncoder();
          const chunks = [
            `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: thinkingText || '思考中...' } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(payloadObj) }, finish_reason: 'stop' }] })}\n\n`,
            'data: [DONE]\n\n',
          ];
          return new Response(
            new ReadableStream({
              start(controller) {
                for (const c of chunks) controller.enqueue(encoder.encode(c));
                controller.close();
              },
            }),
            { status: 200, headers: { 'content-type': 'text/event-stream' } },
          );
        }

        return new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(payloadObj) }, finish_reason: 'stop' }],
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
    });

    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'TestPassword123!' }),
    });
    expect(loginRes.status).toBe(200);
    const adminCookie = loginRes.headers.get('set-cookie')?.split(';')[0] ?? '';

    await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          apiKey: 'sk-primary-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
      }),
    });

    // 1. Import card
    const importRes = await app.request('/api/v1/cards/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        filename: 'kaltsit.json',
        format: 'json',
        targetCardType: 'general',
        jsonText: JSON.stringify({
          name: baseCard.name,
          description: baseCard.summary,
          personality: baseCard.personality,
          scenario: baseCard.scenario,
          first_mes: baseCard.first_mes,
          mes_example: baseCard.mes_example,
          tags: baseCard.tags,
        }),
      }),
    });
    expect(importRes.status).toBe(201);
    const imported = (await importRes.json()) as { card: { id: string; content: RoleCardContent } };
    const cardId = imported.card.id;

    // 2. Generate tags (append + dedupe) and check both card detail and list tags_json sync
    const tagGenRes = await app.request(`/api/v1/cards/${cardId}/generate-field`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ field: 'tags' }),
    });
    expect(tagGenRes.status).toBe(200);
    const tagGenJson = (await tagGenRes.json()) as { card: { tags: string[] } };
    expect(tagGenJson.card.tags).toEqual(['医疗', '罗德岛', '泰拉学者', 'Mon3tr']);

    // 3. Unified SSE progress format for dialogue field (first_mes) includes model & field label
    const firstMesSseRes = await app.request(`/api/v1/cards/${cardId}/generate-field`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        cookie: adminCookie,
      },
      body: JSON.stringify({ field: 'first_mes' }),
    });
    expect(firstMesSseRes.status).toBe(200);
    const firstMesSseText = await firstMesSseRes.text();
    expect(firstMesSseText).toContain('gpt-4o-mini');
    expect(firstMesSseText).toContain('开场白');

    // 4. TRPG SSE streaming emits progress (with model), thinking, and persists extensions.trpg
    const trpgSseRes = await app.request(`/api/v1/cards/${cardId}/trpg`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        cookie: adminCookie,
      },
      body: JSON.stringify({ system: 'coc7e' }),
    });
    expect(trpgSseRes.status).toBe(200);
    const trpgSseText = await trpgSseRes.text();
    expect(trpgSseText).toContain('event: progress');
    expect(trpgSseText).toContain('gpt-4o-mini');
    expect(trpgSseText).toContain('event: thinking');
    expect(trpgSseText).toContain('推演 CoC 7e 调查员属性与衍生数值');
    expect(trpgSseText).toContain('event: result');

    // 5. Manual edit of TRPG stats + lock personality
    const detailAfterTrpg = (await (
      await app.request(`/api/v1/cards/${cardId}`, { headers: { cookie: adminCookie } })
    ).json()) as { card: { content: RoleCardContent; tags: string[] } };

    const manualTrpgContent: RoleCardContent = {
      ...detailAfterTrpg.card.content,
      extensions: {
        ...detailAfterTrpg.card.content.extensions,
        trpg: {
          ...trpgData,
          occupation: '手动修正：巴别塔主治医师',
        },
      },
    };
    const manualSaveRes = await app.request(`/api/v1/cards/${cardId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        content: manualTrpgContent,
        lockedFields: ['personality'],
        tags: detailAfterTrpg.card.tags,
      }),
    });
    expect(manualSaveRes.status).toBe(200);

    // 6. Compress exempts TRPG extensions
    const compressRes = await app.request(`/api/v1/cards/${cardId}/compress`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ targetMaxTokens: 500 }),
    });
    expect(compressRes.status).toBe(200);
    const compressJson = (await compressRes.json()) as {
      card: { content: RoleCardContent };
    };
    expect(
      (compressJson.card.content.extensions.trpg as { occupation?: string }).occupation,
    ).toBe('手动修正：巴别塔主治医师');
    expect(compressJson.card.content.summary).toBe('语义精简后的简介');

    // 7. Whole-card regenerate (SSE) preserves locked personality and TRPG extensions
    const regenSseRes = await app.request(`/api/v1/cards/${cardId}/regenerate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        cookie: adminCookie,
      },
      body: JSON.stringify({ instruction: '保持冷峻' }),
    });
    expect(regenSseRes.status).toBe(200);
    const regenSseText = await regenSseRes.text();
    expect(regenSseText).toContain('协同重写所有未锁定区块');
    expect(regenSseText).toContain('一键重生成后的简介');

    const afterRegenDetail = (await (
      await app.request(`/api/v1/cards/${cardId}`, { headers: { cookie: adminCookie } })
    ).json()) as { card: { content: RoleCardContent; version: number } };
    expect(afterRegenDetail.card.content.summary).toBe('一键重生成后的简介');
    expect(afterRegenDetail.card.content.personality).toBe(baseCard.personality);
    expect(
      (afterRegenDetail.card.content.extensions.trpg as { occupation?: string }).occupation,
    ).toBe('手动修正：巴别塔主治医师');

    // 8. Revisions list & rollback to previous version (before regenerate)
    const revListRes = await app.request(`/api/v1/cards/${cardId}/revisions`, {
      headers: { cookie: adminCookie },
    });
    expect(revListRes.status).toBe(200);
    const revListJson = (await revListRes.json()) as {
      revisions: Array<{ id: string; action: string; summary: string }>;
    };
    expect(revListJson.revisions.length).toBeGreaterThanOrEqual(5);
    expect(revListJson.revisions[0]?.action).toBe('regenerate');

    const rollbackRes = await app.request(`/api/v1/cards/${cardId}/rollback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({}),
    });
    expect(rollbackRes.status).toBe(200);
    const rollbackJson = (await rollbackRes.json()) as {
      card: { content: RoleCardContent; version: number };
    };
    expect(rollbackJson.card.content.summary).toBe('语义精简后的简介');
    expect(rollbackJson.card.version).toBeGreaterThan(afterRegenDetail.card.version);

    dbHandle.close();
  });

  it('supports dual CoC 7e + D&D 5e coexistence, active switching, filtering, targeted export, and playtest rule injection', async () => {
    const dbHandle = createSqliteDatabase(':memory:');
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: 'TestPassword123!',
    });

    const cocPayload = {
      system: 'Call of Cthulhu 7e',
      occupation: '古文明学者',
      era: '1920s',
      characteristics: { STR: 45, CON: 55, SIZ: 55, DEX: 60, APP: 65, INT: 90, POW: 85, EDU: 95 },
      derived: { HP: 11, MP: 17, SAN: 80, Luck: 50, Move: 8 },
      keySkills: ['医学 85%', '神秘学 75%'],
    };
    const dndPayload = {
      system: 'D&D 5e',
      race: '菲林',
      className: '生命牧师',
      alignment: '守序中立',
      level: 10,
      abilityScores: { STR: 10, DEX: 12, CON: 14, INT: 19, WIS: 18, CHA: 13 },
      combat: { AC: 17, MaxHP: 78, Speed: '30 ft', ProficiencyBonus: 4 },
      proficiencies: ['医药', '历史'],
      featuresAndTraits: ['Mon3tr 护佑', '真实之眼'],
    };

    const playtestSystemPrompts: string[] = [];

    const fetchImpl: HttpFetchPort = async (url, init) => {
      if (url.endsWith('/chat/completions')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          messages?: Array<{ role: string; content: string }>;
        };
        const sys = body.messages?.[0]?.content ?? '';
        const joined = (body.messages ?? []).map((m) => m.content).join('\n');

        if (sys.includes('TRPG 规则构筑师')) {
          const isDnd = joined.includes('D&D 5e');
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: { content: JSON.stringify({ trpg: isDnd ? dndPayload : cocPayload }) },
                  finish_reason: 'stop',
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }

        playtestSystemPrompts.push(sys);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '我已了解当前规则状态，请继续。' }, finish_reason: 'stop' }],
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
    });

    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'TestPassword123!' }),
    });
    const adminCookie = loginRes.headers.get('set-cookie')?.split(';')[0] ?? '';

    await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          apiKey: 'sk-primary-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
      }),
    });

    const importRes = await app.request('/api/v1/cards/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        filename: 'kaltsit.json',
        format: 'json',
        targetCardType: 'general',
        jsonText: JSON.stringify({
          name: '凯尔希',
          description: '罗德岛最高医疗主管',
          personality: '冷静、理性、言辞犀利',
          scenario: '罗德岛医疗部',
          first_mes: '博士，请简述你的来意。',
          tags: ['罗德岛'],
        }),
      }),
    });
    expect(importRes.status).toBe(201);
    const cardId = ((await importRes.json()) as { card: { id: string } }).card.id;

    // 1. Generate CoC 7e (activates coc7e)
    const cocRes = await app.request(`/api/v1/cards/${cardId}/trpg`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ system: 'coc7e', activate: true }),
    });
    expect(cocRes.status).toBe(200);
    const cocCard = ((await cocRes.json()) as { card: { cardType: string; content: RoleCardContent } }).card;
    expect(cocCard.cardType).toBe('trpg_coc7');

    // Switching to dnd5e before it exists fails with 400 TRPG_SYSTEM_NOT_FOUND
    const missingSwitchRes = await app.request(`/api/v1/cards/${cardId}/trpg/active`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ system: 'dnd5e' }),
    });
    expect(missingSwitchRes.status).toBe(400);

    // 2. Generate D&D 5e with activate: false -> coexists while coc7e stays active
    const dndRes = await app.request(`/api/v1/cards/${cardId}/trpg`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ system: 'dnd5e', activate: false }),
    });
    expect(dndRes.status).toBe(200);
    const dualJson = (await dndRes.json()) as {
      card: { cardType: string; content: RoleCardContent };
    };
    expect(dualJson.card.cardType).toBe('trpg_coc7');
    const trpgSystems = dualJson.card.content.extensions.trpgSystems as Record<
      string,
      Record<string, unknown>
    >;
    expect(trpgSystems.coc7e?.occupation).toBe('古文明学者');
    expect(trpgSystems.dnd5e?.className).toBe('生命牧师');
    expect(dualJson.card.content.extensions.activeTrpgSystem).toBe('coc7e');
    expect((dualJson.card.content.extensions.trpg as { occupation?: string }).occupation).toBe('古文明学者');

    // 3. Card gallery filter by trpg_dnd5e still matches dual card!
    const listDndRes = await app.request('/api/v1/cards?cardType=trpg_dnd5e', {
      headers: { cookie: adminCookie },
    });
    expect(listDndRes.status).toBe(200);
    const listDndJson = (await listDndRes.json()) as { items: Array<{ id: string }> };
    expect(listDndJson.items.some((i) => i.id === cardId)).toBe(true);

    // 4. Targeted export while CoC 7e is active: Foundry D&D 5e + trpgSystem=dnd5e + invalid query check
    const foundryRes = await app.request(
      `/api/v1/cards/${cardId}/export?format=foundry_dnd5e_json`,
      { headers: { cookie: adminCookie } },
    );
    expect(foundryRes.status).toBe(200);
    const foundryJson = (await foundryRes.json()) as {
      system: { abilities: { int: { value: number } } };
      items: Array<{ name: string }>;
    };
    expect(foundryJson.system.abilities.int.value).toBe(19);
    expect(foundryJson.items.map((i) => i.name)).toContain('Mon3tr 护佑');

    const mdDndRes = await app.request(
      `/api/v1/cards/${cardId}/export?format=trpg_sheet_md&trpgSystem=dnd5e`,
      { headers: { cookie: adminCookie } },
    );
    expect(mdDndRes.status).toBe(200);
    const mdDndText = await mdDndRes.text();
    expect(mdDndText).toContain('生命牧师');
    expect(mdDndText).not.toContain('古文明学者');

    const badSysRes = await app.request(
      `/api/v1/cards/${cardId}/export?format=trpg_sheet_md&trpgSystem=pathfinder`,
      { headers: { cookie: adminCookie } },
    );
    expect(badSysRes.status).toBe(400);

    // 5. Playtest injection per requested trpgSystem
    const ptAuto = await app.request(`/api/v1/cards/${cardId}/playtest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ message: '检定医学知识' }),
    });
    expect(ptAuto.status).toBe(200);
    expect(((await ptAuto.json()) as { trpgSystemInjected?: string | null }).trpgSystemInjected).toBe('coc7e');
    expect(playtestSystemPrompts[0]).toContain('古文明学者');

    const ptDnd = await app.request(`/api/v1/cards/${cardId}/playtest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ message: '施放治疗术', trpgSystem: 'dnd5e' }),
    });
    expect(ptDnd.status).toBe(200);
    expect(((await ptDnd.json()) as { trpgSystemInjected?: string | null }).trpgSystemInjected).toBe('dnd5e');
    expect(playtestSystemPrompts[1]).toContain('生命牧师');

    const ptNone = await app.request(`/api/v1/cards/${cardId}/playtest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ message: '纯叙事聊天', trpgSystem: 'none' }),
    });
    expect(ptNone.status).toBe(200);
    expect(((await ptNone.json()) as { trpgSystemInjected?: string | null }).trpgSystemInjected).toBeNull();
    expect(playtestSystemPrompts[2]).not.toContain('TRPG 规则面板');

    // 6. Switch active rule via PATCH /cards/:id/trpg/active
    const switchRes = await app.request(`/api/v1/cards/${cardId}/trpg/active`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ system: 'dnd5e' }),
    });
    expect(switchRes.status).toBe(200);
    const switchedCard = ((await switchRes.json()) as {
      card: { cardType: string; content: RoleCardContent };
    }).card;
    expect(switchedCard.cardType).toBe('trpg_dnd5e');
    expect(switchedCard.content.extensions.activeTrpgSystem).toBe('dnd5e');
    expect((switchedCard.content.extensions.trpg as { className?: string }).className).toBe('生命牧师');
    // CoC 7e bucket remains intact!
    expect(
      ((switchedCard.content.extensions.trpgSystems as Record<string, Record<string, unknown>>).coc7e)
        ?.occupation,
    ).toBe('古文明学者');

    dbHandle.close();
  });
});


