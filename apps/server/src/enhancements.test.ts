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

        if (body.stream) {
          const encoder = new TextEncoder();
          const chunks = [
            `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '正在验证 DeepSeek Reasoner 通道...' } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'OK' } }] })}\n\n`,
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
          capturedUserPrompts.push(joined);
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
});
