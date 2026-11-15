import type { CardType, RoleCardContent, TrpgSystemKey } from '@rolecard/shared';

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasKeys(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).length > 0;
}

export function cardTypeToTrpgSystem(cardType?: CardType): TrpgSystemKey | null {
  if (cardType === 'trpg_coc7') return 'coc7e';
  if (cardType === 'trpg_dnd5e') return 'dnd5e';
  return null;
}

export function detectTrpgSystem(trpg: Record<string, unknown>): TrpgSystemKey | null {
  const sysText = String(trpg.system ?? '').toLowerCase();
  if (sysText.includes('cthulhu') || sysText.includes('coc')) return 'coc7e';
  if (sysText.includes('d&d') || sysText.includes('dnd') || sysText.includes('5e')) return 'dnd5e';
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

export interface ExtractedCardTrpgSystems {
  coc7e: Record<string, unknown> | null;
  dnd5e: Record<string, unknown> | null;
  activeSystem: TrpgSystemKey | null;
  hasAny: boolean;
  hasDual: boolean;
}

export function extractCardTrpgSystems(
  content: RoleCardContent,
  cardType?: CardType,
): ExtractedCardTrpgSystems {
  const ext = asRecord(content.extensions);
  const rawBucket = asRecord(ext.trpgSystems);

  const rawCoc = asRecord(rawBucket.coc7e);
  const rawDnd = asRecord(rawBucket.dnd5e);

  let coc7e: Record<string, unknown> | null = hasKeys(rawCoc) ? rawCoc : null;
  let dnd5e: Record<string, unknown> | null = hasKeys(rawDnd) ? rawDnd : null;

  const legacyTrpg = asRecord(ext.trpg);
  const legacySys = hasKeys(legacyTrpg)
    ? (detectTrpgSystem(legacyTrpg) ?? cardTypeToTrpgSystem(cardType))
    : null;
  if (legacySys === 'coc7e' && !coc7e) {
    coc7e = legacyTrpg;
  } else if (legacySys === 'dnd5e' && !dnd5e) {
    dnd5e = legacyTrpg;
  }

  const rawActive =
    ext.activeTrpgSystem === 'coc7e' || ext.activeTrpgSystem === 'dnd5e'
      ? ext.activeTrpgSystem
      : null;

  let activeSystem: TrpgSystemKey | null = null;
  if (rawActive === 'coc7e' && coc7e) {
    activeSystem = 'coc7e';
  } else if (rawActive === 'dnd5e' && dnd5e) {
    activeSystem = 'dnd5e';
  } else if (legacySys === 'coc7e' && coc7e) {
    activeSystem = 'coc7e';
  } else if (legacySys === 'dnd5e' && dnd5e) {
    activeSystem = 'dnd5e';
  } else {
    const fallback = cardTypeToTrpgSystem(cardType);
    if (fallback === 'coc7e' && coc7e) activeSystem = 'coc7e';
    else if (fallback === 'dnd5e' && dnd5e) activeSystem = 'dnd5e';
    else if (coc7e) activeSystem = 'coc7e';
    else if (dnd5e) activeSystem = 'dnd5e';
    else activeSystem = rawActive;
  }

  return {
    coc7e,
    dnd5e,
    activeSystem,
    hasAny: Boolean(coc7e || dnd5e),
    hasDual: Boolean(coc7e && dnd5e),
  };
}
