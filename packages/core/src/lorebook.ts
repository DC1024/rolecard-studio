import type {
  CardType,
  CharacterBook,
  LorebookEntry,
  RoleCardContent,
  TrpgSystemKey,
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

function hasOwnKeys(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).length > 0;
}

export interface TrpgSystemsBucket {
  coc7e?: Record<string, unknown>;
  dnd5e?: Record<string, unknown>;
}

export function cardTypeToTrpgSystem(cardType?: CardType): TrpgSystemKey | null {
  if (cardType === 'trpg_coc7') return 'coc7e';
  if (cardType === 'trpg_dnd5e') return 'dnd5e';
  return null;
}

export function trpgSystemToCardType(system: TrpgSystemKey): CardType {
  return system === 'coc7e' ? 'trpg_coc7' : 'trpg_dnd5e';
}

export function detectTrpgSystemFromRecord(trpg: Record<string, unknown>): TrpgSystemKey | null {
  const sysText = String(trpg.system ?? '').toLowerCase();
  if (sysText.includes('cthulhu') || sysText.includes('coc')) {
    return 'coc7e';
  }
  if (sysText.includes('d&d') || sysText.includes('dnd') || sysText.includes('5e')) {
    return 'dnd5e';
  }
  if (
    (typeof trpg.characteristics === 'object' && trpg.characteristics !== null) ||
    (typeof trpg.derived === 'object' && trpg.derived !== null) ||
    Array.isArray(trpg.keySkills) ||
    typeof trpg.occupation === 'string'
  ) {
    return 'coc7e';
  }
  if (
    (typeof trpg.abilityScores === 'object' && trpg.abilityScores !== null) ||
    (typeof trpg.combat === 'object' && trpg.combat !== null) ||
    Array.isArray(trpg.proficiencies) ||
    typeof trpg.className === 'string'
  ) {
    return 'dnd5e';
  }
  return null;
}

function normalizeCoc7eRecord(existingTrpg: Record<string, unknown>): Record<string, unknown> {
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
  const existingSkills =
    Array.isArray(existingTrpg.keySkills) && existingTrpg.keySkills.length > 0
      ? existingTrpg.keySkills
      : ['侦查 65%', '图书馆使用 70%', '心理学 60%', '话术 55%'];

  return {
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
  };
}

function normalizeDnd5eRecord(existingTrpg: Record<string, unknown>): Record<string, unknown> {
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
  };
}

export function normalizeTrpgRecordForSystem(
  system: TrpgSystemKey,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return system === 'coc7e' ? normalizeCoc7eRecord(raw) : normalizeDnd5eRecord(raw);
}

export function extractTrpgSystems(
  content: RoleCardContent,
  fallbackCardType?: CardType,
): {
  systems: TrpgSystemsBucket;
  activeSystem: TrpgSystemKey | null;
} {
  const ext = asRecord(content.extensions);
  const rawBucket = asRecord(ext.trpgSystems);
  const systems: TrpgSystemsBucket = {};

  const cocRaw = asRecord(rawBucket.coc7e);
  if (hasOwnKeys(cocRaw)) {
    systems.coc7e = cocRaw;
  }
  const dndRaw = asRecord(rawBucket.dnd5e);
  if (hasOwnKeys(dndRaw)) {
    systems.dnd5e = dndRaw;
  }

  const legacyTrpg = asRecord(ext.trpg);
  const legacySys = hasOwnKeys(legacyTrpg)
    ? (detectTrpgSystemFromRecord(legacyTrpg) ?? cardTypeToTrpgSystem(fallbackCardType))
    : null;
  if (legacySys && !systems[legacySys]) {
    systems[legacySys] = legacyTrpg;
  }

  const rawActive =
    ext.activeTrpgSystem === 'coc7e' || ext.activeTrpgSystem === 'dnd5e'
      ? ext.activeTrpgSystem
      : null;

  let activeSystem: TrpgSystemKey | null = null;
  if (rawActive && systems[rawActive]) {
    activeSystem = rawActive;
  } else if (legacySys && systems[legacySys]) {
    activeSystem = legacySys;
  } else {
    const typeSys = cardTypeToTrpgSystem(fallbackCardType);
    if (typeSys && systems[typeSys]) {
      activeSystem = typeSys;
    } else if (systems.coc7e) {
      activeSystem = 'coc7e';
    } else if (systems.dnd5e) {
      activeSystem = 'dnd5e';
    } else if (rawActive) {
      activeSystem = rawActive;
    }
  }

  return { systems, activeSystem };
}

