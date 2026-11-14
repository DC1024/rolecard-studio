import { describe, expect, it } from 'vitest';
import type { RoleCardContent } from '@rolecard/shared';
import {
  applyTrpgPresetFields,
  buildThirdPersonLorebookEntry,
  createDefaultPortraitPng,
  embedCardIntoPng,
  exportLorebookToSillyTavernJson,
  getBuiltinDeclarativePlugins,
  mergeLorebooksToCharacterBook,
  parseImportedCardPayload,
  renderDeclarativeExport,
  toCharaCardV3,
  validatePluginManifest,
} from './index.js';

const sampleCard: RoleCardContent = {
  name: '克莱恩·莫雷蒂',
  summary: '诡秘之主主角，谨慎温和的愚者先生',
  personality: '谨慎、礼貌、富有同情心，内心戏丰富',
  appearance: '黑发褐眸，常穿双排扣黑礼服与半高丝绸礼帽',
  background: '意外穿越至廷根市，执掌灰雾之上的塔罗会。',
  speech_style: { tone: '克制礼貌', catchphrases: ['赞美愚者'], habits: ['轻叩桌面'] },
  relationships: [{ target: '奥黛丽', relation: '塔罗会成员', attitude: '温和引导' }],
  first_mes: '灰雾之上，他微微颔首：“欢迎来到塔罗会。”',
  alternate_greetings: [],
  mes_example: '',
  system_prompt: '',
  scenario: '灰雾空间',
  creator_notes: '',
  tags: ['诡秘', '克苏鲁'],
  extensions: {},
};

describe('M2 lorebook, legacy card import, TRPG presets & declarative plugins', () => {
  it('builds 3rd-person lorebook entry and exports SillyTavern World Info JSON', () => {
    const entry = buildThirdPersonLorebookEntry({
      cardId: 'card-klein',
      content: sampleCard,
      workName: '诡秘之主',
      relationRole: '愚者 / 组织发起人',
    });

    expect(entry.uid).toBe('char_card-klein');
    expect(entry.keys).toContain('克莱恩·莫雷蒂');
    expect(entry.content).toContain('[第三方人物词条 · 愚者 / 组织发起人]');
    expect(entry.content).not.toContain('欢迎来到塔罗会');

    const book = mergeLorebooksToCharacterBook([
      {
        name: '塔罗会世界观',
        description: '灰雾与非凡途径',
        scanDepth: 6,
        tokenBudget: 2048,
        entries: [entry],
      },
    ]);
    expect(book?.entries).toHaveLength(1);

    const exported = exportLorebookToSillyTavernJson({
      name: '塔罗会世界观',
      description: '灰雾与非凡途径',
      scanDepth: 6,
      tokenBudget: 2048,
      recursiveScanning: false,
      entries: [entry],
    });
    expect(exported.name).toBe('塔罗会世界观');
    const entriesObj = exported.entries as Record<string, Record<string, unknown>>;
    expect(entriesObj['0']?.comment).toContain('克莱恩·莫雷蒂');
  });

  it('parses and upgrades legacy V2 JSON and CCV3 PNG cards with embedded character_book', () => {
    const v2Json = JSON.stringify({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: '阿米娅',
        description: '罗德岛公开领袖。',
        personality: '坚毅温柔',
        first_mes: '博士，请下达指令吧。',
        tags: ['方舟'],
        character_book: {
          name: '泰拉世界书',
          entries: [
            {
              uid: 1,
              key: ['罗德岛', '源石'],
              comment: '罗德岛制药',
              content: '致力于解决矿石病问题的组织。',
              constant: false,
            },
          ],
        },
      },
    });

    const parsedJson = parseImportedCardPayload({
      filename: 'amiya-v2.json',
      jsonText: v2Json,
      targetCardType: 'sillytavern_v3',
      importEmbeddedLorebook: true,
      tags: ['导入'],
    });
    expect(parsedJson.ok).toBe(true);
    if (!parsedJson.ok) return;
    expect(parsedJson.value.sourceSpec).toBe('chara_card_v2');
    expect(parsedJson.value.content.name).toBe('阿米娅');
    expect(parsedJson.value.content.tags).toEqual(['方舟', '导入']);
    expect(parsedJson.value.embeddedBook?.entries[0]?.keys).toContain('罗德岛');

    const basePng = createDefaultPortraitPng();
    const embeddedPng = embedCardIntoPng(basePng, toCharaCardV3(sampleCard));
    expect(embeddedPng.ok).toBe(true);
    if (!embeddedPng.ok) return;

    const parsedPng = parseImportedCardPayload({
      filename: 'klein.png',
      format: 'png',
      pngBase64: embeddedPng.value.toString('base64'),
      targetCardType: 'trpg_coc7',
      importEmbeddedLorebook: true,
      tags: [],
    });
    expect(parsedPng.ok).toBe(true);
    if (!parsedPng.ok) return;
    expect(parsedPng.value.sourceSpec).toBe('chara_card_v3');
    expect(parsedPng.value.portraitPngBase64).toBeTruthy();
    expect((parsedPng.value.content.extensions.trpg as Record<string, unknown>).system).toBe(
      'Call of Cthulhu 7e',
    );
  });

  it('enriches TRPG CoC 7e & DnD 5e presets and validates/renders declarative plugins', () => {
    const dndCard = applyTrpgPresetFields('trpg_dnd5e', sampleCard);
    expect((dndCard.extensions.trpg as Record<string, unknown>).system).toBe('D&D 5e');

    const plugins = getBuiltinDeclarativePlugins();
    const obsidian = plugins.find((p) => p.id === 'obsidian-rolecard-note');
    expect(obsidian).toBeDefined();

    const valid = validatePluginManifest(obsidian);
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;

    const rendered = renderDeclarativeExport(valid.value, sampleCard, {
      workName: '诡秘之主',
      version: 2,
    });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.value.filename).toBe('克莱恩·莫雷蒂.md');
    expect(rendered.value.content).toContain('work: "诡秘之主"');
    expect(rendered.value.content).toContain('# 克莱恩·莫雷蒂');

    const invalid = validatePluginManifest({
      id: 'bad plugin!',
      name: 'bad',
      version: '1.0',
      type: 'export_formatter',
    });
    expect(invalid.ok).toBe(false);
  });
});
