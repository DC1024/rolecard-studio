import type {
  CardType,
  CharacterBook,
  LorebookEntry,
  RoleCardContent,
} from '@rolecard/shared';

export interface ThirdPersonEntryInput {
  cardId: string;
  content: RoleCardContent;
  workName?: string;
  relationRole?: string;
  customKeys?: string[];
  constant?: boolean;
}

export function buildThirdPersonLorebookEntry(input: ThirdPersonEntryInput): LorebookEntry {
  const { cardId, content, workName, relationRole = '核心人物', customKeys, constant = false } = input;
  const keys =
    customKeys && customKeys.length > 0
      ? [...new Set(customKeys.map((k) => k.trim()).filter(Boolean))]
      : [
          content.name,
          ...(workName?.trim() ? [`${content.name}(${workName.trim()})`] : []),
          ...content.tags.slice(0, 2),
        ].filter((v, idx, arr) => v.length > 0 && arr.indexOf(v) === idx);

  const relSummary =
    content.relationships.length > 0
      ? `关系脉络：${content.relationships
          .slice(0, 3)
          .map((r) => `${r.target}(${r.relation})`)
          .join('、')}。`
      : '';

  const appearanceSummary = content.appearance.trim()
    ? `外貌印象：${content.appearance.trim().slice(0, 140)}。`
    : '';

  const summaryBody = [
    `[第三方人物词条 · ${relationRole}] ${content.name}${workName ? `（出自《${workName}》）` : ''}：${content.summary}`,
    `性格侧写：${content.personality.slice(0, 180)}`,
    appearanceSummary,
    relSummary,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    uid: `char_${cardId}`,
    keys,
    secondary_keys: [],
    comment: `${content.name} (${relationRole})`,
    content: summaryBody,
    constant,
    selective: true,
    insertion_order: 100,
    enabled: true,
    position: 'before_char',
    extensions: {
      sourceCardId: cardId,
      relationRole,
      thirdPersonSummary: true,
    },
  };
}

export function mergeLorebooksToCharacterBook(
  lorebooks: readonly {
    name: string;
    description?: string;
    scanDepth?: number;
    tokenBudget?: number;
    recursiveScanning?: boolean;
    entries: readonly LorebookEntry[];
  }[],
): CharacterBook | undefined {
  if (lorebooks.length === 0) return undefined;

  const mergedEntries: LorebookEntry[] = [];
  const seenUids = new Set<string>();

  for (const lb of lorebooks) {
    for (const entry of lb.entries) {
      const uid = seenUids.has(entry.uid) ? `${entry.uid}_${mergedEntries.length}` : entry.uid;
      seenUids.add(uid);
      mergedEntries.push({ ...entry, uid });
    }
  }

  return {
    name: lorebooks.map((l) => l.name).join(' + '),
    description: lorebooks.map((l) => l.description).filter(Boolean).join('\n'),
    scan_depth: Math.max(...lorebooks.map((l) => l.scanDepth ?? 4)),
    token_budget: Math.max(...lorebooks.map((l) => l.tokenBudget ?? 1500)),
    recursive_scanning: lorebooks.some((l) => Boolean(l.recursiveScanning)),
    extensions: {
      linkedLorebookCount: lorebooks.length,
    },
    entries: mergedEntries,
  };
}

