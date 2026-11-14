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

export function applyTrpgPresetFields(
  cardType: CardType,
  content: RoleCardContent,
): RoleCardContent {
  if (cardType !== 'trpg_coc7' && cardType !== 'trpg_dnd5e') {
    return content;
  }

  const existingTrpg =
    typeof content.extensions.trpg === 'object' && content.extensions.trpg !== null
      ? (content.extensions.trpg as Record<string, unknown>)
      : {};

  if (cardType === 'trpg_coc7') {
    return {
      ...content,
      extensions: {
        ...content.extensions,
        trpg: {
          system: 'Call of Cthulhu 7e',
          characteristics: {
            STR: 55,
            CON: 60,
            SIZ: 60,
            DEX: 65,
            APP: 55,
            INT: 75,
            POW: 65,
            EDU: 70,
          },
          derived: {
            HP: 12,
            MP: 13,
            SAN: 65,
            Luck: 55,
            Move: 8,
          },
          keySkills: ['侦查 65%', '图书馆使用 70%', '心理学 60%', '话术 55%'],
          ...existingTrpg,
        },
      },
    };
  }

  return {
    ...content,
    extensions: {
      ...content.extensions,
      trpg: {
        system: 'D&D 5e',
        level: 3,
        abilityScores: {
          STR: 12,
          DEX: 15,
          CON: 14,
          INT: 13,
          WIS: 12,
          CHA: 14,
        },
        combat: {
          AC: 15,
          MaxHP: 24,
          HitDice: '3d8',
          Speed: '30 ft',
        },
        proficiencies: ['察觉', '说服', '隐匿', '调查'],
        ...existingTrpg,
      },
    },
  };
}
