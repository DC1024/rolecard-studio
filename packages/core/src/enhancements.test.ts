import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  FREE_STARTER_PRESETS,
  LLM_PROVIDER_DEFAULTS,
  type LlmProvider,
  type LlmSlotPurpose,
  type RoleCardContent,
  type SyncEventDto,
} from '@rolecard/shared';
import { generateRoleCard, generateTrpgAttributesForCard } from './generator.js';
import { validateModelSlotCapability } from './llm/capabilities.js';
import { createOpenAiCompatibleLlmPort, splitThinkTags, testLlmConnectivity } from './llm/client.js';
import {
  completeStructuredJson,
  extractJsonCandidate,
  repairTruncatedJson,
} from './llm/json-repair.js';
import {
  applyTrpgPresetFields,
  extractTrpgSystems,
  mergeTrpgSystemData,
  reconcileTrpgExtensionsOnEdit,
  switchActiveTrpgSystem,
} from './lorebook.js';
import {
  buildNotificationMessage,
  deliverNotificationsInParallel,
  validateNotificationChannelSettings,
  type SmtpSendInput,
} from './notifications.js';
import {
  compressRoleCard,
  generateCardField,
  mergeCardTagsDedupe,
  refineRoleCard,
  regenerateRoleCard,
  runPlaytestTurn,
  selectSourcesForGeneration,
} from './playtest.js';
import { layeredRetrieve, queryMediaWikiSite, testSearchConnectivity } from './retrieval.js';
import {
  exportCardToFoundryDnd5eActor,
  exportCardToTrpgSheetHtml,
  exportCardToTrpgSheetMarkdown,
} from './trpg-export.js';
import type { DnsLookupPort, HttpFetchPort, LlmCompletionPort } from './types.js';
import {
  createScopedProxyFetch,
  detectEnvProxySummary,
  isEffectiveAllowFakeIp,
  isNoProxyMatch,
  maskProxyConfig,
  maskProxyUrl,
  resolveEffectiveProxyUrl,
  resolveEnvProxyUrl,
  testProxyConnectivity,
  validateProxyUrl,
  type RuntimeProxyConfig,
} from './proxy.js';
import { validatePublicUrl } from './ssrf.js';
import {
  fetchRemoteImageBuffer,
  generateOrOptimizePortraitPrompt,
  generatePortraitImage,
  searchWikimediaCommonsImages,
} from './vision.js';

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

    const emptyEnv: Record<string, string | undefined> = {};

    // Inherit uses global proxy for external URLs, but bypasses local/private targets
    expect(
      resolveEffectiveProxyUrl(cfg, 'llm_primary', 'https://api.openai.com/v1/chat/completions', emptyEnv),
    ).toBe('http://127.0.0.1:7897');
    expect(resolveEffectiveProxyUrl(cfg, 'llm_primary', 'http://localhost:11434/v1', emptyEnv)).toBeNull();
    expect(resolveEffectiveProxyUrl(cfg, 'llm_primary', 'http://192.168.1.50:8000/v1', emptyEnv)).toBeNull();

    // Direct override forces no proxy even for public targets
    expect(resolveEffectiveProxyUrl(cfg, 'llm_chat', 'https://api.openai.com/v1', emptyEnv)).toBeNull();

    // Custom override uses scope-specific proxy even if global is disabled
    const globalOffCfg: RuntimeProxyConfig = { ...cfg, globalEnabled: false, bypassLocal: false };
    expect(resolveEffectiveProxyUrl(globalOffCfg, 'llm_primary', 'https://api.openai.com/v1', emptyEnv)).toBeNull();
    expect(resolveEffectiveProxyUrl(globalOffCfg, 'llm_image', 'https://api.openai.com/v1', emptyEnv)).toBe(
      'socks5://bob:pw@10.1.2.3:1080',
    );
    expect(resolveEffectiveProxyUrl(globalOffCfg, 'llm_image', 'http://127.0.0.1:8188', emptyEnv)).toBe(
      'socks5://bob:pw@10.1.2.3:1080',
    );

    const masked = maskProxyConfig(cfg, emptyEnv);
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

    // allowFakeIp permits 198.18.0.0/15 DNS results without viaProxy, while blocking real private IPs
    const fakeIpBlocked = await validatePublicUrl('https://commons.wikimedia.org/w/api.php', fakeIpDns);
    expect(fakeIpBlocked.ok).toBe(false);
    if (!fakeIpBlocked.ok) {
      expect(fakeIpBlocked.error.code).toBe('SSRF_IP_BLOCKED');
      expect(fakeIpBlocked.error.message).toContain('透明代理 Fake-IP');
    }

    const fakeIp19819Dns: DnsLookupPort = async () => [{ address: '198.19.12.34', family: 4 }];
    expect(
      (await validatePublicUrl('https://commons.wikimedia.org/w/api.php', fakeIp19819Dns, { allowFakeIp: true })).ok,
    ).toBe(true);

    const mixedPrivateDns: DnsLookupPort = async () => [
      { address: '198.18.3.185', family: 4 },
      { address: '192.168.1.10', family: 4 },
    ];
    expect(
      (await validatePublicUrl('https://commons.wikimedia.org/w/api.php', mixedPrivateDns, { allowFakeIp: true })).ok,
    ).toBe(false);
    expect(
      (await validatePublicUrl('http://198.18.3.185/admin', publicDns, { allowFakeIp: true })).ok,
    ).toBe(false);
  });

  it('supports env proxy fallback, NO_PROXY filtering, and ROLECARD_ALLOW_FAKE_IP for image search', async () => {
    const env = {
      HTTPS_PROXY: 'http://alice:secret123@127.0.0.1:7897',
      HTTP_PROXY: 'http://127.0.0.1:7890',
      NO_PROXY: 'localhost,.internal.corp,mirror.local:8080',
      ROLECARD_ALLOW_FAKE_IP: 'true',
    };

    expect(detectEnvProxySummary(env)).toBe('http://alice:****@127.0.0.1:7897');
    expect(resolveEnvProxyUrl('https://commons.wikimedia.org/w/api.php', env)).toBe(
      'http://alice:secret123@127.0.0.1:7897',
    );
    expect(resolveEnvProxyUrl('http://example.com/file', env)).toBe('http://127.0.0.1:7890');
    expect(isNoProxyMatch('https://api.internal.corp/v1', env)).toBe(true);
    expect(isNoProxyMatch('http://mirror.local:8080/api', env)).toBe(true);
    expect(resolveEnvProxyUrl('https://api.internal.corp/v1', env)).toBeNull();

    const baseCfg: RuntimeProxyConfig = {
      globalEnabled: false,
      globalUrl: '',
      bypassLocal: true,
      allowFakeIp: false,
      useEnvProxy: true,
      overrides: {
        llm_chat: { mode: 'direct', url: '' },
      },
    };

    expect(
      resolveEffectiveProxyUrl(baseCfg, 'media', 'https://commons.wikimedia.org/w/api.php', env),
    ).toBe('http://alice:secret123@127.0.0.1:7897');
    expect(
      resolveEffectiveProxyUrl(baseCfg, 'llm_chat', 'https://api.openai.com/v1', env),
    ).toBeNull();
    expect(
      resolveEffectiveProxyUrl(
        { ...baseCfg, useEnvProxy: false },
        'media',
        'https://commons.wikimedia.org/w/api.php',
        env,
      ),
    ).toBeNull();

    expect(isEffectiveAllowFakeIp(baseCfg, {})).toBe(false);
    expect(isEffectiveAllowFakeIp(baseCfg, env)).toBe(true);
    expect(maskProxyConfig(baseCfg, env).envProxyDetected).toBe('http://alice:****@127.0.0.1:7897');

    // End-to-end searchWikimediaCommonsImages under Fake-IP 198.18.3.185
    const fakeIpDns: DnsLookupPort = async () => [{ address: '198.18.3.185', family: 4 }];
    const mockWikiFetch: HttpFetchPort = async () =>
      new Response(
        JSON.stringify({
          query: {
            pages: {
              '1': {
                pageid: 1,
                title: 'File:Amiya_sample.png',
                imageinfo: [
                  {
                    url: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Amiya.png',
                    thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Amiya.png',
                    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Amiya_sample.png',
                    mime: 'image/png',
                  },
                ],
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );

    const blockedFetch = createScopedProxyFetch(
      { ...baseCfg, allowFakeIp: false, useEnvProxy: false },
      'media',
      mockWikiFetch,
      {},
    );
    const blockedSearch = await searchWikimediaCommonsImages('Amiya', 4, {
      fetchImpl: blockedFetch,
      dnsLookup: fakeIpDns,
    });
    expect(blockedSearch.ok).toBe(false);
    if (!blockedSearch.ok) {
      expect(blockedSearch.error.code).toBe('SSRF_IP_BLOCKED');
      expect(blockedSearch.error.message).toContain('198.18.3.185');
    }

    const allowedFetch = createScopedProxyFetch(
      { ...baseCfg, allowFakeIp: true, useEnvProxy: false },
      'media',
      mockWikiFetch,
      {},
    );
    const allowedSearch = await searchWikimediaCommonsImages('Amiya', 4, {
      fetchImpl: allowedFetch,
      dnsLookup: fakeIpDns,
    });
    expect(allowedSearch.ok).toBe(true);
    if (allowedSearch.ok) {
      expect(allowedSearch.value).toHaveLength(1);
      expect(allowedSearch.value[0]?.title).toContain('Amiya_sample.png');
    }
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

describe('Search connectivity probe, layered retrieval budget & single-field generation', () => {
  it('tests Bocha/Tavily connectivity and reports structured HTTP errors & Layer 1 wiki probe', async () => {
    const emptyProvider = await testSearchConnectivity({
      provider: 'none',
      testLayer1Wiki: false,
    });
    expect(emptyProvider.ok).toBe(false);

    const mockFetch: HttpFetchPort = async (url) => {
      if (url.includes('meta=siteinfo')) {
        return new Response(JSON.stringify({ query: { general: { sitename: 'Wiki' } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('api.bochaai.com')) {
        return new Response(
          JSON.stringify({
            data: {
              webPages: {
                value: [
                  { name: 'Alan Turing - Wikipedia', url: 'https://en.wikipedia.org/wiki/Alan_Turing', snippet: 'Pioneer of CS' },
                ],
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('api.tavily.com')) {
        return new Response('Unauthorized API key', { status: 401 });
      }
      return new Response('{}', { status: 404 });
    };

    const bochaOk = await testSearchConnectivity(
      {
        provider: 'bocha',
        apiKey: 'bocha-test-key',
        testLayer1Wiki: true,
        query: 'Alan Turing',
      },
      {
        fetchImpl: mockFetch,
        dnsLookup: publicDns,
        wikiSites: [
          {
            id: 'wikipedia_en',
            label: 'Wikipedia (EN)',
            apiEndpoint: 'https://en.wikipedia.org/w/api.php',
            pageBaseUrl: 'https://en.wikipedia.org/?curid=',
          },
        ],
      },
    );
    expect(bochaOk.ok).toBe(true);
    expect(bochaOk.hitCount).toBe(1);
    expect(bochaOk.sampleTitles).toContain('Alan Turing - Wikipedia');
    expect(bochaOk.layer1Reachable).toBe(true);
    expect(bochaOk.layer1Summary).toContain('Layer 1 百科全部连通');

    const tavilyFail = await testSearchConnectivity(
      {
        provider: 'tavily',
        apiKey: 'bad-key',
        testLayer1Wiki: false,
      },
      { fetchImpl: mockFetch, dnsLookup: publicDns },
    );
    expect(tavilyFail.ok).toBe(false);
    expect(tavilyFail.error).toContain('401');
  });

  it('runs Layer 1 + Layer 2 concurrently when deepSearch=true and preserves Layer 2 budget share', async () => {
    const longExtract = '罗德岛阿米娅核心设定资料。'.repeat(280);
    const wikiFetch: HttpFetchPort = async (url) => {
      if (url.includes('titles=')) {
        return new Response(
          JSON.stringify({
            query: {
              pages: {
                '101': {
                  pageid: 101,
                  title: '阿米娅',
                  extract: longExtract,
                  canonicalurl: 'https://prts.wiki/w/%E9%98%BF%E7%B1%B3%E5%A8%85',
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    };

    let layer2Calls = 0;
    const concurrentRes = await layeredRetrieve(
      {
        characterName: '阿米娅',
        workName: '明日方舟',
        enableLayer1Wiki: true,
        searchProvider: 'bocha',
        searchApiKey: 'bocha-key',
        deepSearch: true,
        maxTotalTokens: 1500,
      },
      {
        fetchImpl: wikiFetch,
        dnsLookup: publicDns,
        wikiSites: [
          {
            id: 'prts',
            label: 'PRTS Wiki',
            apiEndpoint: 'https://prts.wiki/api.php',
            pageBaseUrl: 'https://prts.wiki/index.php?curid=',
          },
        ],
        searchProviderPort: async () => {
          layer2Calls += 1;
          return [
            {
              title: '最新主线剧情动态',
              url: 'https://example.com/news',
              snippet: '第十五章补充剧情动态摘要。'.repeat(15),
              origin: 'search_supplement',
              provider: 'bocha',
            },
          ];
        },
      },
    );

    expect(layer2Calls).toBe(1);
    expect(concurrentRes.layer1Hits).toBe(1);
    expect(concurrentRes.layer2Hits).toBe(1);
    expect(concurrentRes.sources.some((s) => s.provider === 'prts')).toBe(true);
    expect(concurrentRes.sources.some((s) => s.provider === 'bocha')).toBe(true);

    // When deepSearch=false and Layer 1 already hit, Layer 2 is skipped to save quota
    let skippedCalls = 0;
    const l1OnlyRes = await layeredRetrieve(
      {
        characterName: '阿米娅',
        workName: '明日方舟',
        enableLayer1Wiki: true,
        searchProvider: 'bocha',
        searchApiKey: 'bocha-key',
        deepSearch: false,
      },
      {
        fetchImpl: wikiFetch,
        dnsLookup: publicDns,
        wikiSites: [
          {
            id: 'prts',
            label: 'PRTS Wiki',
            apiEndpoint: 'https://prts.wiki/api.php',
            pageBaseUrl: 'https://prts.wiki/index.php?curid=',
          },
        ],
        searchProviderPort: async () => {
          skippedCalls += 1;
          return [];
        },
      },
    );
    expect(skippedCalls).toBe(0);
    expect(l1OnlyRes.layer1Hits).toBe(1);
    expect(l1OnlyRes.layer2Hits).toBe(0);
  });

  it('generates a single RoleCard field while keeping all other fields untouched', async () => {
    const prompts: string[] = [];
    const llmSlot = {
      provider: 'openai' as const,
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      jsonModeStrategy: 'auto' as const,
    };

    const stringFieldRes = await generateCardField(sampleContent, 'appearance', {
      llmSlot,
      workName: '明日方舟',
      sources: [
        {
          title: 'PRTS 档案',
          snippet: '常穿深青色制式风衣，指节佩戴多枚黑色抑制戒指。',
          origin: 'search_supplement',
          provider: 'prts',
        },
      ],
      llmPort: async (req) => {
        prompts.push(req.messages.map((m) => m.content).join('\n'));
        return {
          status: 200,
          content: JSON.stringify({
            value: '身材纤瘦的棕发兔耳少女，深青色制式风衣搭配十指黑色抑制戒指。',
          }),
        };
      },
    });

    expect(stringFieldRes.ok).toBe(true);
    if (!stringFieldRes.ok) throw new Error('expected ok');
    expect(stringFieldRes.value.content.appearance).toContain('深青色制式风衣');
    expect(stringFieldRes.value.content.background).toBe(sampleContent.background);
    expect(stringFieldRes.value.content.first_mes).toBe(sampleContent.first_mes);
    expect(prompts[0]).toContain('PRTS 档案');

    const speechRes = await generateCardField(sampleContent, 'speech_style', {
      llmSlot,
      llmPort: async () => ({
        status: 200,
        content: JSON.stringify({
          value: {
            tone: '礼貌坚毅、带有年轻领袖的克制感',
            catchphrases: ['博士，请放心交给我'],
            habits: ['作战略停顿后再下结论'],
          },
        }),
      }),
    });
    expect(speechRes.ok).toBe(true);
    if (!speechRes.ok) throw new Error('expected ok');
    expect(speechRes.value.content.speech_style.catchphrases).toEqual(['博士，请放心交给我']);
  });

  it('supports realistic preset, blank/free mode without forced style constraint, and customStylePrompt overrides', async () => {
    const capturedSystems: string[] = [];
    const mockPort: LlmCompletionPort = async (req) => {
      capturedSystems.push(req.messages.find((m) => m.role === 'system')?.content ?? '');
      return {
        status: 200,
        content: JSON.stringify({
          prompt: 'portrait of Amiya, cinematic lighting',
          negativePrompt: 'blurry',
          notes: '按指定风格或自由要求提炼生图提示词。',
        }),
      };
    };

    const llmSlot = {
      provider: 'openai' as const,
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      jsonModeStrategy: 'auto' as const,
    };

    const realisticRes = await generateOrOptimizePortraitPrompt(
      {
        card: { characterName: 'Amiya' },
        mode: 'generate',
        style: 'realistic',
      },
      { llmPort: mockPort, llmSlot },
    );
    expect(realisticRes.ok).toBe(true);
    expect(capturedSystems[0]).toContain('photorealistic character portrait');
    expect(capturedSystems[0]).toContain('anime, cartoon, illustration');

    const blankRes = await generateOrOptimizePortraitPrompt(
      {
        card: { characterName: 'Amiya' },
        mode: 'optimize',
        style: 'blank',
        draftPrompt: 'cyberpunk ink wash painting, Amiya',
        instruction: '保持赛博水墨质感',
      },
      { llmPort: mockPort, llmSlot },
    );
    expect(blankRes.ok).toBe(true);
    expect(capturedSystems[1]).toContain('当前未指定固定画风预设（自由风格）');
    expect(capturedSystems[1]).not.toContain('必须严格遵循用户指定的画风基底');

    const customOverrideRes = await generateOrOptimizePortraitPrompt(
      {
        card: { characterName: 'Amiya' },
        mode: 'generate',
        style: 'anime',
        customStylePrompt: 'ukiyo-e woodblock print portrait, flat mineral pigments',
        customNegativeHint: '3d, photorealistic',
      },
      { llmPort: mockPort, llmSlot },
    );
    expect(customOverrideRes.ok).toBe(true);
    expect(capturedSystems[2]).toContain('ukiyo-e woodblock print portrait');
    expect(capturedSystems[2]).not.toContain('cel-shaded');
    expect(capturedSystems[2]).toContain('3d, photorealistic');
  });

  it('fetches remote images via fetchRemoteImageBuffer with SSRF, magic bytes, size limit, and Fake-IP handling', async () => {
    const validPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

    let capturedUserAgent = '';
    const mockFetch: HttpFetchPort = async (url, init) => {
      capturedUserAgent = new Headers(init?.headers).get('user-agent') ?? '';
      if (url.includes('valid.png')) {
        return new Response(new Uint8Array(validPng), { status: 200 });
      }
      if (url.includes('valid.jpg')) {
        return new Response(new Uint8Array(validJpeg), { status: 200 });
      }
      if (url.includes('html-page')) {
        return new Response('<html>not an image</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (url.includes('rate-limited')) {
        return new Response('Too Many Requests', { status: 429 });
      }
      return new Response('Not Found', { status: 404 });
    };

    const okPng = await fetchRemoteImageBuffer('https://upload.wikimedia.org/valid.png', {
      fetchImpl: mockFetch,
      dnsLookup: publicDns,
    });
    expect(okPng.ok).toBe(true);
    if (okPng.ok) {
      expect(okPng.value.contentType).toBe('image/png');
      expect(okPng.value.buffer).toEqual(validPng);
    }
    expect(capturedUserAgent).toContain('RoleCardStudio/1.0');

    const okJpg = await fetchRemoteImageBuffer('https://upload.wikimedia.org/valid.jpg', {
      fetchImpl: mockFetch,
      dnsLookup: publicDns,
    });
    expect(okJpg.ok).toBe(true);
    if (okJpg.ok) {
      expect(okJpg.value.contentType).toBe('image/jpeg');
    }

    const htmlRejected = await fetchRemoteImageBuffer('https://upload.wikimedia.org/html-page', {
      fetchImpl: mockFetch,
      dnsLookup: publicDns,
    });
    expect(htmlRejected.ok).toBe(false);
    if (!htmlRejected.ok) {
      expect(htmlRejected.error.code).toBe('INVALID_IMAGE_MAGIC');
    }

    const tooLarge = await fetchRemoteImageBuffer('https://upload.wikimedia.org/valid.png', {
      fetchImpl: mockFetch,
      dnsLookup: publicDns,
      maxBytes: 8,
    });
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) {
      expect(tooLarge.error.code).toBe('IMAGE_TOO_LARGE');
    }

    const rateLimited = await fetchRemoteImageBuffer('https://upload.wikimedia.org/rate-limited', {
      fetchImpl: mockFetch,
      dnsLookup: publicDns,
    });
    expect(rateLimited.ok).toBe(false);
    if (!rateLimited.ok) {
      expect(rateLimited.error.status).toBe(429);
    }

    // Fake-IP 198.18.x.x respected via scoped media fetch allowFakeIp flag
    const fakeIpDns: DnsLookupPort = async () => [{ address: '198.18.3.185', family: 4 }];
    const baseProxyCfg: RuntimeProxyConfig = {
      globalEnabled: false,
      globalUrl: '',
      bypassLocal: true,
      allowFakeIp: false,
      useEnvProxy: false,
      overrides: {},
    };
    const fakeIpBlocked = await fetchRemoteImageBuffer('https://thumb.wikimedia.org/valid.png', {
      fetchImpl: createScopedProxyFetch(baseProxyCfg, 'media', mockFetch, {}),
      dnsLookup: fakeIpDns,
    });
    expect(fakeIpBlocked.ok).toBe(false);
    if (!fakeIpBlocked.ok) {
      expect(fakeIpBlocked.error.code).toBe('SSRF_IP_BLOCKED');
    }

    const fakeIpAllowed = await fetchRemoteImageBuffer('https://thumb.wikimedia.org/valid.png', {
      fetchImpl: createScopedProxyFetch(
        { ...baseProxyCfg, allowFakeIp: true },
        'media',
        mockFetch,
        {},
      ),
      dnsLookup: fakeIpDns,
    });
    expect(fakeIpAllowed.ok).toBe(true);
  });
});

describe('Free provider capabilities, multi-dialect image generation & OpenRouter attribution', () => {
  it('validates all FREE_STARTER_PRESETS models and new capability regexes', () => {
    for (const preset of FREE_STARTER_PRESETS) {
      expect(
        validateModelSlotCapability({
          slotType: 'primary',
          provider: preset.slots.primary.provider,
          model: preset.slots.primary.model,
        }).ok,
      ).toBe(true);

      if (preset.slots.chat) {
        expect(
          validateModelSlotCapability({
            slotType: 'chat',
            provider: preset.slots.chat.provider,
            model: preset.slots.chat.model,
          }).ok,
        ).toBe(true);
      }
      if (preset.slots.vision) {
        expect(
          validateModelSlotCapability({
            slotType: 'vision',
            provider: preset.slots.vision.provider,
            model: preset.slots.vision.model,
          }).ok,
        ).toBe(true);
      }
      if (preset.slots.image) {
        expect(
          validateModelSlotCapability({
            slotType: 'image',
            provider: preset.slots.image.provider,
            model: preset.slots.image.model,
          }).ok,
        ).toBe(true);
      }
    }

    for (const [provider, meta] of Object.entries(LLM_PROVIDER_DEFAULTS)) {
      for (const [slotType, rec] of Object.entries(meta.recommendedSlots ?? {})) {
        if (!rec) continue;
        expect(
          validateModelSlotCapability({
            slotType: slotType as LlmSlotPurpose,
            provider: provider as LlmProvider,
            model: rec.model,
          }).ok,
        ).toBe(true);
        for (const chip of rec.chips ?? []) {
          expect(
            validateModelSlotCapability({
              slotType: slotType as LlmSlotPurpose,
              provider: provider as LlmProvider,
              model: chip.id,
            }).ok,
          ).toBe(true);
        }
      }
    }

    expect(
      validateModelSlotCapability({
        slotType: 'image',
        provider: 'zhipu',
        model: 'cogview-3-flash',
      }).ok,
    ).toBe(true);
    expect(
      validateModelSlotCapability({
        slotType: 'image',
        provider: 'zhipu',
        model: 'glm-image',
      }).ok,
    ).toBe(true);
    expect(
      validateModelSlotCapability({
        slotType: 'image',
        provider: 'modelscope',
        model: 'Tongyi-MAI/Z-Image-Turbo',
      }).ok,
    ).toBe(true);
    expect(
      validateModelSlotCapability({
        slotType: 'vision',
        provider: 'zhipu',
        model: 'glm-4.6v-flash',
      }).ok,
    ).toBe(true);
    expect(
      validateModelSlotCapability({
        slotType: 'vision',
        provider: 'zhipu',
        model: 'glm-4.7-flash',
      }).ok,
    ).toBe(false);
    expect(
      validateModelSlotCapability({
        slotType: 'vision',
        provider: 'hunyuan',
        model: 'hunyuan-lite',
      }).ok,
    ).toBe(false);
    expect(
      validateModelSlotCapability({
        slotType: 'vision',
        provider: 'hunyuan',
        model: 'hunyuan-vision',
      }).ok,
    ).toBe(true);
  });

  it('adapts image generation payloads for SiliconFlow, Zhipu, ModelScope async polling, and OpenRouter headers', async () => {
    // 1. SiliconFlow: image_size + negative_prompt + images[0].url
    const sfBodies: Array<Record<string, unknown>> = [];
    const sfFetch: HttpFetchPort = async (_url, init) => {
      sfBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response(
        JSON.stringify({ images: [{ url: 'https://sf-cdn.example.com/kolors.png' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const kolorsRes = await generatePortraitImage(
      { prompt: '1girl, anime portrait', negativePrompt: 'lowres, bad hands', size: '1024x1536' },
      {
        provider: 'siliconflow',
        apiKey: 'sk-sf',
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'Kwai-Kolors/Kolors',
        jsonModeStrategy: 'auto',
      },
      'Kwai-Kolors/Kolors',
      { fetchImpl: sfFetch },
    );
    expect(kolorsRes.ok).toBe(true);
    if (kolorsRes.ok) {
      expect(kolorsRes.value.imageUrl).toBe('https://sf-cdn.example.com/kolors.png');
    }
    expect(sfBodies[0]?.image_size).toBe('960x1280');
    expect(sfBodies[0]?.size).toBeUndefined();
    expect(sfBodies[0]?.response_format).toBeUndefined();
    expect(sfBodies[0]?.negative_prompt).toBe('lowres, bad hands');

    const qwenImgRes = await generatePortraitImage(
      { prompt: '1girl, anime portrait', size: '1024x1536' },
      {
        provider: 'siliconflow',
        apiKey: 'sk-sf',
        baseUrl: 'https://api.siliconflow.cn/v1',
        model: 'Qwen/Qwen-Image',
        jsonModeStrategy: 'auto',
      },
      'Qwen/Qwen-Image',
      { fetchImpl: sfFetch },
    );
    expect(qwenImgRes.ok).toBe(true);
    expect(sfBodies[1]?.image_size).toBe('1056x1584');

    // 2. Zhipu BigModel: { model, prompt, size } without n/response_format
    let zhipuBody: Record<string, unknown> = {};
    const zhipuRes = await generatePortraitImage(
      { prompt: '1girl, oil painting', negativePrompt: 'ignored', size: '1024x1536' },
      {
        provider: 'zhipu',
        apiKey: 'zhipu-key',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'cogview-3-flash',
        jsonModeStrategy: 'auto',
      },
      'cogview-3-flash',
      {
        fetchImpl: async (_url, init) => {
          zhipuBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          return new Response(
            JSON.stringify({ data: [{ url: 'https://zhipu-cdn.example.com/cogview.png' }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
      },
    );
    expect(zhipuRes.ok).toBe(true);
    if (zhipuRes.ok) {
      expect(zhipuRes.value.imageUrl).toBe('https://zhipu-cdn.example.com/cogview.png');
    }
    expect(zhipuBody).toEqual({
      model: 'cogview-3-flash',
      prompt: '1girl, oil painting',
      size: '1024x1536',
    });

    // 3. ModelScope async task creation + polling + testLlmConnectivity integration
    let pollCount = 0;
    const msRequests: Array<{ url: string; method: string; headers: Headers; body?: string }> = [];
    const msFetch: HttpFetchPort = async (url, init) => {
      const headers = new Headers(init?.headers);
      msRequests.push({
        url,
        method: init?.method ?? 'GET',
        headers,
        body: init?.body ? String(init.body) : undefined,
      });
      if (url.endsWith('/images/generations')) {
        return new Response(JSON.stringify({ task_id: 'ms-task-42' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/tasks/ms-task-42')) {
        pollCount += 1;
        if (pollCount === 1) {
          return new Response(JSON.stringify({ task_status: 'RUNNING' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({
            task_status: 'SUCCEED',
            output_images: ['https://ms-oss.example.com/out.png'],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    };

    const progressSteps: string[] = [];
    const msProbe = await testLlmConnectivity(
      {
        slotType: 'image',
        provider: 'modelscope',
        apiKey: 'ms-token',
        baseUrl: 'https://api-inference.modelscope.cn/v1',
        model: 'Qwen/Qwen-Image',
        imagePollIntervalMs: 0,
        onProgress: (evt) => {
          progressSteps.push(evt.step);
        },
      },
      msFetch,
    );
    expect(msProbe.ok).toBe(true);
    expect(msRequests[0]?.headers.get('x-modelscope-async-mode')).toBe('true');
    expect(msRequests[1]?.url).toBe('https://api-inference.modelscope.cn/v1/tasks/ms-task-42');
    expect(msRequests[1]?.headers.get('x-modelscope-task-type')).toBe('image_generation');
    expect(progressSteps).toContain('polling');

    // 4. ModelScope FAILED task surfaces clean error
    const msFailRes = await generatePortraitImage(
      { prompt: 'test' },
      {
        provider: 'modelscope',
        apiKey: 'ms-token',
        baseUrl: 'https://api-inference.modelscope.cn/v1',
        model: 'Tongyi-MAI/Z-Image-Turbo',
        jsonModeStrategy: 'auto',
      },
      'Tongyi-MAI/Z-Image-Turbo',
      {
        pollIntervalMs: 0,
        fetchImpl: async (url) => {
          if (url.endsWith('/images/generations')) {
            return new Response(JSON.stringify({ task_id: 'ms-fail' }), { status: 200 });
          }
          return new Response(
            JSON.stringify({ task_status: 'FAILED', errors: { message: 'nsfw blocked' } }),
            { status: 200 },
          );
        },
      },
    );
    expect(msFailRes.ok).toBe(false);
    if (!msFailRes.ok) {
      expect(msFailRes.error.message).toContain('nsfw blocked');
    }

    // 5. OpenRouter attribution headers
    let capturedOrTitle = '';
    const orPort = createOpenAiCompatibleLlmPort(async (_url, init) => {
      capturedOrTitle = new Headers(init?.headers).get('x-title') ?? '';
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const orReply = await orPort({
      provider: 'openrouter',
      apiKey: 'or-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/free',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0,
      jsonMode: false,
    });
    expect(orReply.content).toBe('OK');
    expect(capturedOrTitle).toBe('RoleCard Studio');
  });
});

describe('Existing card source selection, refine injection, and single-field generation', () => {
  it('prioritizes latest sources by default and respects explicit sourceIndices without dropping index >= 4', async () => {
    const sources = Array.from({ length: 7 }, (_, i) => ({
      title: `参考资料-${i + 1}`,
      snippet: `这是第 ${i + 1} 条补充考据正文。`,
      origin: i >= 4 ? ('user_provided' as const) : ('search_supplement' as const),
      provider: i >= 4 ? 'user_text' : 'prts',
    }));

    // Default mode keeps latest 6 entries so newly added entries (#5-#7) are never silently dropped
    const defaultSnippets = selectSourcesForGeneration(sources);
    expect(defaultSnippets).toContain('参考资料-7');
    expect(defaultSnippets).toContain('参考资料-5');
    expect(defaultSnippets).not.toContain('参考资料-1');

    // Explicit sourceIndices filters and deduplicates while ignoring out-of-range values
    const explicitSnippets = selectSourcesForGeneration(sources, [0, 6, 6, 99, -1]);
    expect(explicitSnippets).toContain('[参考资料 #1 · 检索补充] 参考资料-1');
    expect(explicitSnippets).toContain('[参考资料 #7 · 用户提供] 参考资料-7');
    expect(explicitSnippets).not.toContain('参考资料-2');

    const llmSlot = {
      provider: 'openai' as const,
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      jsonModeStrategy: 'auto' as const,
    };

    const capturedRefinePrompts: string[] = [];
    const refineRes = await refineRoleCard(sampleContent, '结合第7条最新设定微调背景，不要改性格', {
      llmSlot,
      lockedFields: ['personality'],
      sources,
      sourceIndices: [6],
      workName: '明日方舟',
      llmPort: async (req) => {
        capturedRefinePrompts.push(req.messages.map((m) => m.content).join('\n'));
        return {
          status: 200,
          content: JSON.stringify({
            ...sampleContent,
            personality: '被错误修改的性格',
            background: '融合第 7 条最新设定后的背景故事',
          }),
        };
      },
    });

    expect(refineRes.ok).toBe(true);
    if (!refineRes.ok) throw new Error('expected refine ok');
    expect(capturedRefinePrompts[0]).toContain('参考资料-7');
    expect(capturedRefinePrompts[0]).not.toContain('参考资料-2');
    expect(refineRes.value.content.personality).toBe(sampleContent.personality);
    expect(refineRes.value.content.background).toBe('融合第 7 条最新设定后的背景故事');

    const capturedFieldPrompts: string[] = [];
    const fieldRes = await generateCardField(sampleContent, 'creator_notes', {
      llmSlot,
      sources,
      sourceIndices: [5],
      llmPort: async (req) => {
        capturedFieldPrompts.push(req.messages.map((m) => m.content).join('\n'));
        return {
          status: 200,
          content: JSON.stringify({ value: '依据第 6 条资料更新的作者备注。' }),
        };
      },
    });

    expect(fieldRes.ok).toBe(true);
    expect(capturedFieldPrompts[0]).toContain('参考资料-6');
    expect(capturedFieldPrompts[0]).not.toContain('参考资料-1');
  });
});

describe('Idle-reset streaming timeout, truncation rescue, and material token budget', () => {
  it('keeps slow steady token streams alive across idle resets and aborts true stalls', async () => {
    const encoder = new TextEncoder();
    const steadyFetch: HttpFetchPort = async () => {
      const stream = new ReadableStream({
        async start(controller) {
          const chunks = [
            'data: {"choices":[{"delta":{"content":"<thought>slow thinking"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":" step 2</thought>"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}\n\n',
            'data: [DONE]\n\n',
          ];
          for (const chunk of chunks) {
            await new Promise((resolve) => setTimeout(resolve, 350));
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };

    const steadyPort = createOpenAiCompatibleLlmPort(steadyFetch, {
      idleTimeoutMs: 1_000,
      totalTimeoutMs: 4_000,
    });
    const okRes = await steadyPort({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0,
      jsonMode: false,
      onReasoningDelta: () => {},
      onContentDelta: () => {},
    });
    expect(okRes.status).toBe(200);
    expect(okRes.content).toBe('{"ok":true}');
    expect(okRes.reasoning).toContain('slow thinking step 2');

    // Stalled stream (> idleTimeoutMs without data) should abort with idle timeout
    const stalledFetch: HttpFetchPort = async (_url, init) => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"start"}}]}\n\n'));
          init?.signal?.addEventListener('abort', () => {
            try {
              controller.error(new DOMException('Aborted', 'AbortError'));
            } catch {
              // ignore
            }
          });
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };

    const stalledPort = createOpenAiCompatibleLlmPort(stalledFetch, {
      idleTimeoutMs: 1_000,
      totalTimeoutMs: 4_000,
    });
    const stalledRes = await stalledPort({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0,
      jsonMode: false,
      onReasoningDelta: () => {},
      onContentDelta: () => {},
    });
    expect(stalledRes.status).toBe(502);
    expect(stalledRes.rawError).toContain('流式空闲超时');
  });

  it('strips unclosed think/thought/reasoning tags, extracts last valid JSON, and repairs truncated JSON', () => {
    const unclosed = splitThinkTags('<THOUGHT>很长很长的思考过程被截断了');
    expect(unclosed.content).toBe('');
    expect(unclosed.reasoning).toContain('很长很长的思考过程被截断了');

    const mixed =
      '<reasoning>分析中</reasoning>示例说明：用 {{user}} 称呼玩家。\n```json\n{"wrong": 1}\n```\n最终结果：\n```json\n{"name":"凯尔希","summary":"罗德岛医生"}\n```';
    expect(JSON.parse(extractJsonCandidate(mixed))).toEqual({
      name: '凯尔希',
      summary: '罗德岛医生',
    });

    const unclosedFence = '```json\n{"name":"阿米娅","tags":["罗德岛"';
    const candidate = extractJsonCandidate(unclosedFence);
    const repaired = repairTruncatedJson(candidate);
    expect(JSON.parse(repaired)).toEqual({
      name: '阿米娅',
      tags: ['罗德岛'],
    });
  });

  it('handles finishReason=length truncation without snowballing and recovers with low reasoningEffort', async () => {
    const schema = z.object({
      name: z.string().min(1),
      summary: z.string().min(1),
    });

    const recordedEfforts: Array<string | undefined> = [];
    const recordedMessageCounts: number[] = [];
    let attempt = 0;

    const recoveringPort: LlmCompletionPort = async (req) => {
      attempt += 1;
      recordedEfforts.push(req.reasoningEffort);
      recordedMessageCounts.push(req.messages.length);
      if (attempt === 1) {
        return {
          status: 200,
          content: '',
          reasoning: '超过五万字的思考过程...',
          finishReason: 'length',
        };
      }
      if (req.reasoningEffort === 'low') {
        return {
          status: 400,
          content: '',
          rawError: 'reasoning_effort unsupported',
          reasoningEffortRejected: true,
        };
      }
      return {
        status: 200,
        content: JSON.stringify({ name: '阿米娅', summary: '罗德岛公开领袖' }),
        finishReason: 'stop',
      };
    };

    const recovered = await completeStructuredJson(recoveringPort, {
      slot: {
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        model: 'o3-mini',
        jsonModeStrategy: 'auto',
        maxTokens: 16384,
      },
      messages: [{ role: 'user', content: '请输出角色 JSON' }],
      schema,
      schemaHint: '{"name":"","summary":""}',
      temperature: 0.4,
    });

    expect(recovered.ok).toBe(true);
    expect(recordedEfforts[1]).toBe('low');
    // Skipped snowballing full assistant error message on empty/truncated output
    expect(recordedMessageCounts[1]).toBe(2);

    // Persistent truncation returns LLM_OUTPUT_TRUNCATED
    const alwaysTruncatedPort: LlmCompletionPort = async () => ({
      status: 200,
      content: '',
      reasoning: '思考耗尽了所有 max_tokens',
      finishReason: 'length',
    });

    const truncatedRes = await completeStructuredJson(alwaysTruncatedPort, {
      slot: {
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        jsonModeStrategy: 'auto',
        maxTokens: 16384,
      },
      messages: [{ role: 'user', content: '请输出角色 JSON' }],
      schema,
      schemaHint: '{"name":"","summary":""}',
      temperature: 0.4,
    });
    expect(truncatedRes.ok).toBe(false);
    if (!truncatedRes.ok) {
      expect(truncatedRes.error.code).toBe('LLM_OUTPUT_TRUNCATED');
    }
  });

  it('caps total material tokens in generateRoleCard so massive retrieved sources do not overflow context', async () => {
    let capturedPromptLength = 0;
    const hugeSnippet = '这是一段极长的角色考据百科资料文本，包含大量细节设定。'.repeat(600);
    const hugeSources = Array.from({ length: 8 }, (_, idx) => ({
      title: `巨型百科词条-${idx + 1}`,
      snippet: hugeSnippet,
      origin: 'search_supplement' as const,
      provider: 'wikipedia_zh',
    }));

    const res = await generateRoleCard(
      {
        mode: 'C',
        characterName: '阿米娅',
        workName: '明日方舟',
        cardType: 'general',
        entityType: 'fictional',
        referenceText: '用户输入设定：'.repeat(900),
        referenceUrls: [],
        visionDescription: '',
        enableSupplementSearch: true,
        tags: ['罗德岛'],
        lorebookIds: [],
        customPrompt: '',
      },
      {
        llmPort: async (req) => {
          capturedPromptLength = req.messages.map((m) => m.content).join('\n').length;
          return {
            status: 200,
            content: JSON.stringify(sampleContent),
          };
        },
        llmSlot: {
          provider: 'openai',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        enableLayer1Wiki: false,
        wikiSites: [],
        searchProvider: 'bocha',
        searchApiKey: 'test-key',
        searchProviderPort: async () => hugeSources,
      },
    );

    expect(res.ok).toBe(true);
    // Without budget capping, 8 x ~15000 chars + ~5400 chars would be >125k chars.
    expect(capturedPromptLength).toBeLessThan(28000);
  });
});

describe('Tags append-dedupe, TRPG exempt compress, TRPG thinking stream, and regenerateRoleCard', () => {
  const llmSlot = {
    provider: 'openai' as const,
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    jsonModeStrategy: 'auto' as const,
  };

  it('merges and deduplicates tags on generateCardField("tags") and emits unified progress text', async () => {
    const existing = {
      ...sampleContent,
      tags: ['明日方舟', 'Rhodes', '罗德岛'],
    };
    expect(
      mergeCardTagsDedupe(['#明日方舟', 'rhodes'], ['RHODES', '#奇美拉', '感染者', '明日方舟']),
    ).toEqual(['明日方舟', 'rhodes', '奇美拉', '感染者']);

    const progressMsgs: string[] = [];
    const res = await generateCardField(existing, 'tags', {
      llmSlot,
      onProgress: (evt) => {
        progressMsgs.push(evt.message);
      },
      llmPort: async () => ({
        status: 200,
        content: JSON.stringify({
          value: ['#罗德岛', 'rhodes', '年轻领袖', '术士'],
        }),
      }),
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.content.tags).toEqual(['明日方舟', 'Rhodes', '罗德岛', '年轻领袖', '术士']);
    expect(res.value.diffSummary).toContain('追加 2 个');
    expect(progressMsgs.some((m) => m.includes('gpt-4o-mini') && m.includes('角色标签'))).toBe(true);
  });

  it('excludes extensions (TRPG panel) from compressRoleCard LLM prompt and restores it intact', async () => {
    const cardWithTrpg: RoleCardContent = {
      ...sampleContent,
      extensions: {
        trpg: {
          system: 'Call of Cthulhu 7e',
          occupation: '罗德岛首席执行官',
          characteristics: { STR: 45, INT: 85, POW: 90 },
        },
      },
    };

    let capturedUserPrompt = '';
    let capturedSystemPrompt = '';
    const res = await compressRoleCard(cardWithTrpg, 500, {
      llmSlot,
      lockedFields: ['first_mes'],
      llmPort: async (req) => {
        capturedSystemPrompt = req.messages[0]?.content ?? '';
        capturedUserPrompt = req.messages[1]?.content ?? '';
        return {
          status: 200,
          content: JSON.stringify({
            ...sampleContent,
            summary: '精简后的简介',
            first_mes: '被篡改的开场白',
            extensions: { trpg: { mutated: true } },
          }),
        };
      },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(capturedSystemPrompt).not.toContain('无损');
    expect(capturedUserPrompt).not.toContain('Call of Cthulhu 7e');
    expect(res.value.content.summary).toBe('精简后的简介');
    expect(res.value.content.first_mes).toBe(cardWithTrpg.first_mes);
    expect(res.value.content.extensions).toEqual(cardWithTrpg.extensions);
  });

  it('regenerates all unlocked sections while preserving locked fields, name, and extensions, and rejects all-locked cards', async () => {
    const cardWithTrpg: RoleCardContent = {
      ...sampleContent,
      extensions: { trpg: { system: 'D&D 5e', level: 5 } },
    };

    const allLockedRes = await regenerateRoleCard(cardWithTrpg, {
      llmSlot,
      lockedFields: [
        'summary',
        'personality',
        'appearance',
        'background',
        'speech_style',
        'relationships',
        'first_mes',
        'alternate_greetings',
        'mes_example',
        'system_prompt',
        'scenario',
        'creator_notes',
        'tags',
      ],
      llmPort: async () => ({ status: 200, content: '{}' }),
    });
    expect(allLockedRes.ok).toBe(false);
    if (!allLockedRes.ok) {
      expect(allLockedRes.error.code).toBe('ALL_FIELDS_LOCKED');
    }

    const progressMsgs: string[] = [];
    const regenRes = await regenerateRoleCard(cardWithTrpg, {
      llmSlot,
      lockedFields: ['personality', 'tags'],
      onProgress: (evt) => {
        progressMsgs.push(evt.message);
      },
      llmPort: async () => ({
        status: 200,
        content: JSON.stringify({
          ...sampleContent,
          name: '被改掉的名字',
          summary: '一键重生成后的核心简介',
          personality: '不该生效的性格',
          first_mes: '一键重生成后的开场白',
          tags: ['不该覆盖的标签'],
          extensions: {},
        }),
      }),
    });

    expect(regenRes.ok).toBe(true);
    if (!regenRes.ok) return;
    expect(regenRes.value.content.name).toBe(cardWithTrpg.name);
    expect(regenRes.value.content.summary).toBe('一键重生成后的核心简介');
    expect(regenRes.value.content.first_mes).toBe('一键重生成后的开场白');
    expect(regenRes.value.content.personality).toBe(cardWithTrpg.personality);
    expect(regenRes.value.content.tags).toEqual(cardWithTrpg.tags);
    expect(regenRes.value.content.extensions).toEqual(cardWithTrpg.extensions);
    expect(regenRes.value.skippedLockedFields).toEqual(['personality', 'tags']);
    expect(progressMsgs.some((m) => m.includes('gpt-4o-mini'))).toBe(true);
  });

  it('forwards progress and reasoning deltas during generateTrpgAttributesForCard', async () => {
    const progressMsgs: string[] = [];
    const thoughts: string[] = [];

    const res = await generateTrpgAttributesForCard(sampleContent, 'coc7e', {
      llmSlot,
      onProgress: (evt) => {
        progressMsgs.push(evt.message);
      },
      onReasoningDelta: (delta) => {
        thoughts.push(delta);
      },
      llmPort: async (req) => {
        await req.onReasoningDelta?.('先评估阿米娅的精神力与学识...');
        return {
          status: 200,
          content: JSON.stringify({
            trpg: {
              system: 'Call of Cthulhu 7e',
              occupation: '危机应对指挥官',
              era: '近代架空',
              characteristics: { STR: 40, CON: 55, SIZ: 45, DEX: 65, APP: 70, INT: 80, POW: 90, EDU: 75 },
              derived: { HP: 10, MP: 18, SAN: 85, Luck: 60, Move: 8 },
              keySkills: ['心理学 70%', '说服 75%'],
            },
          }),
        };
      },
    });

    expect(res.ok).toBe(true);
    expect(thoughts.join('')).toContain('先评估阿米娅的精神力与学识');
    expect(progressMsgs.some((m) => m.includes('gpt-4o-mini') && m.includes('CoC 7e'))).toBe(true);
  });
});

describe('Dual TRPG system coexistence, switching, targeted export & playtest injection', () => {
  const llmSlot = {
    provider: 'openai' as const,
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    jsonModeStrategy: 'auto' as const,
  };

  it('stores CoC 7e and D&D 5e in separate buckets, supports active switching, targeted export, and edit reconciliation', async () => {
    // 1. Generate CoC 7e (activates coc7e)
    const cocRes = await generateTrpgAttributesForCard(sampleContent, 'coc7e', {
      llmSlot,
      activate: true,
      llmPort: async () => ({
        status: 200,
        content: JSON.stringify({
          trpg: {
            system: 'Call of Cthulhu 7e',
            occupation: '战术指挥官',
            era: '近代架空',
            characteristics: { STR: 45, CON: 55, SIZ: 45, DEX: 70, APP: 75, INT: 85, POW: 90, EDU: 80 },
            derived: { HP: 10, MP: 18, SAN: 85, Luck: 65, Move: 8 },
            keySkills: ['心理学 75%', '说服 80%'],
          },
        }),
      }),
    });
    expect(cocRes.ok).toBe(true);
    if (!cocRes.ok) return;

    // 2. Generate D&D 5e with activate=false -> both coexist and coc7e stays active
    const dndRes = await generateTrpgAttributesForCard(cocRes.value.content, 'dnd5e', {
      llmSlot,
      activate: false,
      llmPort: async () => ({
        status: 200,
        content: JSON.stringify({
          trpg: {
            system: 'D&D 5e',
            race: '卡特斯',
            className: '吟游诗人',
            alignment: '守序善良',
            level: 6,
            abilityScores: { STR: 8, DEX: 14, CON: 12, INT: 16, WIS: 14, CHA: 18 },
            combat: { AC: 15, MaxHP: 42, Speed: '30 ft', ProficiencyBonus: 3 },
            proficiencies: ['奥秘', '说服'],
            featuresAndTraits: ['奇美拉共鸣'],
          },
        }),
      }),
    });
    expect(dndRes.ok).toBe(true);
    if (!dndRes.ok) return;

    const dualContent = dndRes.value.content;
    expect(dndRes.value.cardType).toBe('trpg_coc7');
    const extracted = extractTrpgSystems(dualContent);
    expect(extracted.activeSystem).toBe('coc7e');
    expect(extracted.systems.coc7e?.occupation).toBe('战术指挥官');
    expect(extracted.systems.dnd5e?.className).toBe('吟游诗人');
    expect((dualContent.extensions.trpg as { occupation?: string }).occupation).toBe('战术指挥官');

    // 3. Foundry D&D 5e export still resolves dnd5e bucket even while CoC 7e is active!
    const actor = exportCardToFoundryDnd5eActor(dualContent, {
      cardType: 'trpg_coc7',
      workName: '明日方舟',
    }) as { system: { abilities: { cha: { value: number } } }; items: Array<{ name: string }> };
    expect(actor.system.abilities.cha.value).toBe(18);
    expect(actor.items.map((i) => i.name)).toContain('奇美拉共鸣');

    // Targeted sheet export selects requested rule
    const cocMd = exportCardToTrpgSheetMarkdown(dualContent, { trpgSystem: 'coc7e' });
    const dndMd = exportCardToTrpgSheetMarkdown(dualContent, { trpgSystem: 'dnd5e' });
    expect(cocMd).toContain('CoC 7e');
    expect(cocMd).toContain('战术指挥官');
    expect(dndMd).toContain('D&D 5e');
    expect(dndMd).toContain('吟游诗人');

    const dndHtml = exportCardToTrpgSheetHtml(dualContent, { trpgSystem: 'dnd5e' });
    expect(dndHtml).toContain('奇美拉共鸣');

    // 4. Switch active system to dnd5e
    const switched = switchActiveTrpgSystem(dualContent, 'dnd5e');
    expect(switched).not.toBeNull();
    expect(switched?.extensions.activeTrpgSystem).toBe('dnd5e');
    expect((switched?.extensions.trpg as { className?: string }).className).toBe('吟游诗人');

    // 5. Reconcile manual edit on inactive bucket without wiping active bucket
    const legacyMerged = mergeTrpgSystemData(
      sampleContent,
      'coc7e',
      { occupation: '研究员', characteristics: { STR: 40 } },
      { activate: true },
    );
    const dualMerged = mergeTrpgSystemData(
      legacyMerged,
      'dnd5e',
      { className: '法师', abilityScores: { INT: 18 } },
      { activate: false },
    );
    const editedInactive: RoleCardContent = {
      ...dualMerged,
      extensions: {
        ...dualMerged.extensions,
        trpgSystems: {
          ...(dualMerged.extensions.trpgSystems as Record<string, unknown>),
          dnd5e: {
            ...((dualMerged.extensions.trpgSystems as Record<string, Record<string, unknown>>).dnd5e ?? {}),
            className: '大法师',
          },
        },
      },
    };
    const reconciled = reconcileTrpgExtensionsOnEdit(dualMerged, editedInactive, 'trpg_coc7');
    expect(reconciled.activeSystem).toBe('coc7e');
    expect(
      ((reconciled.content.extensions.trpgSystems as Record<string, Record<string, unknown>>).dnd5e)
        ?.className,
    ).toBe('大法师');
    expect((reconciled.content.extensions.trpg as { occupation?: string }).occupation).toBe('研究员');

    // 6. refineRoleCard preserves both trpgSystems buckets
    const refined = await refineRoleCard(dualContent, '补充一句话简介', {
      llmSlot,
      llmPort: async () => ({
        status: 200,
        content: JSON.stringify({
          ...dualContent,
          summary: '补充后的简介',
          extensions: {},
        }),
      }),
    });
    expect(refined.ok).toBe(true);
    if (!refined.ok) return;
    const afterRefine = extractTrpgSystems(refined.value.content);
    expect(afterRefine.systems.coc7e?.occupation).toBe('战术指挥官');
    expect(afterRefine.systems.dnd5e?.className).toBe('吟游诗人');
  });

  it('injects selected TRPG system stats into runPlaytestTurn and supports trpgSystem="none"', async () => {
    const cocContent = mergeTrpgSystemData(
      sampleContent,
      'coc7e',
      {
        system: 'Call of Cthulhu 7e',
        occupation: '神秘学调查员',
        characteristics: { STR: 45, CON: 50, SIZ: 50, DEX: 65, APP: 70, INT: 85, POW: 90, EDU: 80 },
        derived: { HP: 10, MP: 18, SAN: 85, Luck: 60, Move: 8 },
        keySkills: ['心理学 75%', '克苏鲁神话 15%'],
      },
      { activate: true },
    );
    const dualContent = mergeTrpgSystemData(
      cocContent,
      'dnd5e',
      {
        system: 'D&D 5e',
        race: '卡特斯',
        className: '吟游诗人',
        level: 6,
        abilityScores: { STR: 8, DEX: 14, CON: 12, INT: 16, WIS: 14, CHA: 18 },
        combat: { AC: 15, MaxHP: 42, Speed: '30 ft', ProficiencyBonus: 3 },
        proficiencies: ['奥秘'],
        featuresAndTraits: ['奇美拉共鸣'],
      },
      { activate: false },
    );

    const capturedSystemPrompts: string[] = [];
    const mockPort: LlmCompletionPort = async (req) => {
      capturedSystemPrompts.push(req.messages[0]?.content ?? '');
      return { status: 200, content: '收到，准备检定。' };
    };

    // Default -> uses active (coc7e)
    const autoTurn = await runPlaytestTurn(
      dualContent,
      {
        message: '我观察走廊尽头的壁画',
        history: [],
        userName: 'KP',
        userPersona: '',
        greetingIndex: 0,
      },
      { llmSlot, llmPort: mockPort },
    );
    expect(autoTurn.ok).toBe(true);
    if (!autoTurn.ok) return;
    expect(autoTurn.value.trpgSystemInjected).toBe('coc7e');
    expect(capturedSystemPrompts[0]).toContain('神秘学调查员');
    expect(capturedSystemPrompts[0]).not.toContain('奇美拉共鸣');

    // Explicit dnd5e override
    const dndTurn = await runPlaytestTurn(
      dualContent,
      {
        message: '我准备施放法术',
        history: [],
        userName: 'DM',
        userPersona: '',
        greetingIndex: 0,
        trpgSystem: 'dnd5e',
      },
      { llmSlot, llmPort: mockPort },
    );
    expect(dndTurn.ok).toBe(true);
    if (!dndTurn.ok) return;
    expect(dndTurn.value.trpgSystemInjected).toBe('dnd5e');
    expect(capturedSystemPrompts[1]).toContain('吟游诗人');
    expect(capturedSystemPrompts[1]).toContain('奇美拉共鸣');
    expect(capturedSystemPrompts[1]).not.toContain('神秘学调查员');

    // Explicit none
    const noneTurn = await runPlaytestTurn(
      dualContent,
      {
        message: '普通日常对话',
        history: [],
        userName: '博士',
        userPersona: '',
        greetingIndex: 0,
        trpgSystem: 'none',
      },
      { llmSlot, llmPort: mockPort },
    );
    expect(noneTurn.ok).toBe(true);
    if (!noneTurn.ok) return;
    expect(noneTurn.value.trpgSystemInjected).toBeNull();
    expect(capturedSystemPrompts[2]).not.toContain('TRPG 规则面板');
  });
});




