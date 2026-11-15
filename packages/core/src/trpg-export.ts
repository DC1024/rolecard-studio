import type { CardType, RoleCardContent, SourceEntry } from '@rolecard/shared';
import { applyTrpgPresetFields } from './lorebook.js';

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveTrpgData(
  content: RoleCardContent,
  cardType?: CardType,
): { systemKind: 'coc7e' | 'dnd5e'; trpg: Record<string, unknown> } {
  const existing = asRecord(content.extensions.trpg);
  const sysText = String(existing.system ?? '').toLowerCase();
  const isCoc =
    cardType === 'trpg_coc7' ||
    sysText.includes('cthulhu') ||
    sysText.includes('coc') ||
    typeof existing.characteristics === 'object';

  const targetType: CardType = isCoc ? 'trpg_coc7' : 'trpg_dnd5e';
  const normalized = applyTrpgPresetFields(targetType, content);
  return {
    systemKind: isCoc ? 'coc7e' : 'dnd5e',
    trpg: asRecord(normalized.extensions.trpg),
  };
}

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : String(mod);
}

export function exportCardToFoundryDnd5eActor(
  content: RoleCardContent,
  options: {
    cardType?: CardType;
    workName?: string;
    version?: number;
    imageUrl?: string | null;
  } = {},
): Record<string, unknown> {
  const dndCard = applyTrpgPresetFields('trpg_dnd5e', content);
  const trpg = asRecord(dndCard.extensions.trpg);
  const rawAbilities = asRecord(trpg.abilityScores);
  const combat = asRecord(trpg.combat);

  const str = Number(rawAbilities.STR) || 12;
  const dex = Number(rawAbilities.DEX) || 14;
  const con = Number(rawAbilities.CON) || 13;
  const int = Number(rawAbilities.INT) || 12;
  const wis = Number(rawAbilities.WIS) || 12;
  const cha = Number(rawAbilities.CHA) || 13;

  const level = Math.max(1, Math.min(20, Number(trpg.level) || 3));
  const ac = Math.max(5, Number(combat.AC) || 10 + abilityModifier(dex));
  const maxHp = Math.max(1, Number(combat.MaxHP) || 24);
  const speedText = String(combat.Speed ?? '30 ft');
  const speedValue = Number.parseInt(speedText, 10) || 30;
  const proficiencies = asStringArray(trpg.proficiencies);
  const features = asStringArray(trpg.featuresAndTraits);

  const biographyParts = [
    `<p><strong>高概念定位：</strong>${escapeHtml(content.summary)}</p>`,
    content.personality ? `<p><strong>性格特征：</strong>${escapeHtml(content.personality)}</p>` : '',
    content.appearance ? `<p><strong>外貌描述：</strong>${escapeHtml(content.appearance)}</p>` : '',
    content.background ? `<p><strong>背景故事：</strong>${escapeHtml(content.background)}</p>` : '',
    proficiencies.length > 0
      ? `<p><strong>熟练项：</strong>${escapeHtml(proficiencies.join('、'))}</p>`
      : '',
  ].filter(Boolean);

  const items = features.map((feature, index) => ({
    name: feature,
    type: 'feat',
    img: 'icons/svg/book.svg',
    system: {
      description: {
        value: `<p>由 RoleCard Studio 角色设定生成的特性条目 #${index + 1}。</p>`,
      },
      requirements: String(trpg.className ?? '冒险者'),
      type: { value: 'class', subtype: '' },
    },
  }));

  return {
    name: content.name,
    type: 'character',
    img: options.imageUrl || 'icons/svg/mystery-man.svg',
    system: {
      abilities: {
        str: { value: str, proficient: 0 },
        dex: { value: dex, proficient: 0 },
        con: { value: con, proficient: 0 },
        int: { value: int, proficient: 0 },
        wis: { value: wis, proficient: 0 },
        cha: { value: cha, proficient: 0 },
      },
      attributes: {
        ac: { flat: ac, calc: 'flat' },
        hp: { value: maxHp, max: maxHp, temp: 0, tempmax: 0 },
        init: { bonus: String(abilityModifier(dex)) },
        movement: { walk: speedValue, units: 'ft' },
        prof: Math.ceil(level / 4) + 1,
      },
      details: {
        race: String(trpg.race ?? '人类'),
        background: String(trpg.background ?? (options.workName || '原创设定')),
        alignment: String(trpg.alignment ?? '中立善良'),
        level,
        biography: {
          value: biographyParts.join('\n'),
          public: `<p>${escapeHtml(content.summary)}</p>`,
        },
      },
      traits: {
        languages: {
          value: ['common'],
          custom: '',
        },
      },
    },
    items,
    flags: {
      rolecardStudio: {
        schema: 'foundry-dnd5e-actor-v1',
        version: options.version ?? 1,
        workName: options.workName ?? '',
        tags: content.tags,
        trpgExtensions: trpg,
      },
    },
  };
}

