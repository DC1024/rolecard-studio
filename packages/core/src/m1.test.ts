import type { RoleCardContent } from '@rolecard/shared';
import { describe, expect, it } from 'vitest';
import {
  appendTurnToMesExample,
  compressRoleCard,
  createDefaultPortraitPng,
  detectImageMagicBytes,
  embedCardIntoPng,
  exportCardToMarkdown,
  extractCardJsonFromPng,
  extractPngTextChunks,
  isSafeImageUrl,
  preserveLockedFields,
  refineRoleCard,
  runPlaytestTurn,
  scanHitLorebookEntries,
  toCharaCardV3,
  type LlmCompletionPort,
} from './index.js';

const sampleCard: RoleCardContent = {
  name: '星见雅',
  summary: '对空六课课长，冷静克制的刀术天才',
  personality: '寡言、严谨、对除魔与修炼极为执着，偶尔流露反差呆萌',
  appearance: '黑长直发与狐耳、蓝色振袖风制服、腰佩妖刀无尾',
  background: '星见家当代家主，背负家族传承守护新艾利都',
  speech_style: {
    tone: '冷峻简练',
    catchphrases: ['效率至上', '修行不可懈怠'],
    habits: ['谈及修炼时格外认真'],
  },
  relationships: [{ target: '月城柳', relation: '副课长/搭档', attitude: '高度信赖' }],
  first_mes: '我是对空六课的星见雅。{{user}}，请说明此次委托的要点。',
  alternate_greetings: ['{{user}}，今天的刀术修行完成了吗？'],
  mes_example: '<START>\n{{user}}: 你好。\n{{char}}: 时间宝贵，请直入主题。',
  system_prompt: '始终以星见雅的口吻回应 {{user}}。',
  scenario: '六课办公室',
  creator_notes: 'CCV3 测试卡',
  tags: ['绝区零', '对空六课'],
  extensions: {},
};

describe('CCV3 PNG dual-chunk & image safety', () => {
  it('validates image magic bytes and safe URLs', () => {
    const png = createDefaultPortraitPng();
    expect(detectImageMagicBytes(png)).toBe('png');
    expect(detectImageMagicBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectImageMagicBytes(Buffer.from('RIFF1234WEBP'))).toBe('webp');
    expect(detectImageMagicBytes(Buffer.from('<html>not an image</html>'))).toBeNull();

    expect(isSafeImageUrl('/uploads/avatar.png')).toBe(true);
    expect(isSafeImageUrl('/uploads/../etc/passwd')).toBe(false);
    expect(isSafeImageUrl('https://cdn.example.com/a.png')).toBe(true);
    expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeImageUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('embeds and extracts both ccv3 and chara tEXt chunks in PNG', () => {
    const basePng = createDefaultPortraitPng();
    const v3 = toCharaCardV3(sampleCard, {
      version: 2,
      sources: [
        {
          title: '官方资料',
          snippet: '对空六课课长',
          origin: 'user_provided',
        },
      ],
    });

    const embedded = embedCardIntoPng(basePng, v3);
    expect(embedded.ok).toBe(true);
    if (!embedded.ok) return;

    const textChunks = extractPngTextChunks(embedded.value);
    expect(textChunks.ok).toBe(true);
    if (textChunks.ok) {
      expect(textChunks.value.ccv3).toBeTruthy();
      expect(textChunks.value.chara).toBeTruthy();
    }

    const decoded = extractCardJsonFromPng(embedded.value);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.format).toBe('ccv3');
      const raw = decoded.value.raw as { spec: string; data: { name: string } };
      expect(raw.spec).toBe('chara_card_v3');
      expect(raw.data.name).toBe('星见雅');
    }
  });

  it('exports readable Markdown with source origin tags', () => {
    const md = exportCardToMarkdown(sampleCard, {
      workName: '绝区零',
      mode: 'C',
      version: 1,
      sources: [
        { title: '设定集', snippet: '刀术', origin: 'user_provided' },
        { title: 'Wiki', url: 'https://example.com', snippet: '对空六课', origin: 'search_supplement' },
      ],
    });
    expect(md).toContain('# 星见雅（绝区零）');
    expect(md).toContain('[用户提供]');
    expect(md).toContain('[检索补充]');
  });
});

