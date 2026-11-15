import { randomBytes } from 'node:crypto';
import {
  createDefaultPortraitPng,
  extractCardJsonFromPng,
  extractPngTextChunks,
  type LlmCompletionPort,
} from '@rolecard/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createSqliteDatabase, seedInitialState, type DatabaseHandle } from './db/client.js';

describe('RoleCard Studio Server M1 integration', () => {
  let dbHandle: DatabaseHandle;
  let masterKey: Buffer;

  const baseCardPayload = {
    name: '星见雅',
    summary: '对空六课课长，冷静克制的刀术天才',
    personality: '寡言严谨、恪守使命、极度看重效率',
    appearance: '黑长直、狐耳、蓝色振袖风制服',
    background: '星见家当代家主',
    speech_style: { tone: '冷峻简短', catchphrases: ['效率至上'], habits: [] },
    relationships: [{ target: '月城柳', relation: '搭档', attitude: '信赖' }],
    first_mes: '我是星见雅。{{user}}，请简述你的委托。',
    alternate_greetings: ['{{user}}，修炼不可懈怠。'],
    mes_example: '<START>\n{{user}}: 你好。\n{{char}}: 请直接说明来意。',
    system_prompt: '扮演星见雅。',
    scenario: '六课办公室',
    creator_notes: 'M1 集成测试卡',
    tags: ['绝区零', '对空六课'],
    extensions: {},
  };

  const mockLlmPort: LlmCompletionPort = async (req) => {
    const sys = req.messages[0]?.content ?? '';
    if (sys.includes('局部微调专家')) {
      return {
        status: 200,
        content: JSON.stringify({
          ...baseCardPayload,
          summary: '对空六课课长，微调后的冷峻剑豪',
          personality: '模型擅自改写的性格（应当被锁定保护还原）',
        }),
      };
    }
    if (sys.includes('语义精简专家')) {
      return {
        status: 200,
        content: JSON.stringify({
          ...baseCardPayload,
          background: '星见家主。',
        }),
      };
    }
    if (sys.includes('你现在正在扮演角色')) {
      return {
        status: 200,
        content: '既如此，我便与你同行一程。',
      };
    }
    return {
      status: 200,
      content: JSON.stringify(baseCardPayload),
    };
  };

  beforeEach(async () => {
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
      dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }],
    });
  }

  async function loginAdmin(app: ReturnType<typeof createApp>): Promise<string> {
    const res = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'AdminPassword!123' }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { token: string };
    return data.token;
  }

  it('supports card editing, field lock during refine/compress, image upload, CCV3 PNG export, and playtest', async () => {
    const app = buildApp();
    const token = await loginAdmin(app);

    // Configure primary LLM
    await app.request('/api/v1/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        primaryLlm: {
          provider: 'openai',
          apiKey: 'sk-test-1234',
          model: 'gpt-4o-mini',
        },
        searchProvider: 'none',
        enableLayer1Wiki: false,
      }),
    });

    // Generate card in Mode A
    const genRes = await app.request('/api/v1/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        mode: 'A',
        characterName: '星见雅',
        workName: '绝区零',
        referenceText: '对空六课课长，使用妖刀无尾。',
      }),
    });
    expect(genRes.status).toBe(201);
    const created = (await genRes.json()) as { card: { id: string } };
    const cardId = created.card.id;

    // Lock `personality` via PUT /cards/:id
    const putRes = await app.request(`/api/v1/cards/${cardId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        content: baseCardPayload,
        lockedFields: ['personality'],
      }),
    });
    expect(putRes.status).toBe(200);

    // Refine card -> personality must stay unchanged while summary updates
    const refineRes = await app.request(`/api/v1/cards/${cardId}/refine`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ instruction: '把定位写得更凌厉一些' }),
    });
    expect(refineRes.status).toBe(200);
    const refined = (await refineRes.json()) as {
      card: { content: { summary: string; personality: string }; version: number };
    };
    expect(refined.card.content.summary).toBe('对空六课课长，微调后的冷峻剑豪');
    expect(refined.card.content.personality).toBe(baseCardPayload.personality);

    // Compress card
    const compressRes = await app.request(`/api/v1/cards/${cardId}/compress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ targetMaxTokens: 500 }),
    });
    expect(compressRes.status).toBe(200);

    // Reject spoofed image magic bytes
    const fakePngBase64 = Buffer.from('<script>alert(1)</script>').toString('base64');
    const badImgRes = await app.request(`/api/v1/cards/${cardId}/image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        mode: 'upload',
        dataUrl: `data:image/png;base64,${fakePngBase64}`,
      }),
    });
    expect(badImgRes.status).toBe(400);

    // Upload real PNG portrait
    const validPng = createDefaultPortraitPng(48, 72);
    const imgRes = await app.request(`/api/v1/cards/${cardId}/image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        mode: 'upload',
        dataUrl: `data:image/png;base64,${validPng.toString('base64')}`,
      }),
    });
    expect(imgRes.status).toBe(200);
    const imgBody = (await imgRes.json()) as { card: { imageUrl: string } };
    expect(imgBody.card.imageUrl).toMatch(/^\/uploads\/.+\.png$/);

    const fetchImg = await app.request(imgBody.card.imageUrl);
    expect(fetchImg.status).toBe(200);

    // Export CCV3 PNG and verify dual chunks
    const exportPngRes = await app.request(`/api/v1/cards/${cardId}/export?format=tavern_png`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(exportPngRes.status).toBe(200);
    expect(exportPngRes.headers.get('content-type')).toBe('image/png');
    const exportedBuf = Buffer.from(await exportPngRes.arrayBuffer());
    const textChunks = extractPngTextChunks(exportedBuf);
    expect(textChunks.ok).toBe(true);
    if (textChunks.ok) {
      expect(textChunks.value.ccv3).toBeTruthy();
      expect(textChunks.value.chara).toBeTruthy();
    }
    const decoded = extractCardJsonFromPng(exportedBuf);
    expect(decoded.ok).toBe(true);

    // Export Markdown & CCV3 JSON
    const exportMdRes = await app.request(`/api/v1/cards/${cardId}/export?format=markdown`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(exportMdRes.status).toBe(200);
    expect(await exportMdRes.text()).toContain('# 星见雅');

    // Playtest chat & adopt mes_example
    const playtestRes = await app.request(`/api/v1/cards/${cardId}/playtest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        message: '今天有空切磋一下吗？',
        history: [],
        userName: '哲',
        greetingIndex: 0,
      }),
    });
    expect(playtestRes.status).toBe(200);
    const playtestBody = (await playtestRes.json()) as { reply: string; greetingText: string };
    expect(playtestBody.reply).toBe('既如此，我便与你同行一程。');
    expect(playtestBody.greetingText).toContain('哲');

    const adoptRes = await app.request(`/api/v1/cards/${cardId}/mes-example`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        userMessage: '今天有空切磋一下吗？',
        assistantMessage: playtestBody.reply,
      }),
    });
    expect(adoptRes.status).toBe(200);
    const adoptBody = (await adoptRes.json()) as { card: { content: { mes_example: string } } };
    expect(adoptBody.card.content.mes_example).toContain('既如此，我便与你同行一程。');
  });
});