export function exportCardToTrpgSheetMarkdown(
  content: RoleCardContent,
  options: {
    cardType?: CardType;
    workName?: string;
    version?: number;
    sources?: SourceEntry[];
  } = {},
): string {
  const { systemKind, trpg } = resolveTrpgData(content, options.cardType);
  const lines: string[] = [
    `# ${content.name} · ${systemKind === 'coc7e' ? 'CoC 7e 调查员车卡表' : 'D&D 5e 冒险者车卡表'}`,
    '',
    `> 出处：${options.workName || '原创设定'} | 版本：v${options.version ?? 1} | 标签：${content.tags.join(', ') || '无'}`,
    '',
    `## 角色概述`,
    content.summary,
    '',
  ];

  if (systemKind === 'coc7e') {
    const chars = asRecord(trpg.characteristics);
    const derived = asRecord(trpg.derived);
    const skills = asStringArray(trpg.keySkills);
    const backstory = asRecord(trpg.backstory);

    lines.push(
      `## 调查员档案`,
      `- 职业：${String(trpg.occupation ?? '调查员')}`,
      `- 时代：${String(trpg.era ?? '1920s / 现代架空')}`,
      '',
      '## 基础属性 (Characteristics)',
      '| STR 力量 | CON 体质 | SIZ 体型 | DEX 敏捷 | APP 外貌 | INT 智力 | POW 意志 | EDU 教育 |',
      '| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |',
      `| ${chars.STR ?? 55} | ${chars.CON ?? 60} | ${chars.SIZ ?? 60} | ${chars.DEX ?? 65} | ${chars.APP ?? 55} | ${chars.INT ?? 75} | ${chars.POW ?? 65} | ${chars.EDU ?? 70} |`,
      '',
      '## 衍生状态',
      `- **生命值 HP**：${derived.HP ?? 12} | **魔法值 MP**：${derived.MP ?? 13} | **理智 SAN**：${derived.SAN ?? 65} | **幸运 Luck**：${derived.Luck ?? 55} | **移动力 Move**：${derived.Move ?? 8}`,
      '',
      '## 核心技能',
      ...(skills.length > 0 ? skills.map((s) => `- ${s}`) : ['- 侦查 65%']),
      '',
    );
    if (Object.keys(backstory).length > 0) {
      lines.push('## 调查员背景备注');
      for (const [k, v] of Object.entries(backstory)) {
        if (v) lines.push(`- **${k}**：${String(v)}`);
      }
      lines.push('');
    }
  } else {
    const abilities = asRecord(trpg.abilityScores);
    const combat = asRecord(trpg.combat);
    const proficiencies = asStringArray(trpg.proficiencies);
    const features = asStringArray(trpg.featuresAndTraits);

    lines.push(
      '## 冒险者档案',
      `- 种族：${String(trpg.race ?? '人类')} | 职业：${String(trpg.className ?? '冒险者')} | 等级：Lv.${String(trpg.level ?? 3)} | 阵营：${String(trpg.alignment ?? '中立善良')}`,
      '',
      '## 六维属性 (Ability Scores)',
      '| STR 力量 | DEX 敏捷 | CON 体质 | INT 智力 | WIS 感知 | CHA 魅力 |',
      '| :---: | :---: | :---: | :---: | :---: | :---: |',
      `| ${abilities.STR ?? 12} (${formatMod(abilityModifier(Number(abilities.STR) || 12))}) | ${abilities.DEX ?? 15} (${formatMod(abilityModifier(Number(abilities.DEX) || 15))}) | ${abilities.CON ?? 14} (${formatMod(abilityModifier(Number(abilities.CON) || 14))}) | ${abilities.INT ?? 13} (${formatMod(abilityModifier(Number(abilities.INT) || 13))}) | ${abilities.WIS ?? 12} (${formatMod(abilityModifier(Number(abilities.WIS) || 12))}) | ${abilities.CHA ?? 14} (${formatMod(abilityModifier(Number(abilities.CHA) || 14))}) |`,
      '',
      '## 战斗面板',
      `- **护甲等级 AC**：${combat.AC ?? 15} | **最大生命 MaxHP**：${combat.MaxHP ?? 24} | **生命骰 HitDice**：${combat.HitDice ?? '3d8'} | **速度 Speed**：${combat.Speed ?? '30 ft'}`,
      '',
      '## 熟练项与职业特性',
      ...(proficiencies.length > 0 ? [`- 熟练项：${proficiencies.join('、')}`] : []),
      ...(features.length > 0 ? features.map((f) => `- 特性：${f}`) : []),
      '',
    );
  }

  lines.push(
    '## 性格与背景',
    `### 性格特征\n${content.personality}`,
    '',
    content.appearance ? `### 外貌印象\n${content.appearance}\n` : '',
    content.background ? `### 背景经历\n${content.background}\n` : '',
  );

  if (options.sources && options.sources.length > 0) {
    lines.push('## 引用溯源');
    for (const s of options.sources) {
      lines.push(`- [${s.origin === 'user_provided' ? '用户' : '检索'}] ${s.title}${s.url ? ` (${s.url})` : ''}`);
    }
  }

  return lines.filter((line) => line !== undefined).join('\n');
}

