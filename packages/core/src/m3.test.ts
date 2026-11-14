import { describe, expect, it } from 'vitest';
import type { RoleCardContent, SyncEventDto } from '@rolecard/shared';
import { createDefaultPortraitPng } from './ccv3.js';
import {
  MAX_RIPPLE_HOP,
  computeSourcesHash,
  computeStaggeredNextRunIso,
  evolveRoleCard,
  generateSingleHopRippleProposals,
} from './evolution.js';
import {
  deliverWebhookWithRetry,
  signWebhookPayload,
  verifyWebhookSignature,
} from './sync.js';
import type { DnsLookupPort, HttpFetchPort, LlmCompletionPort } from './types.js';
import { analyzePortraitWithVision, searchWikimediaCommonsImages } from './vision.js';

const baseCardContent: RoleCardContent = {
  name: '星野爱',
  summary: '极具魅力的偶像',
  personality: '开朗、职业化、内心细腻',
  appearance: '长发、星形瞳孔',
  background: '出身福利院后成为传说级偶像',
  speech_style: { tone: '元气偶像腔调', catchphrases: [], habits: [] },
  relationships: [],
  scenario: '东京巨蛋后台休息室',
  first_mes: '今天也要以最完美的笑容站上舞台！',
  mes_example: '<START>\n{{user}}: 准备好了吗？\n{{char}}: 当然。',
  system_prompt: '保持偶像的元气与神秘感。',
  creator_notes: '原始注记',
  tags: ['偶像', '舞台'],
  alternate_greetings: [],
  extensions: {},
};

const publicDns: DnsLookupPort = async () => [{ address: '93.184.216.34', family: 4 }];

