import { describe, expect, it } from 'vitest';
import type { RoleCardContent, SyncEventDto } from '@rolecard/shared';
import { generateTrpgAttributesForCard } from './generator.js';
import { validateModelSlotCapability } from './llm/capabilities.js';
import { createOpenAiCompatibleLlmPort, testLlmConnectivity } from './llm/client.js';
import { applyTrpgPresetFields } from './lorebook.js';
import {
  buildNotificationMessage,
  deliverNotificationsInParallel,
  validateNotificationChannelSettings,
  type SmtpSendInput,
} from './notifications.js';
import { queryMediaWikiSite } from './retrieval.js';
import {
  exportCardToFoundryDnd5eActor,
  exportCardToTrpgSheetHtml,
  exportCardToTrpgSheetMarkdown,
} from './trpg-export.js';
import type { DnsLookupPort, HttpFetchPort, LlmCompletionPort } from './types.js';
import {
  maskProxyConfig,
  maskProxyUrl,
  resolveEffectiveProxyUrl,
  testProxyConnectivity,
  validateProxyUrl,
  type RuntimeProxyConfig,
} from './proxy.js';
import { validatePublicUrl } from './ssrf.js';
import { generateOrOptimizePortraitPrompt } from './vision.js';

const publicDns: DnsLookupPort = async () => [{ address: '93.184.216.34', family: 4 }];

const sampleContent: RoleCardContent = {
  name: '阿米娅',
  summary: '罗德岛公开领袖，坚定温柔的感染者少女。',
  personality: '富有同理心、坚韧果断，关键时刻肩负重任。',
  appearance: '棕发兔耳少女，佩戴多枚黑色抑制戒指。',
  background: '在卡兹戴尔与巴别塔的动荡中成长，继承了罗德岛的意志。',
  speech_style: { tone: '温和而坚定', catchphrases: ['博士，我们出发吧'], habits: [] },
  relationships: [{ target: '博士', relation: '最信赖的搭档', attitude: '并肩作战' }],
  scenario: '罗德岛舰桥指挥室',
  first_mes: '博士，今天的作战部署已经整理完毕，请随时下达指令。',
  mes_example: '<START>\n{{user}}: 休息一下吧。\n{{char}}: 谢谢博士，不过罗德岛还有许多事需要处理。',
  system_prompt: '保持阿米娅的温柔与领袖气质。',
  creator_notes: '测试角色卡',
  tags: ['明日方舟', '罗德岛'],
  alternate_greetings: [],
  extensions: {},
};

