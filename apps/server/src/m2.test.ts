import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createDefaultPortraitPng,
  embedCardIntoPng,
  toCharaCardV3,
  type LlmCompletionPort,
} from '@rolecard/core';
import type { RoleCardContent } from '@rolecard/shared';
import { createApp } from './app.js';
import { createSqliteDatabase, seedInitialState } from './db/client.js';

const mockCardContent: RoleCardContent = {
  name: '温蒂',
  summary: '罗德岛工程干员，极其注重卫生清洁',
  personality: '严谨、洁癖、温和可靠',
  appearance: '淡蓝色长发，佩戴护目镜',
  background: '罗德岛工程部核心成员，负责移动城市能源维护。',
  speech_style: { tone: '清晰理性', catchphrases: ['注意消杀'], habits: ['擦拭工具'] },
  relationships: [{ target: '阿米娅', relation: '领导与同僚', attitude: '信赖' }],
  first_mes: '请先脱鞋并做好手部消毒再进入实验室。',
  alternate_greetings: [],
  mes_example: '',
  system_prompt: '',
  scenario: '罗德岛工程实验室',
  creator_notes: '',
  tags: ['工程', '方舟'],
  extensions: {},
};

function makeFakeLlmPort(): LlmCompletionPort {
  return async (req) => {
    const lastUser = req.messages[req.messages.length - 1]?.content ?? '';
    if (lastUser.includes('生成结构化角色卡')) {
      return {
        status: 200,
        content: JSON.stringify(mockCardContent),
      };
    }
    return {
      status: 200,
      content: '实验室内的净水装置已经调试完毕，请勿触碰未消毒的管线。',
    };
  };
}

describe('M2 Server Integration: Lorebooks, Legacy Import, Playtest Triggers & Plugins', () => {
  it('links card to lorebook with 3rd-person entry, triggers blue/green lights in playtest, and imports V2/PNG cards', async () => {
    const dbHandle = createSqliteDatabase(':memory:');
    await seedInitialState(dbHandle.db, {
      adminUsername: 'admin',
      adminPassword: 'admin-password-123',
    });

    const app = createApp({
      db: dbHandle.db,
      masterKey: randomBytes(32),
      dataDir: ':memory:',
      deploymentMode: 'local',
      llmPort: makeFakeLlmPort(),
    });

    // Login as admin
    const loginRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin-password-123' }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = loginRes.headers.get('set-cookie')?.split(';')[0] ?? '';

    // Save primary LLM config
    const cfgRes = await app.request('/api/v1/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        primaryLlm: { provider: 'openai', apiKey: 'sk-test-1234', model: 'gpt-4o-mini' },
      }),
    });
    expect(cfgRes.status).toBe(200);

    // Create a card via legacy V2 JSON import
    const v2Card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: '温蒂',
        description: '罗德岛工程干员。',
        personality: '严谨洁癖',
        first_mes: '请做好消毒再进来。',
        tags: ['方舟'],
      },
    };
    const importRes = await app.request('/api/v1/cards/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        filename: 'weedy-v2.json',
        jsonText: JSON.stringify(v2Card),
        targetCardType: 'trpg_coc7',
        tags: ['工程'],
      }),
    });
    expect(importRes.status).toBe(201);
    const imported = (await importRes.json()) as {
      card: { id: string; content: RoleCardContent };
      upgradedFrom: string;
    };
    expect(imported.upgradedFrom).toBe('chara_card_v2');
    expect((imported.card.content.extensions.trpg as Record<string, unknown>).system).toBe(
      'Call of Cthulhu 7e',
    );

    // Create Lorebook with 1 constant (blue) entry + link card to auto-generate 1 keyword (green) entry
    const lbRes = await app.request('/api/v1/lorebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        name: '罗德岛本舰设定',
        description: '移动陆行舰常识',
        entries: [
          {
            uid: 'rhodes_base',
            keys: ['罗德岛'],
            comment: '移动城市基建',
            content: '罗德岛是一座大型移动陆行舰。',
            constant: true,
            enabled: true,
          },
        ],
      }),
    });
    expect(lbRes.status).toBe(201);
    const lbData = (await lbRes.json()) as { lorebook: { id: string } };

    const linkRes = await app.request(`/api/v1/lorebooks/${lbData.lorebook.id}/link-card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        cardId: imported.card.id,
        relationRole: '水炮工程师',
        keys: ['蓄水炮'],
      }),
    });
    expect(linkRes.status).toBe(200);

    // Playtest mentioning "蓄水炮" -> should hit both blue_constant & green_keyword!
    const playRes = await app.request(`/api/v1/cards/${imported.card.id}/playtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        message: '你的蓄水炮装置最近运转正常吗？',
        history: [],
      }),
    });
    expect(playRes.status).toBe(200);
    const playData = (await playRes.json()) as {
      hitLorebooks: { mode: string; uid: string }[];
    };
    expect(playData.hitLorebooks.some((h) => h.mode === 'blue_constant')).toBe(true);
    expect(playData.hitLorebooks.some((h) => h.mode === 'green_keyword')).toBe(true);

    // Export CCV3 JSON -> should include linked character_book
    const exportV3Res = await app.request(
      `/api/v1/cards/${imported.card.id}/export?format=tavern_v3_json`,
      { headers: { Cookie: cookie } },
    );
    expect(exportV3Res.status).toBe(200);
    const v3Payload = (await exportV3Res.json()) as { data: { character_book?: { entries: unknown[] } } };
    expect(v3Payload.data.character_book?.entries.length).toBe(2);

    // Also test PNG import + embedded lorebook auto-creation
    const pngBuf = embedCardIntoPng(
      createDefaultPortraitPng(),
      toCharaCardV3(mockCardContent, {
        characterBook: {
          name: '随卡世界书',
          scan_depth: 4,
          token_budget: 1500,
          recursive_scanning: false,
          extensions: {},
          entries: [
            {
              uid: 'e1',
              keys: ['能源'],
              secondary_keys: [],
              comment: '能源舱',
              content: '主动力核心位于下层甲板。',
              constant: false,
              selective: true,
              insertion_order: 100,
              enabled: true,
              position: 'before_char',
              extensions: {},
            },
          ],
        },
      }),
    );
    expect(pngBuf.ok).toBe(true);
    if (pngBuf.ok) {
      const pngImport = await app.request('/api/v1/cards/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          filename: 'weedy-ccv3.png',
          format: 'png',
          pngBase64: pngBuf.value.toString('base64'),
          importEmbeddedLorebook: true,
        }),
      });
      expect(pngImport.status).toBe(201);
      const pngData = (await pngImport.json()) as { importedLorebookId: string | null };
      expect(pngData.importedLorebookId).toBeTruthy();
    }

    // Declarative plugins endpoint + custom Obsidian export
    const pluginsRes = await app.request('/api/v1/plugins', { headers: { Cookie: cookie } });
    expect(pluginsRes.status).toBe(200);
    const pluginExport = await app.request(
      `/api/v1/plugins/obsidian-rolecard-note/export/${imported.card.id}`,
      { headers: { Cookie: cookie } },
    );
    expect(pluginExport.status).toBe(200);
    expect(await pluginExport.text()).toContain('title: "温蒂"');

    dbHandle.close();
  });
});