describe('M3 core evolution, sync & vision', () => {
  it('computes deterministic staggered nextRunAt & skips evolution when source hash matches', async () => {
    const now = new Date('2026-11-15T00:00:00.000Z');
    const nextA = computeStaggeredNextRunIso(now, 7, 'card-alpha');
    const nextB = computeStaggeredNextRunIso(now, 7, 'card-beta');
    expect(nextA).not.toBe(nextB);
    expect(new Date(nextA).getTime()).toBeGreaterThanOrEqual(now.getTime() + 7 * 86400_000);

    const fetchImpl: HttpFetchPort = async (url) => {
      if (url.includes('prop=extracts')) {
        return new Response(
          JSON.stringify({
            query: {
              pages: {
                '1': { pageid: 1, title: '星野爱', extract: '新动画第二季热播设定补充。' },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          query: {
            search: [{ pageid: 1, title: '星野爱', snippet: '新动画第二季热播设定补充。' }],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const llmPort: LlmCompletionPort = async () => ({
      status: 200,
      content: JSON.stringify({
        content: {
          ...baseCardContent,
          summary: '更新后的简介',
          personality: '被锁定不应修改',
        },
        metaSummary: '粉丝常称呼其为传说中的偶像',
        changeReason: '补充第二季动态',
      }),
    });

    const firstRun = await evolveRoleCard(
      {
        cardId: 'card-alpha',
        characterName: '星野爱',
        workName: '我推的孩子',
        entityType: 'fictional',
        currentContent: baseCardContent,
        lockedFields: ['personality'],
        syncScope: 'both',
      },
      {
        fetchImpl,
        dnsLookup: publicDns,
        llmPort,
        llmSlot: {
          provider: 'openai',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
      },
    );

    expect(firstRun.ok).toBe(true);
    if (!firstRun.ok || firstRun.value.skipped) throw new Error('expected non-skipped evolution');
    expect(firstRun.value.updatedContent.summary).toBe('更新后的简介');
    expect(firstRun.value.updatedContent.personality).toBe(baseCardContent.personality);
    expect(firstRun.value.metaSummary).toContain('传说中的偶像');

    const secondRun = await evolveRoleCard(
      {
        cardId: 'card-alpha',
        characterName: '星野爱',
        workName: '我推的孩子',
        entityType: 'fictional',
        currentContent: firstRun.value.updatedContent,
        lockedFields: ['personality'],
        syncScope: 'both',
        lastSourceHash: firstRun.value.sourceHash,
      },
      {
        fetchImpl,
        dnsLookup: publicDns,
        llmPort,
        llmSlot: {
          provider: 'openai',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
      },
    );

    expect(secondRun.ok).toBe(true);
    if (!secondRun.ok) throw new Error('expected ok');
    expect(secondRun.value.skipped).toBe(true);
    if (secondRun.value.skipped) {
      expect(secondRun.value.reason).toBe('SOURCE_HASH_UNCHANGED');
    }

    const hashA = computeSourcesHash(firstRun.value.sources);
    expect(hashA).toBe(firstRun.value.sourceHash);
  });

  it('hard-blocks meta_reputation for real_person and enforces 1-hop ripple limit', async () => {
    const res = await evolveRoleCard(
      {
        cardId: 'card-real',
        characterName: '图灵',
        workName: '历史人物',
        entityType: 'real_person',
        currentContent: { ...baseCardContent, name: '图灵' },
        lockedFields: [],
        syncScope: 'both',
      },
      {
        fetchImpl: async (url) => {
          if (url.includes('prop=extracts')) {
            return new Response(
              JSON.stringify({
                query: {
                  pages: {
                    '2': { pageid: 2, title: '真实人物', extract: '近期公开发表新论文与历史档案。' },
                  },
                },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            );
          }
          return new Response(
            JSON.stringify({
              query: {
                search: [{ pageid: 2, title: '真实人物', snippet: '近期公开发表新论文。' }],
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
        dnsLookup: publicDns,
        llmPort: async () => ({
          status: 200,
          content: JSON.stringify({
            content: { ...baseCardContent, name: '图灵', summary: '计算机科学先驱' },
            metaSummary: '应当被隔离屏蔽的梗总结',
            changeReason: '补充史料',
          }),
        }),
        llmSlot: {
          provider: 'openai',
          apiKey: 'sk-test',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          jsonModeStrategy: 'auto',
        },
      },
    );

    expect(res.ok).toBe(true);
    if (!res.ok || res.value.skipped) throw new Error('expected update');
    expect(res.value.metaSummary).toBeNull();

    const proposals = generateSingleHopRippleProposals('card-a', '角色A', 'description', [
      { targetCardId: 'card-a', targetCharacterName: '角色A', lorebookId: 'lb-1', relationRole: '自己' },
      { targetCardId: 'card-b', targetCharacterName: '角色B', lorebookId: 'lb-1', relationRole: '搭档' },
      { targetCardId: 'card-b', targetCharacterName: '角色B', lorebookId: 'lb-2', relationRole: '搭档' },
      { targetCardId: 'card-c', targetCharacterName: '角色C', lorebookId: 'lb-1', relationRole: '对手' },
    ]);
    expect(proposals).toHaveLength(2);
    expect(proposals.every((p) => p.hop === MAX_RIPPLE_HOP && p.hop === 1)).toBe(true);
  });

  it('signs/verifies HMAC-SHA256 webhooks, blocks SSRF URLs, and retries transient failures', async () => {
    const secret = 'whsec_test_secret_12345';
    const ts = '2026-11-15T00:00:00.000Z';
    const body = '{"hello":"world"}';
    const sig = signWebhookPayload(secret, ts, body);

    expect(verifyWebhookSignature(secret, ts, body, sig)).toBe(true);
    expect(verifyWebhookSignature(secret, ts, body, 'sha256=deadbeef')).toBe(false);

    const sampleEvent: SyncEventDto = {
      cursor: 42,
      id: 'evt-42',
      eventType: 'card.evolved',
      targetType: 'card',
      targetId: 'card-1',
      version: 3,
      payload: { name: '角色A' },
      createdAt: ts,
    };

    const ssrfBlocked = await deliverWebhookWithRetry(
      'http://127.0.0.1:9999/hook',
      secret,
      sampleEvent,
    );
    expect(ssrfBlocked.ok).toBe(false);
    if (!ssrfBlocked.ok) {
      expect(ssrfBlocked.error.code).toBe('SSRF_IP_BLOCKED');
    }

    let attempts = 0;
    const delivered = await deliverWebhookWithRetry(
      'https://hooks.example.com/rolecard',
      secret,
      sampleEvent,
      {
        dnsLookup: publicDns,
        baseDelayMs: 1,
        maxAttempts: 3,
        fetchImpl: async () => {
          attempts += 1;
          if (attempts === 1) {
            return new Response('retry later', { status: 503 });
          }
          return new Response('ok', { status: 200 });
        },
      },
    );

    expect(delivered.ok).toBe(true);
    if (delivered.ok) {
      expect(delivered.value.attempts).toBe(2);
      expect(delivered.value.status).toBe(200);
    }
  });

  it('analyzes portrait via Vision and searches Wikimedia Commons images safely', async () => {
    const pngBase64 = createDefaultPortraitPng().toString('base64');
    const visionResult = await analyzePortraitWithVision(
      {
        imageDataUrl: `data:image/png;base64,${pngBase64}`,
        hint: '银发剑士',
      },
      {
        provider: 'openai',
        apiKey: 'sk-vision',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        jsonModeStrategy: 'auto',
      },
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      appearanceDescription: '银发蓝瞳的冷峻剑士，身着深色风衣。',
                      suggestedTags: ['银发', '剑士'],
                      imagePrompt: 'silver haired swordsman, dark coat, anime illustration',
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      },
    );

    expect(visionResult.ok).toBe(true);
    if (visionResult.ok) {
      expect(visionResult.value.suggestedTags).toContain('银发');
    }

    const searchRes = await searchWikimediaCommonsImages('Turing', 4, {
      dnsLookup: publicDns,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            query: {
              pages: {
                '101': {
                  title: 'File:Alan_Turing.jpg',
                  imageinfo: [
                    {
                      url: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/Alan_Turing.jpg',
                      thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a1.jpg',
                      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Alan_Turing.jpg',
                      mime: 'image/jpeg',
                    },
                  ],
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    expect(searchRes.ok).toBe(true);
    if (searchRes.ok) {
      expect(searchRes.value).toHaveLength(1);
      expect(searchRes.value[0]?.title).toBe('Alan_Turing.jpg');
    }
  });
});