describe('MediaWiki exact lookup & action=parse fallback', () => {
  it('prefers exact title and falls back to action=parse when extract is short', async () => {
    const requestedUrls: string[] = [];
    const fetchImpl: HttpFetchPort = async (url) => {
      requestedUrls.push(url);
      if (url.includes('titles=%E9%98%BF%E7%B1%B3%E5%A8%85') || url.includes('titles=阿米娅')) {
        return new Response(
          JSON.stringify({
            query: {
              pages: {
                '101': {
                  pageid: 101,
                  title: '阿米娅',
                  extract: '短摘要',
                  canonicalurl: 'https://prts.wiki/w/%E9%98%BF%E7%B1%B3%E5%A8%85',
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('action=parse') && url.includes('pageid=101')) {
        return new Response(
          JSON.stringify({
            parse: {
              title: '阿米娅',
              text: {
                '*': '<div class="mw-parser-output"><p>阿米娅，罗德岛的公开领袖，拥有奇美拉与源石技艺资质。</p><div class="navbox">导航栏杂音</div></div>',
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    };

    const hit = await queryMediaWikiSite(
      {
        id: 'prts',
        label: 'PRTS Wiki',
        apiEndpoint: 'https://prts.wiki/api.php',
        pageBaseUrl: 'https://prts.wiki/index.php?curid=',
      },
      '阿米娅 明日方舟',
      { fetchImpl, dnsLookup: publicDns },
      { exactTitle: '阿米娅', workName: '明日方舟' },
    );

    expect(hit).not.toBeNull();
    expect(hit?.title).toBe('阿米娅 (PRTS Wiki)');
    expect(hit?.url).toBe('https://prts.wiki/w/%E9%98%BF%E7%B1%B3%E5%A8%85');
    expect(hit?.snippet).toContain('奇美拉与源石技艺资质');
    expect(hit?.snippet).not.toContain('导航栏杂音');
    expect(requestedUrls.some((u) => u.includes('action=parse'))).toBe(true);
  });
});

describe('Model slot capability validation, probing & streaming think splitter', () => {
  it('blocks mismatched model families per slot and routes image/vision probes properly', async () => {
    expect(
      validateModelSlotCapability({
        slotType: 'primary',
        provider: 'openai',
        model: 'text-embedding-3-large',
      }).ok,
    ).toBe(false);

    expect(
      validateModelSlotCapability({
        slotType: 'primary',
        provider: 'openai',
        model: 'dall-e-3',
      }).ok,
    ).toBe(false);

    expect(
      validateModelSlotCapability({
        slotType: 'vision',
        provider: 'deepseek',
        model: 'deepseek-chat',
      }).ok,
    ).toBe(false);

    expect(
      validateModelSlotCapability({
        slotType: 'image',
        provider: 'openai',
        model: 'gpt-4o',
      }).ok,
    ).toBe(false);

    expect(
      validateModelSlotCapability({
        slotType: 'image',
        provider: 'siliconflow',
        model: 'black-forest-labs/FLUX.1-schnell',
      }).ok,
    ).toBe(true);

    const probedEndpoints: string[] = [];
    const probeFetch: HttpFetchPort = async (url, init) => {
      probedEndpoints.push(url);
      if (url.endsWith('/images/generations')) {
        const parsed = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
        expect(parsed.model).toBe('dall-e-3');
        return new Response(
          JSON.stringify({ data: [{ url: 'https://img.example.com/probe.png' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/chat/completions')) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    const imgProbe = await testLlmConnectivity(
      {
        slotType: 'image',
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        model: 'dall-e-3',
      },
      probeFetch,
    );
    expect(imgProbe.ok).toBe(true);
    expect(probedEndpoints.some((u) => u.endsWith('/images/generations'))).toBe(true);

    const visionProbe = await testLlmConnectivity(
      {
        slotType: 'vision',
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
      },
      probeFetch,
    );
    expect(visionProbe.ok).toBe(true);
  });

  it('splits streamed <think> blocks across chunk boundaries and preserves reasoning_content', async () => {
    const encoder = new TextEncoder();
    const ssePayloads = [
      'data: {"choices":[{"delta":{"reasoning_content":"先梳理背景。"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"<thi"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"nk>再推敲性格</thi"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"nk>{\\"name\\":\\"阿米娅\\"}"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const streamFetch: HttpFetchPort = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of ssePayloads) {
              controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );

    const llmPort = createOpenAiCompatibleLlmPort(streamFetch);
    const reasoningDeltas: string[] = [];
    const contentDeltas: string[] = [];

    const result = await llmPort({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'deepseek-reasoner',
      messages: [{ role: 'user', content: 'hi' }],
      jsonMode: false,
      temperature: 0.3,
      onReasoningDelta: (d) => {
        reasoningDeltas.push(d);
      },
      onContentDelta: (d) => {
        contentDeltas.push(d);
      },
    });

    expect(result.status).toBe(200);
    expect(reasoningDeltas.join('')).toBe('先梳理背景。再推敲性格');
    expect(contentDeltas.join('')).toBe('{"name":"阿米娅"}');
    expect(result.content).toBe('{"name":"阿米娅"}');
    expect(result.reasoning).toContain('再推敲性格');
  });
});

describe('TRPG derivation, deep merge & VTT/sheet exports', () => {
  it('preserves LLM-generated nested TRPG attributes during preset normalization', () => {
    const merged = applyTrpgPresetFields('trpg_coc7', {
      ...sampleContent,
      extensions: {
        trpg: {
          system: 'Call of Cthulhu 7e',
          occupation: '神秘学学者',
          characteristics: { INT: 90, POW: 85 },
          derived: { SAN: 85 },
        },
      },
    });

    const trpg = merged.extensions.trpg as Record<string, unknown>;
    const chars = trpg.characteristics as Record<string, number>;
    const derived = trpg.derived as Record<string, number>;
    expect(trpg.occupation).toBe('神秘学学者');
    expect(chars.INT).toBe(90);
    expect(chars.POW).toBe(85);
    expect(chars.STR).toBe(55);
    expect(derived.SAN).toBe(85);
  });

  it('derives D&D 5e stats via LLM and exports Foundry VTT JSON + printable HTML/MD', async () => {
    const derived = await generateTrpgAttributesForCard(sampleContent, 'dnd5e', {
      llmSlot: {
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        jsonModeStrategy: 'auto',
      },
      llmPort: async () => ({
        status: 200,
        content: JSON.stringify({
          trpg: {
            system: 'D&D 5e',
            race: '卡特斯',
            className: '吟游诗人 / 术士',
            alignment: '守序善良',
            level: 7,
            abilityScores: { STR: 8, DEX: 14, CON: 12, INT: 16, WIS: 15, CHA: 18 },
            combat: { AC: 15, MaxHP: 45, Speed: '30 ft', ProficiencyBonus: 3 },
            proficiencies: ['奥秘', '说服', '洞悉'],
            featuresAndTraits: ['奇美拉共鸣', '激励之语'],
          },
        }),
      }),
    });

    expect(derived.ok).toBe(true);
    if (!derived.ok) return;

    const actor = exportCardToFoundryDnd5eActor(derived.value.content, {
      cardType: derived.value.cardType,
      workName: '明日方舟',
      version: 2,
    }) as {
      name: string;
      type: string;
      system: {
        abilities: { cha: { value: number }; int: { value: number } };
        attributes: { ac: { flat: number }; hp: { max: number } };
      };
      items: Array<{ name: string }>;
    };

    expect(actor.name).toBe('阿米娅');
    expect(actor.type).toBe('character');
    expect(actor.system.abilities.cha.value).toBe(18);
    expect(actor.system.abilities.int.value).toBe(16);
    expect(actor.system.attributes.ac.flat).toBe(15);
    expect(actor.system.attributes.hp.max).toBe(45);
    expect(actor.items.map((i) => i.name)).toContain('奇美拉共鸣');

    const md = exportCardToTrpgSheetMarkdown(derived.value.content, {
      cardType: derived.value.cardType,
      workName: '明日方舟',
    });
    expect(md).toContain('# 阿米娅 · D&D 5e 冒险者车卡表');
    expect(md).toContain('D&D 5e');
    expect(md).toContain('奇美拉共鸣');

    const html = exportCardToTrpgSheetHtml(
      { ...derived.value.content, summary: '<script>alert(1)</script>领袖' },
      { cardType: derived.value.cardType, workName: '明日方舟' },
    );
    expect(html).toContain('@media print');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;领袖');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

describe('Multi-channel notifications (equal priority parallel dispatch + SMTP)', () => {
  it('validates SSRF URLs and delivers review.pending to all enabled channels in parallel', async () => {
    const ssrfCheck = await validateNotificationChannelSettings('feishu', {
      smtpHost: '',
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: '',
      smtpPass: '',
      smtpFrom: '',
      smtpTo: '',
      webhookUrl: 'http://127.0.0.1:8080/hook',
      secret: '',
      telegramBotToken: '',
      telegramChatId: '',
      telegramApiBaseUrl: 'https://api.telegram.org',
      barkServerUrl: 'https://api.day.app',
      barkDeviceKey: '',
      barkGroup: 'RoleCardStudio',
      serverChanSendKey: '',
    });
    expect(ssrfCheck.ok).toBe(false);

    const sampleEvent: SyncEventDto = {
      cursor: 10,
      id: 'evt-review-1',
      eventType: 'review.pending',
      targetType: 'card',
      targetId: 'card-amiya',
      version: 3,
      payload: {
        reviewType: 'impression',
        characterName: '阿米娅',
        diffSummary: '新增主线第十四章角色状态变化',
      },
      createdAt: '2026-11-15T10:00:00.000Z',
    };

    const msg = buildNotificationMessage(sampleEvent);
    expect(msg.title).toContain('[待审核]');
    expect(msg.bodyText).toContain('新增主线第十四章角色状态变化');

    const smtpCalls: SmtpSendInput[] = [];
    const httpCalls: string[] = [];

    const results = await deliverNotificationsInParallel(
      [
        {
          id: 'ch-smtp',
          name: '邮箱通知',
          channelType: 'smtp',
          settings: {
            smtpHost: 'smtp.example.com',
            smtpPort: 465,
            smtpSecure: true,
            smtpUser: 'bot@example.com',
            smtpPass: 'secret',
            smtpFrom: 'bot@example.com',
            smtpTo: 'owner@example.com',
            webhookUrl: '',
            secret: '',
            telegramBotToken: '',
            telegramChatId: '',
            telegramApiBaseUrl: 'https://api.telegram.org',
            barkServerUrl: 'https://api.day.app',
            barkDeviceKey: '',
            barkGroup: 'RoleCardStudio',
            serverChanSendKey: '',
          },
        },
        {
          id: 'ch-broken-tg',
          name: '失效Telegram',
          channelType: 'telegram',
          settings: {
            smtpHost: '',
            smtpPort: 465,
            smtpSecure: true,
            smtpUser: '',
            smtpPass: '',
            smtpFrom: '',
            smtpTo: '',
            webhookUrl: '',
            secret: '',
            telegramBotToken: 'bad-token',
            telegramChatId: '-1001',
            telegramApiBaseUrl: 'https://api.telegram.org',
            barkServerUrl: 'https://api.day.app',
            barkDeviceKey: '',
            barkGroup: 'RoleCardStudio',
            serverChanSendKey: '',
          },
        },
        {
          id: 'ch-feishu',
          name: '飞书群',
          channelType: 'feishu',
          settings: {
            smtpHost: '',
            smtpPort: 465,
            smtpSecure: true,
            smtpUser: '',
            smtpPass: '',
            smtpFrom: '',
            smtpTo: '',
            webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
            secret: 'fs-secret',
            telegramBotToken: '',
            telegramChatId: '',
            telegramApiBaseUrl: 'https://api.telegram.org',
            barkServerUrl: 'https://api.day.app',
            barkDeviceKey: '',
            barkGroup: 'RoleCardStudio',
            serverChanSendKey: '',
          },
        },
      ],
      sampleEvent,
      {
        dnsLookup: publicDns,
        smtpTransport: async (input) => {
          smtpCalls.push(input);
        },
        fetchImpl: async (url) => {
          httpCalls.push(url);
          if (url.includes('api.telegram.org')) {
            return new Response('Unauthorized', { status: 401 });
          }
          return new Response(JSON.stringify({ code: 0 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
      },
    );

    expect(results).toHaveLength(3);
    expect(results[0]?.ok).toBe(true);
    if (results[0]?.ok) expect(results[0].value.channelId).toBe('ch-smtp');
    expect(results[1]?.ok).toBe(false);
    expect(results[2]?.ok).toBe(true);
    if (results[2]?.ok) expect(results[2].value.channelId).toBe('ch-feishu');
    expect(smtpCalls).toHaveLength(1);
    expect(smtpCalls[0]?.to).toEqual(['owner@example.com']);
    expect(httpCalls.some((u) => u.includes('open.feishu.cn'))).toBe(true);
  });
});

describe('Two-tier network proxy & SSRF viaProxy handling', () => {
  it('validates, masks, and resolves global vs scoped proxy overrides with bypassLocal', () => {
    expect(validateProxyUrl('http://127.0.0.1:7897').ok).toBe(true);
    expect(validateProxyUrl('socks5h://user:secret@proxy.example.com:1080').ok).toBe(true);
    expect(validateProxyUrl('ftp://proxy.example.com:21').ok).toBe(false);
    expect(validateProxyUrl('http://proxy.example.com:99999').ok).toBe(false);

    expect(maskProxyUrl('socks5://alice:topsecret@127.0.0.1:1080')).toBe(
      'socks5://alice:****@127.0.0.1:1080',
    );
    expect(maskProxyUrl('http://127.0.0.1:7897')).toBe('http://127.0.0.1:7897');

    const cfg: RuntimeProxyConfig = {
      globalEnabled: true,
      globalUrl: 'http://127.0.0.1:7897',
      bypassLocal: true,
      overrides: {
        llm_chat: { mode: 'direct', url: '' },
        llm_image: { mode: 'custom', url: 'socks5://bob:pw@10.1.2.3:1080' },
      },
    };

    // Inherit uses global proxy for external URLs, but bypasses local/private targets
    expect(resolveEffectiveProxyUrl(cfg, 'llm_primary', 'https://api.openai.com/v1/chat/completions')).toBe(
      'http://127.0.0.1:7897',
    );
    expect(resolveEffectiveProxyUrl(cfg, 'llm_primary', 'http://localhost:11434/v1')).toBeNull();
    expect(resolveEffectiveProxyUrl(cfg, 'llm_primary', 'http://192.168.1.50:8000/v1')).toBeNull();

    // Direct override forces no proxy even for public targets
    expect(resolveEffectiveProxyUrl(cfg, 'llm_chat', 'https://api.openai.com/v1')).toBeNull();

    // Custom override uses scope-specific proxy even if global is disabled
    const globalOffCfg: RuntimeProxyConfig = { ...cfg, globalEnabled: false, bypassLocal: false };
    expect(resolveEffectiveProxyUrl(globalOffCfg, 'llm_primary', 'https://api.openai.com/v1')).toBeNull();
    expect(resolveEffectiveProxyUrl(globalOffCfg, 'llm_image', 'https://api.openai.com/v1')).toBe(
      'socks5://bob:pw@10.1.2.3:1080',
    );
    expect(resolveEffectiveProxyUrl(globalOffCfg, 'llm_image', 'http://127.0.0.1:8188')).toBe(
      'socks5://bob:pw@10.1.2.3:1080',
    );

    const masked = maskProxyConfig(cfg);
    expect(masked.globalEnabled).toBe(true);
    expect(masked.hasGlobalUrl).toBe(true);
    expect(masked.overrides.llm_image?.urlMasked).toBe('socks5://bob:****@10.1.2.3:1080');
    expect(masked.overrides.llm_chat?.mode).toBe('direct');
  });

  it('allows remote DNS failure and Fake-IP under viaProxy while keeping local IP blocks intact', async () => {
    const failingDns: DnsLookupPort = async () => {
      throw new Error('ENOTFOUND');
    };
    const fakeIpDns: DnsLookupPort = async () => [{ address: '198.18.0.12', family: 4 }];

    expect((await validatePublicUrl('https://api.example.com/v1', failingDns)).ok).toBe(false);
    expect(
      (await validatePublicUrl('https://api.example.com/v1', failingDns, { viaProxy: true })).ok,
    ).toBe(true);

    expect((await validatePublicUrl('https://api.example.com/v1', fakeIpDns)).ok).toBe(false);
    expect(
      (await validatePublicUrl('https://api.example.com/v1', fakeIpDns, { viaProxy: true })).ok,
    ).toBe(true);

    // Direct private IP literals remain blocked even viaProxy
    expect(
      (await validatePublicUrl('http://127.0.0.1:8080/secret', publicDns, { viaProxy: true })).ok,
    ).toBe(false);
  });

  it('reports proxy connectivity success and 407 auth failures cleanly', async () => {
    const okRes = await testProxyConnectivity(
      { proxyUrl: 'http://127.0.0.1:7897', targetUrl: 'https://cp.cloudflare.com/generate_204' },
      async () => new Response(null, { status: 204 }),
    );
    expect(okRes.ok).toBe(true);
    expect(okRes.status).toBe(204);

    const authFailRes = await testProxyConnectivity(
      { proxyUrl: 'http://127.0.0.1:7897' },
      async () => new Response('Proxy Auth Required', { status: 407 }),
    );
    expect(authFailRes.ok).toBe(false);
    expect(authFailRes.status).toBe(407);
  });
});

describe('Streaming LLM connectivity probe & portrait prompt generator', () => {
  it('streams thinking deltas and accepts reasoning-only responses within upgraded token budget', async () => {
    const encoder = new TextEncoder();
    let capturedMaxTokens = 0;

    const reasoningStreamFetch: HttpFetchPort = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { max_tokens?: number; stream?: boolean };
      capturedMaxTokens = body.max_tokens ?? 0;
      expect(body.stream).toBe(true);

      const chunks = [
        'data: {"choices":[{"delta":{"reasoning_content":"确认模型连通性..."}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n',
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
    };

    const progressSteps: string[] = [];
    const thoughts: string[] = [];
    const contents: string[] = [];

    const probeResult = await testLlmConnectivity(
      {
        slotType: 'primary',
        provider: 'deepseek',
        apiKey: 'sk-test',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-reasoner',
        onProgress: (evt) => {
          progressSteps.push(evt.step);
        },
        onReasoningDelta: (delta) => {
          thoughts.push(delta);
        },
        onContentDelta: (delta) => {
          contents.push(delta);
        },
      },
      reasoningStreamFetch,
    );

    expect(probeResult.ok).toBe(true);
    expect(capturedMaxTokens).toBe(512);
    expect(progressSteps).toContain('probing');
    expect(thoughts.join('')).toContain('确认模型连通性');
    expect(contents.join('')).toBe('OK');
    expect(probeResult.reasoning).toContain('确认模型连通性');
  });

  it('generates and optimizes English portrait prompts from RoleCard context', async () => {
    const capturedPrompts: string[] = [];
    const mockPort: LlmCompletionPort = async (req) => {
      capturedPrompts.push(req.messages.map((m) => m.content).join('\n'));
      return {
        status: 200,
        content: JSON.stringify({
          prompt:
            '1girl, Amiya, brown hair, rabbit ears, dark coat with teal accents, glowing blue rings on fingers, Rhodes Island bridge background, dramatic rim lighting',
          negativePrompt: 'lowres, bad anatomy, extra fingers, watermark',
          notes: '结合阿米娅的棕发兔耳、黑色抑制戒指与罗德岛舰桥氛围提炼英文立绘提示词。',
        }),
      };
    };

    const genResult = await generateOrOptimizePortraitPrompt(
      {
        card: {
          characterName: sampleContent.name,
          workName: '明日方舟',
          appearance: sampleContent.appearance,
          personality: sampleContent.personality,
          background: sampleContent.background,
          scenario: sampleContent.scenario,
          tags: sampleContent.tags,
        },
        mode: 'generate',
        style: 'anime',
        instruction: '半身肖像，眼神坚定',
      },
      {
        llmPort: mockPort,
        llmSlot: {
          provider: 'openai',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
      },
    );

    expect(genResult.ok).toBe(true);
    if (genResult.ok) {
      expect(genResult.value.prompt).toContain('rabbit ears');
      expect(genResult.value.negativePrompt).toContain('watermark');
      expect(genResult.value.notes).toContain('阿米娅');
    }
    expect(capturedPrompts[0]).toContain('棕发兔耳少女');
    expect(capturedPrompts[0]).toContain('半身肖像，眼神坚定');

    const optResult = await generateOrOptimizePortraitPrompt(
      {
        card: {
          characterName: sampleContent.name,
          appearance: sampleContent.appearance,
        },
        mode: 'optimize',
        style: 'semi_realistic',
        draftPrompt: 'anime girl with rabbit ears',
        instruction: '增加光影质感',
      },
      {
        llmPort: mockPort,
        llmSlot: {
          provider: 'openai',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
      },
    );
    expect(optResult.ok).toBe(true);
    expect(capturedPrompts[1]).toContain('anime girl with rabbit ears');
    expect(capturedPrompts[1]).toContain('semi-realistic');
  });
});

