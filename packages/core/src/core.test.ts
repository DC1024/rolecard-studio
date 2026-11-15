import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RoleCardContentSchema, type AccessPolicy } from '@rolecard/shared';
import { describe, expect, it } from 'vitest';
import {
  authorizeAdmin,
  authorizeExternalApiRequest,
  authorizePermission,
  completeStructuredJson,
  decryptSecret,
  encryptSecret,
  extractReadableHtml,
  generateRoleCard,
  hashPassword,
  isDisallowedIp,
  layeredRetrieve,
  loadOrCreateMasterKey,
  maskSecret,
  safeFetchText,
  validatePublicUrl,
  verifyPassword,
  type ActorContext,
  type DnsLookupPort,
  type HttpFetchPort,
  type LlmCompletionPort,
  type LlmCompletionRequest,
} from './index.js';

const publicDns: DnsLookupPort = async () => [{ address: '93.184.216.34', family: 4 }];

describe('crypto & secret masking', () => {
  it('generates and reuses 32-byte master key and round-trips AES-256-GCM', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rc-crypto-'));
    try {
      const keyPath = join(dir, '.master.key');
      const key1 = await loadOrCreateMasterKey(keyPath);
      const key2 = await loadOrCreateMasterKey(keyPath);
      expect(key1.length).toBe(32);
      expect(key1.equals(key2)).toBe(true);

      const info = await stat(keyPath);
      expect(info.isFile()).toBe(true);

      const secret = 'sk-proj-super-secret-value-9876';
      const encrypted = encryptSecret(secret, key1);
      expect(encrypted).not.toContain('9876');
      expect(decryptSecret(encrypted, key2)).toBe(secret);
      expect(maskSecret(secret)).toBe('****9876');
      expect(maskSecret('abc')).toBe('****');
      expect(maskSecret('')).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('hashes and verifies scrypt passwords safely', () => {
    const hash = hashPassword('MyStrongPass#123');
    expect(verifyPassword('MyStrongPass#123', hash)).toBe(true);
    expect(verifyPassword('WrongPass', hash)).toBe(false);
  });
});

describe('RBAC & access policy engine', () => {
  const guestPolicyPublic: AccessPolicy = {
    siteAccessMode: 'public',
    apiAccessMode: 'authenticated',
    guestPermissions: ['card:read'],
  };

  const loginRequiredPolicy: AccessPolicy = {
    siteAccessMode: 'login_required',
    apiAccessMode: 'public',
    guestPermissions: ['card:read'],
  };

  const normalUser: ActorContext = {
    userId: 'u-1',
    username: 'alice',
    role: 'user',
    permissions: ['card:read', 'card:create'],
    isActive: true,
  };

  const adminUser: ActorContext = {
    userId: 'a-1',
    username: 'root',
    role: 'admin',
    permissions: [],
    isActive: true,
  };

  it('enforces public vs login_required site access and fine-grained permissions', () => {
    expect(authorizePermission(null, guestPolicyPublic, 'card:read').ok).toBe(true);
    expect(authorizePermission(null, guestPolicyPublic, 'card:create').ok).toBe(false);
    expect(authorizePermission(null, loginRequiredPolicy, 'card:read').ok).toBe(false);

    expect(authorizePermission(normalUser, loginRequiredPolicy, 'card:create').ok).toBe(true);
    const deleteDenied = authorizePermission(normalUser, loginRequiredPolicy, 'card:delete');
    expect(deleteDenied.ok).toBe(false);
    if (!deleteDenied.ok) {
      expect(deleteDenied.error.status).toBe(403);
    }

    expect(authorizeAdmin(normalUser).ok).toBe(false);
    expect(authorizeAdmin(adminUser).ok).toBe(true);
  });

  it('enforces dual-state external API auth', () => {
    expect(authorizeExternalApiRequest(guestPolicyPublic, null, 'cards:read').ok).toBe(false);
    expect(authorizeExternalApiRequest(guestPolicyPublic, ['cards:read'], 'cards:read').ok).toBe(true);
    expect(authorizeExternalApiRequest(guestPolicyPublic, ['cards:read'], 'cards:write').ok).toBe(false);
    expect(authorizeExternalApiRequest(loginRequiredPolicy, null, 'cards:write').ok).toBe(true);
  });
});

describe('SSRF protection & readability extraction', () => {
  it('blocks private, loopback, cloud metadata, and IPv4-mapped IPv6 addresses', async () => {
    expect(isDisallowedIp('127.0.0.1')).toBe(true);
    expect(isDisallowedIp('10.20.30.40')).toBe(true);
    expect(isDisallowedIp('172.16.5.1')).toBe(true);
    expect(isDisallowedIp('192.168.1.10')).toBe(true);
    expect(isDisallowedIp('169.254.169.254')).toBe(true);
    expect(isDisallowedIp('::1')).toBe(true);
    expect(isDisallowedIp('::ffff:127.0.0.1')).toBe(true);
    expect(isDisallowedIp('93.184.216.34')).toBe(false);

    const localhostCheck = await validatePublicUrl('http://localhost:3000/secret', publicDns);
    expect(localhostCheck.ok).toBe(false);

    const dnsPoisonCheck = await validatePublicUrl('https://evil.example.com', async () => [
      { address: '169.254.169.254', family: 4 },
    ]);
    expect(dnsPoisonCheck.ok).toBe(false);
  });

  it('blocks redirects to internal IPs and enforces max redirect / size limits', async () => {
    const redirectFetch: HttpFetchPort = async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:8080/internal' },
      });

    const redirectRes = await safeFetchText('https://example.com/start', {
      dnsLookup: publicDns,
      fetchImpl: redirectFetch,
    });
    expect(redirectRes.ok).toBe(false);

    const oversizedFetch: HttpFetchPort = async () =>
      new Response('x'.repeat(256), {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });

    const sizeRes = await safeFetchText('https://example.com/big', {
      dnsLookup: publicDns,
      fetchImpl: oversizedFetch,
      maxBytes: 100,
    });
    expect(sizeRes.ok).toBe(false);
    if (!sizeRes.ok) {
      expect(sizeRes.error.code).toBe('RESPONSE_TOO_LARGE');
    }
  });

  it('extracts clean text from HTML via Readability', () => {
    const html = `<!doctype html><html><head><title>Keqing Bio</title></head><body>
      <nav>Menu Home Login</nav>
      <article><h1>Keqing</h1><p>Yuheng of the Liyue Qixing. She works tirelessly for Liyue.</p></article>
    </body></html>`;
    const extracted = extractReadableHtml(html);
    expect(extracted).not.toBeNull();
    expect(extracted?.title).toContain('Keqing');
    expect(extracted?.textContent).toContain('Liyue Qixing');
  });
});