export function exportCardToTrpgSheetHtml(
  content: RoleCardContent,
  options: {
    cardType?: CardType;
    workName?: string;
    version?: number;
    sources?: SourceEntry[];
  } = {},
): string {
  const { systemKind, trpg } = resolveTrpgData(content, options.cardType);
  const titleText =
    systemKind === 'coc7e'
      ? `${content.name} - CoC 7e 调查员车卡表`
      : `${content.name} - D&D 5e 冒险者车卡表`;

  const statGridHtml =
    systemKind === 'coc7e'
      ? (() => {
          const chars = asRecord(trpg.characteristics);
          const derived = asRecord(trpg.derived);
          const skills = asStringArray(trpg.keySkills);
          const charEntries = [
            ['STR 力量', chars.STR ?? 55],
            ['CON 体质', chars.CON ?? 60],
            ['SIZ 体型', chars.SIZ ?? 60],
            ['DEX 敏捷', chars.DEX ?? 65],
            ['APP 外貌', chars.APP ?? 55],
            ['INT 智力', chars.INT ?? 75],
            ['POW 意志', chars.POW ?? 65],
            ['EDU 教育', chars.EDU ?? 70],
          ];
          return `
            <div class="meta-row">
              <span><strong>规则系统：</strong>${escapeHtml(String(trpg.system ?? 'Call of Cthulhu 7e'))}</span>
              <span><strong>职业：</strong>${escapeHtml(String(trpg.occupation ?? '调查员'))}</span>
              <span><strong>时代：</strong>${escapeHtml(String(trpg.era ?? '1920s / 架空'))}</span>
            </div>
            <h2>基础属性</h2>
            <div class="grid-8">
              ${charEntries
                .map(
                  ([label, val]) => `
                <div class="stat-box">
                  <div class="stat-label">${escapeHtml(String(label))}</div>
                  <div class="stat-val">${escapeHtml(String(val))}</div>
                  <div class="stat-sub">困难 ${Math.floor(Number(val) / 2)} / 极难 ${Math.floor(Number(val) / 5)}</div>
                </div>`,
                )
                .join('')}
            </div>
            <h2>衍生状态</h2>
            <div class="grid-5">
              <div class="stat-box"><div class="stat-label">HP 生命</div><div class="stat-val">${escapeHtml(String(derived.HP ?? 12))}</div></div>
              <div class="stat-box"><div class="stat-label">MP 魔法</div><div class="stat-val">${escapeHtml(String(derived.MP ?? 13))}</div></div>
              <div class="stat-box"><div class="stat-label">SAN 理智</div><div class="stat-val">${escapeHtml(String(derived.SAN ?? 65))}</div></div>
              <div class="stat-box"><div class="stat-label">Luck 幸运</div><div class="stat-val">${escapeHtml(String(derived.Luck ?? 55))}</div></div>
              <div class="stat-box"><div class="stat-label">Move 移动</div><div class="stat-val">${escapeHtml(String(derived.Move ?? 8))}</div></div>
            </div>
            <h2>核心技能</h2>
            <ul class="pill-list">
              ${skills.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
            </ul>
          `;
        })()
      : (() => {
          const abilities = asRecord(trpg.abilityScores);
          const combat = asRecord(trpg.combat);
          const profs = asStringArray(trpg.proficiencies);
          const feats = asStringArray(trpg.featuresAndTraits);
          const abilityEntries = [
            ['STR 力量', Number(abilities.STR) || 12],
            ['DEX 敏捷', Number(abilities.DEX) || 15],
            ['CON 体质', Number(abilities.CON) || 14],
            ['INT 智力', Number(abilities.INT) || 13],
            ['WIS 感知', Number(abilities.WIS) || 12],
            ['CHA 魅力', Number(abilities.CHA) || 14],
          ] as const;
          return `
            <div class="meta-row">
              <span><strong>规则系统：</strong>${escapeHtml(String(trpg.system ?? 'D&D 5e'))}</span>
              <span><strong>种族：</strong>${escapeHtml(String(trpg.race ?? '人类'))}</span>
              <span><strong>职业：</strong>${escapeHtml(String(trpg.className ?? '冒险者'))} (Lv.${escapeHtml(String(trpg.level ?? 3))})</span>
              <span><strong>阵营：</strong>${escapeHtml(String(trpg.alignment ?? '中立善良'))}</span>
            </div>
            <h2>六维属性</h2>
            <div class="grid-6">
              ${abilityEntries
                .map(([label, score]) => {
                  const mod = formatMod(abilityModifier(score));
                  return `
                <div class="stat-box">
                  <div class="stat-label">${escapeHtml(label)}</div>
                  <div class="stat-val">${score}</div>
                  <div class="stat-sub">调整值 ${escapeHtml(mod)}</div>
                </div>`;
                })
                .join('')}
            </div>
            <h2>战斗面板</h2>
            <div class="grid-4">
              <div class="stat-box"><div class="stat-label">护甲等级 AC</div><div class="stat-val">${escapeHtml(String(combat.AC ?? 15))}</div></div>
              <div class="stat-box"><div class="stat-label">最大生命 HP</div><div class="stat-val">${escapeHtml(String(combat.MaxHP ?? 24))}</div></div>
              <div class="stat-box"><div class="stat-label">生命骰</div><div class="stat-val">${escapeHtml(String(combat.HitDice ?? '3d8'))}</div></div>
              <div class="stat-box"><div class="stat-label">移动速度</div><div class="stat-val">${escapeHtml(String(combat.Speed ?? '30 ft'))}</div></div>
            </div>
            <h2>熟练项与特性</h2>
            <ul class="pill-list">
              ${profs.map((p) => `<li>熟练：${escapeHtml(p)}</li>`).join('')}
              ${feats.map((f) => `<li>特性：${escapeHtml(f)}</li>`).join('')}
            </ul>
          `;
        })();

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(titleText)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #f4efe6; color: #1f1b16; font-family: "Noto Serif SC", "Songti SC", Georgia, serif; line-height: 1.6; }
    .sheet { max-width: 920px; margin: 0 auto; background: #fffdf8; border: 2px solid #3a2e21; padding: 28px 32px; box-shadow: 0 8px 24px rgba(31,27,22,.12); }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #3a2e21; padding-bottom: 12px; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
    h1 { margin: 0; font-size: 24px; letter-spacing: 0.04em; }
    .badge { font-family: ui-monospace, monospace; font-size: 12px; background: #3a2e21; color: #fffdf8; padding: 3px 10px; border-radius: 3px; }
    .meta-row { display: flex; flex-wrap: wrap; gap: 14px; font-size: 13px; background: #f7f1e3; padding: 8px 12px; border: 1px solid #d5c7ad; margin-bottom: 16px; }
    h2 { font-size: 15px; border-left: 4px solid #7c2d12; padding-left: 8px; margin: 18px 0 10px; color: #7c2d12; }
    .grid-8 { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 8px; }
    .grid-6 { display: grid; grid-template-columns: repeat(auto-fit, minmax(115px, 1fr)); gap: 8px; }
    .grid-5 { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
    .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
    .stat-box { border: 1px solid #b8a789; background: #fbf7ee; padding: 8px; text-align: center; border-radius: 4px; }
    .stat-label { font-size: 11px; color: #665846; }
    .stat-val { font-size: 20px; font-weight: 700; font-family: ui-monospace, monospace; margin: 2px 0; }
    .stat-sub { font-size: 11px; color: #7c2d12; }
    .pill-list { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .pill-list li { border: 1px solid #c5b699; background: #f8f2e4; padding: 3px 10px; font-size: 12.5px; border-radius: 999px; }
    .prose { background: #fbf8f0; border: 1px solid #e2d8c5; padding: 10px 14px; font-size: 13.5px; white-space: pre-wrap; }
    .print-bar { max-width: 920px; margin: 0 auto 12px; text-align: right; }
    .print-btn { cursor: pointer; background: #3a2e21; color: #fff; border: none; padding: 6px 14px; font-size: 12px; border-radius: 4px; }
    @media print { body { background: #fff; padding: 0; } .sheet { border: 1px solid #000; box-shadow: none; } .print-bar { display: none; } }
  </style>
</head>
<body>
  <div class="print-bar">
    <button class="print-btn" onclick="window.print()">打印 / 另存为 PDF</button>
  </div>
  <article class="sheet">
    <header>
      <div>
        <h1>${escapeHtml(content.name)}</h1>
        <div style="font-size:13px;color:#5c4e3c;">出处：${escapeHtml(options.workName || '原创设定')} · 版本 v${options.version ?? 1}</div>
      </div>
      <span class="badge">${systemKind === 'coc7e' ? 'CoC 7e 调查员卡' : 'D&amp;D 5e 冒险者卡'}</span>
    </header>
    <div class="prose"><strong>高概念定位：</strong>${escapeHtml(content.summary)}</div>
    ${statGridHtml}
    <h2>性格特征</h2>
    <div class="prose">${escapeHtml(content.personality)}</div>
    ${content.appearance ? `<h2>外貌描述</h2><div class="prose">${escapeHtml(content.appearance)}</div>` : ''}
    ${content.background ? `<h2>背景故事</h2><div class="prose">${escapeHtml(content.background)}</div>` : ''}
  </article>
</body>
</html>`;
}