describe('Playtest sandbox, locked fields & refine/compress', () => {
  it('scans blue constant & green keyword lorebooks and runs playtest turn', async () => {
    const lorebooks = [
      {
        id: 'lb-1',
        name: '新艾利都世界书',
        entries: [
          {
            uid: 'u1',
            keys: [],
            secondary_keys: [],
            comment: '对空部总则',
            content: '专门应对空洞灾害的特殊行动机构。',
            constant: true,
            selective: true,
            insertion_order: 100,
            enabled: true,
            position: 'before_char' as const,
            extensions: {},
          },
          {
            uid: 'u2',
            keys: ['无尾', '妖刀'],
            secondary_keys: [],
            comment: '妖刀无尾',
            content: '星见家代代相传的秘剑。',
            constant: false,
            selective: true,
            insertion_order: 100,
            enabled: true,
            position: 'before_char' as const,
            extensions: {},
          },
        ],
      },
    ];

    const scanned = scanHitLorebookEntries(lorebooks, '请拔出妖刀无尾展示一下');
    expect(scanned.hits.map((h) => h.mode)).toEqual(['blue_constant', 'green_keyword']);

    let capturedSystemPrompt = '';
    const mockLlm: LlmCompletionPort = async (req) => {
      capturedSystemPrompt = req.messages[0]?.content ?? '';
      return { status: 200, content: '无尾并非轻易示人之刃。' };
    };

    const turn = await runPlaytestTurn(
      sampleCard,
      {
        message: '拔出妖刀看看',
        history: [],
        userName: '绳匠',
        userPersona: '匿名情报员',
        greetingIndex: 1,
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
        lorebooks,
        enableMetaInChat: true,
        metaReputationSummary: '社区常称其为“雅小姐姐”。',
      },
    );

    expect(turn.ok).toBe(true);
    if (turn.ok) {
      expect(turn.value.greetingText).toBe('绳匠，今天的刀术修行完成了吗？');
      expect(turn.value.hitLorebooks.length).toBe(2);
      expect(turn.value.metaInjected).toBe(true);
      expect(capturedSystemPrompt).toContain('Meta 现实风评参考');
    }

    const updatedMes = appendTurnToMesExample(sampleCard.mes_example, '拔刀！', '不可儿戏。');
    expect(updatedMes).toContain('{{user}}: 拔刀！');
    expect(updatedMes).toContain('{{char}}: 不可儿戏。');
  });

  it('preserves locked fields during refine and compress', async () => {
    const mutated = {
      ...sampleCard,
      personality: '被篡改的性格',
      first_mes: '被篡改的开场白',
      summary: '更新后的一句话定位',
    };

    const preserved = preserveLockedFields(sampleCard, mutated, ['personality']);
    expect(preserved.personality).toBe(sampleCard.personality);
    expect(preserved.first_mes).toBe('被篡改的开场白');

    const mockLlm: LlmCompletionPort = async () => ({
      status: 200,
      content: JSON.stringify(mutated),
    });

    const refined = await refineRoleCard(sampleCard, '微调一下', {
      llmPort: mockLlm,
      llmSlot: {
        provider: 'openai',
        apiKey: 'k',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        jsonModeStrategy: 'auto',
      },
      lockedFields: ['personality'],
    });
    expect(refined.ok).toBe(true);
    if (refined.ok) {
      expect(refined.value.content.personality).toBe(sampleCard.personality);
      expect(refined.value.content.summary).toBe('更新后的一句话定位');
    }

    const compressed = await compressRoleCard(sampleCard, 300, {
      llmPort: mockLlm,
      llmSlot: {
        provider: 'openai',
        apiKey: 'k',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        jsonModeStrategy: 'auto',
      },
      lockedFields: ['first_mes'],
    });
    expect(compressed.ok).toBe(true);
    if (compressed.ok) {
      expect(compressed.value.content.first_mes).toBe(sampleCard.first_mes);
    }
  });
});