describe('layered retrieval & 3-level JSON repair', () => {
  it('retrieves from MediaWiki Layer 1 without needing Search Key', async () => {
    const wikiFetch: HttpFetchPort = async (url) => {
      if (url.includes('list=search')) {
        return new Response(
          JSON.stringify({ query: { search: [{ pageid: 42, title: '刻晴' }] } }),
          { status: 200 },
        );
      }
      if (url.includes('extracts')) {
        return new Response(
          JSON.stringify({
            query: {
              pages: {
                '42': { pageid: 42, title: '刻晴', extract: '璃月七星之玉衡星，雷元素单手剑角色。' },
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    };

    const retrieved = await layeredRetrieve(
      { characterName: '刻晴', workName: '原神', enableLayer1Wiki: true },
      {
        dnsLookup: publicDns,
        fetchImpl: wikiFetch,
        wikiSites: [
          {
            id: 'moegirl',
            label: '萌娘百科',
            apiEndpoint: 'https://zh.moegirl.org.cn/api.php',
            pageBaseUrl: 'https://zh.moegirl.org.cn/index.php?curid=',
          },
        ],
      },
    );

    expect(retrieved.layer1Hits).toBe(1);
    expect(retrieved.sources[0]?.origin).toBe('search_supplement');
    expect(retrieved.sources[0]?.snippet).toContain('玉衡星');
  });

  it('falls back to Layer 2 search when Layer 1 returns zero hits', async () => {
    const retrieved = await layeredRetrieve(
      {
        characterName: '冷门原创角色',
        workName: '独立小说',
        enableLayer1Wiki: true,
        searchProvider: 'tavily',
        searchApiKey: 'tvly-key',
      },
      {
        wikiSites: [],
        searchProviderPort: async () => [
          {
            title: '冷门原创角色设定集',
            url: 'https://novel.example.com/char',
            snippet: '主角来自边境矿镇。',
            origin: 'search_supplement',
            provider: 'tavily',
          },
        ],
      },
    );

    expect(retrieved.layer1Hits).toBe(0);
    expect(retrieved.layer2Hits).toBe(1);
    expect(retrieved.sources[0]?.provider).toBe('tavily');
  });

  it('downgrades Level 1 -> Level 2 and heals ZodError in Level 3', async () => {
    const calls: LlmCompletionRequest[] = [];
    let downgraded = false;

    const flakyLlm: LlmCompletionPort = async (req) => {
      calls.push(req);
      if (req.jsonMode) {
        return {
          content: '',
          status: 400,
          rawError: 'response_format json_object is not supported',
          supportsJsonObjectRejected: true,
        };
      }
      if (calls.length === 2) {
        // Invalid JSON missing required "personality" + wrapped in markdown + trailing comma
        return {
          status: 200,
          content: '```json\n{"name":"卡芙卡","summary":"星核猎手",}\n```',
        };
      }
      return {
        status: 200,
        content: '{"name":"卡芙卡","summary":"星核猎手","personality":"冷静优雅、擅长言灵支配",}',
      };
    };

    const result = await completeStructuredJson(flakyLlm, {
      slot: {
        provider: 'custom',
        apiKey: 'test',
        baseUrl: 'https://llm.example.com/v1',
        model: 'local-7b',
        jsonModeStrategy: 'auto',
      },
      messages: [{ role: 'user', content: 'generate kafka' }],
      schema: RoleCardContentSchema,
      schemaHint: '{ "name": "", "summary": "", "personality": "" }',
      temperature: 0.4,
      onStrategyDowngraded: () => {
        downgraded = true;
      },
    });

    expect(downgraded).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.effectiveStrategy).toBe('prompt');
      expect(result.value.data.name).toBe('卡芙卡');
      expect(result.value.attempts).toBe(3);
    }
  });
});

describe('Mode A / B / C generation engine', () => {
  const validCardJson = JSON.stringify({
    name: '卡芙卡',
    summary: '星核猎手核心成员，优雅危险的支配者',
    personality: '表面从容微笑，内心深不可测',
    appearance: '酒红色长发与黑色风衣',
    background: '来自天衣五的星核猎手',
    speech_style: { tone: '慵懒磁性', catchphrases: ['听我说'], habits: ['微笑停顿'] },
    relationships: [{ target: '艾利欧', relation: '命运脚本执行者', attitude: '绝对信任' }],
    first_mes: '好久不见，准备好了吗？',
    alternate_greetings: [],
    mes_example: '<START>\n{{user}}: 你是谁？\n{{char}}: 只是个路过的猎手罢了。',
    system_prompt: '扮演卡芙卡。',
    scenario: '黑塔空间站',
    creator_notes: '[用户提供] 性格基调；[检索补充] 天衣五背景',
    tags: ['星铁', '星核猎手'],
    extensions: {},
  });

  const mockLlm: LlmCompletionPort = async () => ({
    status: 200,
    content: validCardJson,
  });

  it('rejects Mode A without user material and Mode B without retrieval hits', async () => {
    const modeAFail = await generateRoleCard(
      {
        mode: 'A',
        characterName: '测试角色',
        workName: '',
        cardType: 'sillytavern_v3',
        entityType: 'fictional',
        referenceText: '',
        referenceUrls: [],
        visionDescription: '',
        enableSupplementSearch: false,
        tags: [],
        lorebookIds: [],
        customPrompt: '',
      },
      {
        llmPort: mockLlm,
        llmSlot: {
          provider: 'openai',
          apiKey: 'k',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
      },
    );
    expect(modeAFail.ok).toBe(false);
    if (!modeAFail.ok) expect(modeAFail.error.code).toBe('NO_REFERENCE_MATERIAL');

    const modeBFail = await generateRoleCard(
      {
        mode: 'B',
        characterName: '不存在的角色XYZ',
        workName: '',
        cardType: 'sillytavern_v3',
        entityType: 'fictional',
        referenceText: '',
        referenceUrls: [],
        visionDescription: '',
        enableSupplementSearch: false,
        tags: [],
        lorebookIds: [],
        customPrompt: '',
      },
      {
        llmPort: mockLlm,
        llmSlot: {
          provider: 'openai',
          apiKey: 'k',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
        wikiSites: [],
      },
    );
    expect(modeBFail.ok).toBe(false);
    if (!modeBFail.ok) expect(modeBFail.error.code).toBe('NO_RETRIEVAL_RESULTS');
  });

  it('runs Mode C hybrid with User-First prompt and dual-origin sources', async () => {
    let capturedPrompt = '';
    const captureLlm: LlmCompletionPort = async (req) => {
      capturedPrompt = req.messages.map((m) => m.content).join('\n');
      return { status: 200, content: validCardJson };
    };

    const result = await generateRoleCard(
      {
        mode: 'C',
        characterName: '卡芙卡',
        workName: '崩坏：星穹铁道',
        cardType: 'sillytavern_v3',
        entityType: 'fictional',
        referenceText: '二创设定：她其实在暗中经营一家复古黑胶唱片店。',
        referenceUrls: [],
        visionDescription: '',
        enableSupplementSearch: false,
        tags: ['二创'],
        lorebookIds: [],
        customPrompt: '',
      },
      {
        llmPort: captureLlm,
        llmSlot: {
          provider: 'deepseek',
          apiKey: 'sk-test',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          jsonModeStrategy: 'auto',
        },
        wikiSites: [],
        searchProvider: 'tavily',
        searchApiKey: 'tvly-test',
        searchProviderPort: async () => [
          {
            title: '卡芙卡 - 崩坏：星穹铁道 Wiki',
            url: 'https://wiki.example.com/kafka',
            snippet: '星核猎手成员，通缉令悬赏金额极高。',
            origin: 'search_supplement',
            provider: 'tavily',
          },
        ],
      },
    );

    expect(result.ok).toBe(true);
    expect(capturedPrompt).toContain('[用户提供] 第一优先级参考材料');
    expect(capturedPrompt).toContain('[检索补充] 百科与网页考据资料');
    if (result.ok) {
      expect(result.value.temperature).toBe(0.4);
      expect(result.value.sources.some((s) => s.origin === 'user_provided')).toBe(true);
      expect(result.value.sources.some((s) => s.origin === 'search_supplement')).toBe(true);
      expect(result.value.content.tags).toContain('二创');
      expect(result.value.content.tags).toContain('星铁');
    }
  });
});
