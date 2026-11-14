import {
  CharacterBookSchema,
  RoleCardContentSchema,
  type CharacterBook,
  type ImportCardRequest,
  type LorebookEntry,
  type RoleCardContent,
} from '@rolecard/shared';
import { extractCardJsonFromPng } from './ccv3.js';
import { applyTrpgPresetFields } from './lorebook.js';
import { type CoreError, type Result, err, ok } from './types.js';

export interface ParsedImportedCard {
  sourceSpec: 'chara_card_v3' | 'chara_card_v2' | 'chara_card_v1';
  content: RoleCardContent;
  embeddedBook?: CharacterBook;
  portraitPngBase64?: string;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
}

function normalizeCharacterBook(rawBook: unknown): CharacterBook | undefined {
  if (!rawBook || typeof rawBook !== 'object') return undefined;
  const bookObj = rawBook as Record<string, unknown>;

  let rawEntries: unknown[] = [];
  if (Array.isArray(bookObj.entries)) {
    rawEntries = bookObj.entries;
  } else if (bookObj.entries && typeof bookObj.entries === 'object') {
    rawEntries = Object.values(bookObj.entries as Record<string, unknown>);
  }

  const normalizedEntries: LorebookEntry[] = rawEntries
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
    .map((entry, idx) => ({
      uid: String(entry.uid ?? `imported_${idx}`),
      keys: asStringArray(entry.keys ?? entry.key),
      secondary_keys: asStringArray(entry.secondary_keys ?? entry.keysecondary),
      comment: asString(entry.comment),
      content: asString(entry.content),
      constant: Boolean(entry.constant),
      selective: entry.selective === undefined ? true : Boolean(entry.selective),
      insertion_order: Number(entry.insertion_order ?? entry.order ?? 100),
      enabled: entry.enabled === undefined ? !entry.disable : Boolean(entry.enabled),
      position: entry.position === 'after_char' || entry.position === 1 ? 'after_char' : 'before_char',
      extensions:
        typeof entry.extensions === 'object' && entry.extensions !== null
          ? (entry.extensions as Record<string, unknown>)
          : {},
    }));

  const parsed = CharacterBookSchema.safeParse({
    name: asString(bookObj.name) || undefined,
    description: asString(bookObj.description) || undefined,
    scan_depth: Number(bookObj.scan_depth ?? 4),
    token_budget: Number(bookObj.token_budget ?? 1500),
    recursive_scanning: Boolean(bookObj.recursive_scanning),
    extensions:
      typeof bookObj.extensions === 'object' && bookObj.extensions !== null
        ? (bookObj.extensions as Record<string, unknown>)
        : {},
    entries: normalizedEntries,
  });

  return parsed.success ? parsed.data : undefined;
}

export function normalizeLegacyCardObject(
  raw: unknown,
  requestTags: readonly string[] = [],
): Result<Omit<ParsedImportedCard, 'portraitPngBase64'>, CoreError> {
  if (!raw || typeof raw !== 'object') {
    return err({
      code: 'INVALID_IMPORT_CARD',
      message: '导入的角色卡 JSON 不是有效的对象结构',
      status: 400,
    });
  }

  const root = raw as Record<string, unknown>;
  let sourceSpec: ParsedImportedCard['sourceSpec'] = 'chara_card_v1';
  let dataObj: Record<string, unknown> = root;

  if (root.spec === 'chara_card_v3' && root.data && typeof root.data === 'object') {
    sourceSpec = 'chara_card_v3';
    dataObj = root.data as Record<string, unknown>;
  } else if (root.spec === 'chara_card_v2' && root.data && typeof root.data === 'object') {
    sourceSpec = 'chara_card_v2';
    dataObj = root.data as Record<string, unknown>;
  }

  const name = asString(dataObj.name).trim();
  if (!name) {
    return err({
      code: 'MISSING_CHARACTER_NAME',
      message: '导入的角色卡缺少必填字段 name',
      status: 400,
    });
  }

  const description = asString(dataObj.description).trim();
  const personality = asString(dataObj.personality).trim() || description.slice(0, 300) || `${name} 的个性设定`;
  const summary =
    asString(dataObj.summary).trim() ||
    description.split(/\r?\n/)[0]?.slice(0, 180) ||
    `${name}（由旧版角色卡导入升级）`;

  const mergedTags = [
    ...new Set([...asStringArray(dataObj.tags), ...requestTags.map((t) => t.trim()).filter(Boolean)]),
  ];

  const normalized = RoleCardContentSchema.safeParse({
    name,
    summary,
    personality,
    appearance: asString(dataObj.appearance),
    background: description || asString(dataObj.background),
    speech_style:
      typeof dataObj.speech_style === 'object' && dataObj.speech_style !== null
        ? dataObj.speech_style
        : { tone: '', catchphrases: [], habits: [] },
    relationships: Array.isArray(dataObj.relationships) ? dataObj.relationships : [],
    first_mes: asString(dataObj.first_mes),
    alternate_greetings: asStringArray(dataObj.alternate_greetings),
    mes_example: asString(dataObj.mes_example),
    system_prompt: asString(dataObj.system_prompt),
    scenario: asString(dataObj.scenario),
    creator_notes: asString(dataObj.creator_notes),
    tags: mergedTags,
    extensions: {
      ...(typeof dataObj.extensions === 'object' && dataObj.extensions !== null
        ? (dataObj.extensions as Record<string, unknown>)
        : {}),
      upgradedFrom: sourceSpec,
    },
  });

  if (!normalized.success) {
    return err({
      code: 'INVALID_CARD_FIELDS',
      message: `角色卡字段规范化失败：${normalized.error.issues[0]?.message ?? '格式不合法'}`,
      status: 400,
    });
  }

  const embeddedBook = normalizeCharacterBook(dataObj.character_book);
  return ok({
    sourceSpec,
    content: normalized.data,
    embeddedBook,
  });
}

export function parseImportedCardPayload(
  request: ImportCardRequest,
): Result<ParsedImportedCard, CoreError> {
  const isPng =
    request.format === 'png' ||
    (request.format === undefined &&
      (request.filename.toLowerCase().endsWith('.png') || Boolean(request.pngBase64)));

  if (isPng && request.pngBase64) {
    const cleanB64 = request.pngBase64.replace(/^data:image\/png;base64,/i, '').trim();
    const buf = Buffer.from(cleanB64, 'base64');
    const extracted = extractCardJsonFromPng(buf);
    if (!extracted.ok) {
      return extracted;
    }
    const normalized = normalizeLegacyCardObject(extracted.value.raw, request.tags);
    if (!normalized.ok) {
      return normalized;
    }
    return ok({
      ...normalized.value,
      content: applyTrpgPresetFields(request.targetCardType, normalized.value.content),
      portraitPngBase64: cleanB64,
    });
  }

  if (!request.jsonText?.trim()) {
    return err({
      code: 'MISSING_IMPORT_PAYLOAD',
      message: '请提供角色卡 PNG 文件或 JSON 内容',
      status: 400,
    });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(request.jsonText) as unknown;
  } catch {
    return err({
      code: 'INVALID_JSON',
      message: '导入的 JSON 解析失败，请检查文件格式',
      status: 400,
    });
  }

  const normalized = normalizeLegacyCardObject(parsedJson, request.tags);
  if (!normalized.ok) {
    return normalized;
  }

  return ok({
    ...normalized.value,
    content: applyTrpgPresetFields(request.targetCardType, normalized.value.content),
  });
}