export function mergeTrpgSystemData(
  content: RoleCardContent,
  system: TrpgSystemKey,
  rawData: Record<string, unknown>,
  options: { activate?: boolean; fallbackCardType?: CardType } = {},
): RoleCardContent {
  const { systems, activeSystem } = extractTrpgSystems(content, options.fallbackCardType);
  const normalized = normalizeTrpgRecordForSystem(system, rawData);
  const nextBucket: TrpgSystemsBucket = {
    ...systems,
    [system]: normalized,
  };
  const nextActive: TrpgSystemKey =
    options.activate === false ? (activeSystem ?? system) : system;

  return {
    ...content,
    extensions: {
      ...content.extensions,
      trpgSystems: nextBucket,
      activeTrpgSystem: nextActive,
      trpg: nextBucket[nextActive] ?? normalized,
    },
  };
}

export function switchActiveTrpgSystem(
  content: RoleCardContent,
  system: TrpgSystemKey,
  fallbackCardType?: CardType,
): RoleCardContent | null {
  const { systems } = extractTrpgSystems(content, fallbackCardType);
  const targetData = systems[system];
  if (!targetData) {
    return null;
  }
  const normalized = normalizeTrpgRecordForSystem(system, targetData);
  const nextBucket: TrpgSystemsBucket = {
    ...systems,
    [system]: normalized,
  };
  return {
    ...content,
    extensions: {
      ...content.extensions,
      trpgSystems: nextBucket,
      activeTrpgSystem: system,
      trpg: normalized,
    },
  };
}

export function reconcileTrpgExtensionsOnEdit(
  previous: RoleCardContent,
  updated: RoleCardContent,
  fallbackCardType?: CardType,
): { content: RoleCardContent; activeSystem: TrpgSystemKey | null } {
  const prevExt = asRecord(previous.extensions);
  const nextExt = asRecord(updated.extensions);

  if (
    !hasOwnKeys(asRecord(nextExt.trpg)) &&
    !hasOwnKeys(asRecord(nextExt.trpgSystems)) &&
    !nextExt.activeTrpgSystem
  ) {
    return { content: updated, activeSystem: null };
  }

  const trpgChanged =
    JSON.stringify(prevExt.trpg ?? null) !== JSON.stringify(nextExt.trpg ?? null);
  const trpgSystemsChanged =
    JSON.stringify(prevExt.trpgSystems ?? null) !== JSON.stringify(nextExt.trpgSystems ?? null);
  const activeChanged = prevExt.activeTrpgSystem !== nextExt.activeTrpgSystem;

  if (trpgChanged && !trpgSystemsChanged && !activeChanged && hasOwnKeys(asRecord(nextExt.trpg))) {
    const editedTrpg = asRecord(nextExt.trpg);
    const detected =
      detectTrpgSystemFromRecord(editedTrpg) ?? cardTypeToTrpgSystem(fallbackCardType) ?? 'coc7e';
    const merged = mergeTrpgSystemData(updated, detected, editedTrpg, {
      activate: true,
      fallbackCardType,
    });
    return { content: merged, activeSystem: detected };
  }

  const { systems, activeSystem } = extractTrpgSystems(updated, fallbackCardType);
  if (!systems.coc7e && !systems.dnd5e) {
    return { content: updated, activeSystem };
  }

  const normalizedBucket: TrpgSystemsBucket = {};
  if (systems.coc7e) {
    normalizedBucket.coc7e = normalizeCoc7eRecord(systems.coc7e);
  }
  if (systems.dnd5e) {
    normalizedBucket.dnd5e = normalizeDnd5eRecord(systems.dnd5e);
  }
  const effectiveActive: TrpgSystemKey =
    (activeSystem && normalizedBucket[activeSystem] ? activeSystem : null) ??
    (normalizedBucket.coc7e ? 'coc7e' : 'dnd5e');

  return {
    content: {
      ...updated,
      extensions: {
        ...updated.extensions,
        trpgSystems: normalizedBucket,
        activeTrpgSystem: effectiveActive,
        trpg: normalizedBucket[effectiveActive],
      },
    },
    activeSystem: effectiveActive,
  };
}

export function applyTrpgPresetFields(
  cardType: CardType,
  content: RoleCardContent,
): RoleCardContent {
  const targetSystem = cardTypeToTrpgSystem(cardType);
  if (!targetSystem) {
    return content;
  }

  const { systems } = extractTrpgSystems(content, cardType);
  const existingForTarget = systems[targetSystem] ?? {};

  return mergeTrpgSystemData(content, targetSystem, existingForTarget, {
    activate: true,
    fallbackCardType: cardType,
  });
}