export function exportLorebookToSillyTavernJson(lorebook: {
  name: string;
  description: string;
  worldSummary?: string;
  scanDepth: number;
  tokenBudget: number;
  recursiveScanning: boolean;
  entries: readonly LorebookEntry[];
}): Record<string, unknown> {
  const entriesObj: Record<string, unknown> = {};
  lorebook.entries.forEach((entry, index) => {
    entriesObj[String(index)] = {
      uid: index,
      key: entry.keys,
      keysecondary: entry.secondary_keys,
      comment: entry.comment,
      content: entry.content,
      constant: entry.constant,
      selective: entry.selective,
      selectiveLogic: 0,
      addMemo: true,
      order: entry.insertion_order,
      position: entry.position === 'after_char' ? 1 : 0,
      disable: !entry.enabled,
      excludeRecursion: false,
      preventRecursion: false,
      probability: 100,
      useProbability: true,
      depth: 4,
      extensions: entry.extensions,
    };
  });

  return {
    name: lorebook.name,
    description: lorebook.description || lorebook.worldSummary || '',
    scan_depth: lorebook.scanDepth,
    token_budget: lorebook.tokenBudget,
    recursive_scanning: lorebook.recursiveScanning,
    entries: entriesObj,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function applyTrpgPresetFields(
  cardType: CardType,
  content: RoleCardContent,
): RoleCardContent {
  if (cardType !== 'trpg_coc7' && cardType !== 'trpg_dnd5e') {
    return content;
  }

  const existingTrpg = asRecord(content.extensions.trpg);

  if (cardType === 'trpg_coc7') {
    const defaultChars = {
      STR: 55,
      CON: 60,
      SIZ: 60,
      DEX: 65,
      APP: 55,
      INT: 75,
      POW: 65,
      EDU: 70,
    };
    const mergedChars = { ...defaultChars, ...asRecord(existingTrpg.characteristics) };
    const defaultDerived = {
      HP: Math.max(1, Math.floor((Number(mergedChars.CON) + Number(mergedChars.SIZ)) / 10)),
      MP: Math.max(1, Math.floor(Number(mergedChars.POW) / 5)),
      SAN: Number(mergedChars.POW) || 65,
      Luck: 55,
      Move: 8,
    };
    const mergedDerived = { ...defaultDerived, ...asRecord(existingTrpg.derived) };
    const existingSkills = Array.isArray(existingTrpg.keySkills) && existingTrpg.keySkills.length > 0
      ? existingTrpg.keySkills
      : ['侦查 65%', '图书馆使用 70%', '心理学 60%', '话术 55%'];

    return {
      ...content,
      extensions: {
        ...content.extensions,
        trpg: {
          ...existingTrpg,
          system:
            typeof existingTrpg.system === 'string' && existingTrpg.system.trim()
              ? existingTrpg.system
              : 'Call of Cthulhu 7e',
          occupation:
            typeof existingTrpg.occupation === 'string' && existingTrpg.occupation.trim()
              ? existingTrpg.occupation
              : '调查员',
          era:
            typeof existingTrpg.era === 'string' && existingTrpg.era.trim()
              ? existingTrpg.era
              : '1920s / 现代架空',
          characteristics: mergedChars,
          derived: mergedDerived,
          keySkills: existingSkills,
        },
      },
    };
  }

  const defaultAbilities = {
    STR: 12,
    DEX: 15,
    CON: 14,
    INT: 13,
    WIS: 12,
    CHA: 14,
  };
  const mergedAbilities = { ...defaultAbilities, ...asRecord(existingTrpg.abilityScores) };
  const defaultCombat = {
    AC: 15,
    MaxHP: 24,
    HitDice: '3d8',
    Speed: '30 ft',
  };
  const mergedCombat = { ...defaultCombat, ...asRecord(existingTrpg.combat) };
  const existingProfs =
    Array.isArray(existingTrpg.proficiencies) && existingTrpg.proficiencies.length > 0
      ? existingTrpg.proficiencies
      : ['察觉', '说服', '隐匿', '调查'];

  return {
    ...content,
    extensions: {
      ...content.extensions,
      trpg: {
        ...existingTrpg,
        system:
          typeof existingTrpg.system === 'string' && existingTrpg.system.trim()
            ? existingTrpg.system
            : 'D&D 5e',
        race:
          typeof existingTrpg.race === 'string' && existingTrpg.race.trim()
            ? existingTrpg.race
            : '人类',
        className:
          typeof existingTrpg.className === 'string' && existingTrpg.className.trim()
            ? existingTrpg.className
            : '冒险者',
        alignment:
          typeof existingTrpg.alignment === 'string' && existingTrpg.alignment.trim()
            ? existingTrpg.alignment
            : '中立善良',
        level:
          typeof existingTrpg.level === 'number' && Number.isFinite(existingTrpg.level)
            ? existingTrpg.level
            : 3,
        abilityScores: mergedAbilities,
        combat: mergedCombat,
        proficiencies: existingProfs,
      },
    },
  };
}
