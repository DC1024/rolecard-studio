import { z } from 'zod';
import {
  estimateCardTokens,
  RelationshipEntrySchema,
  RoleCardContentSchema,
  SpeechStyleSchema,
  type CardGeneratableField,
  type CardType,
  type EntityType,
  type HitLorebookDebugItem,
  type LorebookEntry,
  type PlaytestRequest,
  type PlaytestResponse,
  type RoleCardContent,
  type SourceEntry,
  type TrpgSystemKey,
} from '@rolecard/shared';
import { completeStructuredJson } from './llm/json-repair.js';
import { extractTrpgSystems, normalizeTrpgRecordForSystem } from './lorebook.js';
import {
  type CoreError,
  type LlmCompletionPort,
  type LlmMessage,
  type LlmSlotRuntimeConfig,
  type Result,
  err,
  ok,
} from './types.js';

export interface PlaytestLorebookInput {
  id: string;
  name: string;
  entries: LorebookEntry[];
}

export interface PlaytestDeps {
  llmPort: LlmCompletionPort;
  llmSlot: LlmSlotRuntimeConfig;
  lorebooks?: PlaytestLorebookInput[];
  enableMetaInChat?: boolean;
  metaReputationSummary?: string | null;
  fallbackCardType?: CardType;
}

function asPlaytestRecord(val: unknown): Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

function asPlaytestStringArray(val: unknown): string[] {
  return Array.isArray(val) ? val.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
}

function buildTrpgPlaytestContext(
  system: TrpgSystemKey,
  rawTrpg: Record<string, unknown>,
): string[] {
  const trpg = normalizeTrpgRecordForSystem(system, rawTrpg);
  if (system === 'coc7e') {
    const chars = asPlaytestRecord(trpg.characteristics);
    const derived = asPlaytestRecord(trpg.derived);
    const skills = asPlaytestStringArray(trpg.keySkills);
    return [
      '=== TRPG 规则注入 · Call of Cthulhu 7e（调查员规则面板） ===',
      `职业：${String(trpg.occupation ?? '调查员')} | 时代：${String(trpg.era ?? '1920s / 现代架空')}`,
      `基础属性：STR ${chars.STR ?? 55}, CON ${chars.CON ?? 60}, SIZ ${chars.SIZ ?? 60}, DEX ${chars.DEX ?? 65}, APP ${chars.APP ?? 55}, INT ${chars.INT ?? 75}, POW ${chars.POW ?? 65}, EDU ${chars.EDU ?? 70}`,
      `衍生状态：HP ${derived.HP ?? 12}, MP ${derived.MP ?? 13}, SAN ${derived.SAN ?? 65}, Luck ${derived.Luck ?? 55}, Move ${derived.Move ?? 8}`,
      skills.length > 0 ? `核心技能：${skills.join('、')}` : '',
      '试聊指令：当前处于 CoC 7e 跑团语境，请基于你的调查员属性、理智值与技能水平进行角色扮演、线索推理与行动回应。',
    ].filter(Boolean);
  }

  const abilities = asPlaytestRecord(trpg.abilityScores);
  const combat = asPlaytestRecord(trpg.combat);
  const profs = asPlaytestStringArray(trpg.proficiencies);
  const feats = asPlaytestStringArray(trpg.featuresAndTraits);
  return [
    '=== TRPG 规则注入 · D&D 5e（冒险者规则面板） ===',
    `种族：${String(trpg.race ?? '人类')} | 职业：${String(trpg.className ?? '冒险者')} | 等级：Lv.${String(trpg.level ?? 3)} | 阵营：${String(trpg.alignment ?? '中立善良')}`,
    `六维属性：STR ${abilities.STR ?? 12}, DEX ${abilities.DEX ?? 15}, CON ${abilities.CON ?? 14}, INT ${abilities.INT ?? 13}, WIS ${abilities.WIS ?? 12}, CHA ${abilities.CHA ?? 14}`,
    `战斗数值：AC ${combat.AC ?? 15}, MaxHP ${combat.MaxHP ?? 24}, HitDice ${String(combat.HitDice ?? '3d8')}, Speed ${String(combat.Speed ?? '30 ft')}`,
    profs.length > 0 ? `熟练项：${profs.join('、')}` : '',
    feats.length > 0 ? `职业特性与战技：${feats.join('、')}` : '',
    '试聊指令：当前处于 D&D 5e 跑团语境，请基于你的种族、职业特性、六维属性与战斗能力进行角色扮演与冒险互动。',
  ].filter(Boolean);
}

export function replaceCardPlaceholders(
  text: string,
  charName: string,
  userName: string,
): string {
  return text
    .replace(/\{\{char\}\}/gi, charName)
    .replace(/\{\{user\}\}/gi, userName);
}

export function resolveCardGreeting(content: RoleCardContent, greetingIndex: number): string {
  const all = [content.first_mes, ...content.alternate_greetings].filter((g) => g.trim().length > 0);
  if (all.length === 0) {
    return `*${content.name}向你投来目光。*`;
  }
  const safeIndex = Math.max(0, Math.min(greetingIndex, all.length - 1));
  return all[safeIndex] ?? all[0]!;
}

export function scanHitLorebookEntries(
  lorebooks: readonly PlaytestLorebookInput[],
  scanText: string,
): {
  hits: HitLorebookDebugItem[];
  injectedContents: string[];
} {
  const lowerScan = scanText.toLowerCase();
  const hits: HitLorebookDebugItem[] = [];
  const injectedContents: string[] = [];

  for (const lb of lorebooks) {
    for (const entry of lb.entries) {
      if (!entry.enabled || !entry.content.trim()) {
        continue;
      }
      if (entry.constant) {
        hits.push({
          lorebookId: lb.id,
          lorebookName: lb.name,
          uid: entry.uid,
          comment: entry.comment || entry.uid,
          keys: entry.keys,
          mode: 'blue_constant',
        });
        injectedContents.push(`[常驻世界观 · ${entry.comment || entry.uid}] ${entry.content}`);
        continue;
      }

      const matchedKey = entry.keys.find(
        (key) => key.trim().length > 0 && lowerScan.includes(key.trim().toLowerCase()),
      );
      if (matchedKey) {
        hits.push({
          lorebookId: lb.id,
          lorebookName: lb.name,
          uid: entry.uid,
          comment: entry.comment || entry.uid,
          keys: entry.keys,
          mode: 'green_keyword',
          matchedKeyword: matchedKey,
        });
        injectedContents.push(
          `[触发词条(${matchedKey}) · ${entry.comment || entry.uid}] ${entry.content}`,
        );
      }
    }
  }

  return { hits, injectedContents };
}

export async function runPlaytestTurn(
  card: RoleCardContent,
  request: PlaytestRequest,
  deps: PlaytestDeps,
): Promise<Result<PlaytestResponse, CoreError>> {
  const rawGreeting = resolveCardGreeting(card, request.greetingIndex);
  const greetingText = replaceCardPlaceholders(rawGreeting, card.name, request.userName);

  const windowedHistory = request.history.slice(-40);
  const recentText = [
    ...windowedHistory.slice(-4).map((h) => h.content),
    request.message,
  ].join('\n');

  const { hits, injectedContents } = scanHitLorebookEntries(deps.lorebooks ?? [], recentText);

  const systemParts: string[] = [
    `你现在正在扮演角色「${card.name}」。`,
    `角色定位：${card.summary}`,
    `性格特征：${card.personality}`,
  ];
  if (card.appearance.trim()) {
    systemParts.push(`外貌：${card.appearance}`);
  }
  if (card.background.trim()) {
    systemParts.push(`背景：${card.background}`);
  }
  if (card.speech_style.tone || card.speech_style.catchphrases.length > 0) {
    systemParts.push(
      `说话风格：语调=${card.speech_style.tone}；口癖=${card.speech_style.catchphrases.join('、')}`,
    );
  }
  if (card.scenario.trim()) {
    systemParts.push(`当前场景：${replaceCardPlaceholders(card.scenario, card.name, request.userName)}`);
  }
  if (card.system_prompt.trim()) {
    systemParts.push(replaceCardPlaceholders(card.system_prompt, card.name, request.userName));
  }
  if (request.userPersona.trim()) {
    systemParts.push(`对话对象 {{user}} (${request.userName}) 设定：${request.userPersona.trim()}`);
  } else {
    systemParts.push(`对话对象名称：${request.userName}`);
  }
  if (injectedContents.length > 0) {
    systemParts.push('=== 关联世界书上下文 ===', ...injectedContents);
  }

  const metaInjected = Boolean(deps.enableMetaInChat && deps.metaReputationSummary?.trim());
  if (metaInjected && deps.metaReputationSummary) {
    systemParts.push(
      '=== Meta 现实风评参考（用户显式开启打破第四面墙模式） ===',
      deps.metaReputationSummary,
    );
  }

  let trpgSystemInjected: TrpgSystemKey | null = null;
  if (request.trpgSystem !== 'none') {
    const { systems, activeSystem } = extractTrpgSystems(card, deps.fallbackCardType);
    const chosenSystem: TrpgSystemKey | null =
      request.trpgSystem === 'coc7e' || request.trpgSystem === 'dnd5e'
        ? systems[request.trpgSystem]
          ? request.trpgSystem
          : null
        : activeSystem && systems[activeSystem]
          ? activeSystem
          : null;
    if (chosenSystem && systems[chosenSystem]) {
      trpgSystemInjected = chosenSystem;
      systemParts.push(...buildTrpgPlaytestContext(chosenSystem, systems[chosenSystem]!));
    }
  }

  const messages: LlmMessage[] = [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'assistant', content: greetingText },
    ...windowedHistory.map((item) => ({
      role: item.role,
      content: replaceCardPlaceholders(item.content, card.name, request.userName),
    })),
    {
      role: 'user',
      content: replaceCardPlaceholders(request.message, card.name, request.userName),
    },
  ];

  const completion = await deps.llmPort({
    provider: deps.llmSlot.provider,
    apiKey: deps.llmSlot.apiKey,
    baseUrl: deps.llmSlot.baseUrl,
    model: request.modelOverride?.model ?? deps.llmSlot.model,
    messages,
    temperature: 0.72,
    maxTokens: 900,
    jsonMode: false,
  });

  if (completion.status >= 400 || !completion.content.trim()) {
    return err({
      code: 'PLAYTEST_LLM_FAILED',
      message: `试聊模型调用失败 (HTTP ${completion.status}): ${completion.rawError ?? '空响应'}`,
      status: 502,
    });
  }

  return ok({
    reply: completion.content.trim(),
    usedModel: request.modelOverride?.model ?? deps.llmSlot.model,
    usedProvider: request.modelOverride?.provider ?? deps.llmSlot.provider,
    greetingText,
    hitLorebooks: hits,
    metaInjected,
    trpgSystemInjected,
  });
}

export function appendTurnToMesExample(
  existingMesExample: string,
  userMessage: string,
  assistantMessage: string,
): string {
  const block = `<START>\n{{user}}: ${userMessage.trim()}\n{{char}}: ${assistantMessage.trim()}`;
  const cleanExisting = existingMesExample.trim();
  return cleanExisting ? `${cleanExisting}\n${block}` : block;
}

const CARD_LOCKABLE_KEYS: readonly (keyof RoleCardContent)[] = [
  'name',
  'summary',
  'personality',
  'appearance',
  'background',
  'speech_style',
  'relationships',
  'first_mes',
  'alternate_greetings',
  'mes_example',
  'system_prompt',
  'scenario',
  'creator_notes',
  'tags',
];

export function preserveLockedFields(
  original: RoleCardContent,
  updated: RoleCardContent,
  lockedFields: readonly string[],
): RoleCardContent {
  if (lockedFields.length === 0) {
    return updated;
  }
  const lockedSet = new Set(lockedFields);
  const merged = { ...updated };

  for (const key of CARD_LOCKABLE_KEYS) {
    if (lockedSet.has(key)) {
      (merged as Record<string, unknown>)[key] = structuredClone(original[key]);
    }
  }

  return merged;
}

export function computeCardDiffSummary(
  before: RoleCardContent,
  after: RoleCardContent,
): string {
  const changed: string[] = [];
  for (const key of CARD_LOCKABLE_KEYS) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed.push(key);
    }
  }
  if (changed.length === 0) {
    return '无字段实质变更';
  }
  return `已更新字段: ${changed.join(', ')}`;
}

export interface SelectedSourceSnippet {
  index: number;
  source: SourceEntry;
}

export function selectSourcesForGeneration(
  sources: readonly SourceEntry[] | undefined,
  sourceIndices?: readonly number[],
  maxEntries = 6,
  maxTotalChars = 5400,
): string {
  const list = sources ?? [];
  if (list.length === 0) {
    return '';
  }

  let selected: SelectedSourceSnippet[] = [];
  if (sourceIndices && sourceIndices.length > 0) {
    const seen = new Set<number>();
    for (const rawIdx of sourceIndices) {
      if (Number.isInteger(rawIdx) && rawIdx >= 0 && rawIdx < list.length && !seen.has(rawIdx)) {
        seen.add(rawIdx);
        selected.push({ index: rawIdx, source: list[rawIdx]! });
      }
    }
    selected = selected.slice(0, maxEntries);
  } else {
    // 默认优先保留最新补充的引用（倒序取最多 maxEntries 条再按原顺序排列），避免第 5 条及以后新增引用被静默截断
    const start = Math.max(0, list.length - maxEntries);
    for (let i = start; i < list.length; i += 1) {
      selected.push({ index: i, source: list[i]! });
    }
  }

  if (selected.length === 0) {
    return '';
  }

  const perEntryBudget = Math.max(500, Math.min(1600, Math.floor(maxTotalChars / selected.length)));
  let remainingChars = maxTotalChars;
  const lines: string[] = [];

  for (const item of selected) {
    if (remainingChars <= 120) break;
    const limit = Math.min(perEntryBudget, remainingChars);
    const originLabel = item.source.origin === 'user_provided' ? '用户提供' : '检索补充';
    const snippet =
      item.source.snippet.length > limit
        ? `${item.source.snippet.slice(0, Math.max(0, limit - 3)).trimEnd()}...`
        : item.source.snippet;
    lines.push(`[参考资料 #${item.index + 1} · ${originLabel}] ${item.source.title}: ${snippet}`);
    remainingChars -= snippet.length;
  }

  return lines.join('\n');
}

export interface RefineCardDeps {
  llmPort: LlmCompletionPort;
  llmSlot: LlmSlotRuntimeConfig;
  lockedFields?: readonly string[];
  sources?: readonly SourceEntry[];
  sourceIndices?: readonly number[];
  workName?: string;
  customSystemPrompt?: string;
  onStrategyDowngraded?: (strategy: 'prompt') => void | Promise<void>;
  onProgress?: (event: { step: string; message: string }) => void | Promise<void>;
  onReasoningDelta?: (delta: string) => void | Promise<void>;
}

export async function refineRoleCard(
  current: RoleCardContent,
  instruction: string,
  deps: RefineCardDeps,
): Promise<
  Result<
    {
      content: RoleCardContent;
      diffSummary: string;
      tokenCount: number;
    },
    CoreError
  >
> {
  const locked = deps.lockedFields ?? [];
  const lockNotice =
    locked.length > 0
      ? `\n注意：以下字段已被用户锁定，严禁修改其内容，必须原样保留：${locked.join(', ')}`
      : '';
  const styleNotice = deps.customSystemPrompt?.trim()
    ? `\n全局附加风格要求：${deps.customSystemPrompt.trim()}`
    : '';
  const sourceSnippets = selectSourcesForGeneration(deps.sources, deps.sourceIndices);

  const userParts = [
    deps.workName ? `所属作品/世界观：${deps.workName}` : '',
    `现有角色卡 JSON：\n${JSON.stringify(current, null, 2)}`,
    sourceSnippets
      ? `最新参考与考据资料（若微调指令涉及补充新信息或事实考据，请优先依据以下资料更新相关设定）：\n${sourceSnippets}`
      : '',
    `微调指令：${instruction}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await completeStructuredJson(deps.llmPort, {
    slot: deps.llmSlot,
    schema: RoleCardContentSchema,
    schemaHint: '完整的 RoleCardContent JSON 对象',
    temperature: 0.35,
    actionLabel: '执行整卡局部微调',
    onStrategyDowngraded: deps.onStrategyDowngraded,
    onProgress: deps.onProgress,
    onReasoningDelta: deps.onReasoningDelta,
    messages: [
      {
        role: 'system',
        content: `你是角色卡局部微调专家。请基于现有角色卡 JSON 与补充参考资料执行用户的微调指令，仅调整需要修改的字段，保持其余设定完整一致。${lockNotice}${styleNotice}`,
      },
      {
        role: 'user',
        content: userParts,
      },
    ],
  });

  if (!result.ok) {
    return result;
  }

  const mergedExtensions: Record<string, unknown> = {
    ...structuredClone(current.extensions),
    ...result.value.data.extensions,
  };
  if (
    current.extensions.trpgSystems !== undefined &&
    result.value.data.extensions.trpgSystems === undefined
  ) {
    mergedExtensions.trpgSystems = structuredClone(current.extensions.trpgSystems);
  }
  if (
    current.extensions.activeTrpgSystem !== undefined &&
    result.value.data.extensions.activeTrpgSystem === undefined
  ) {
    mergedExtensions.activeTrpgSystem = current.extensions.activeTrpgSystem;
  }
  if (current.extensions.trpg !== undefined && result.value.data.extensions.trpg === undefined) {
    mergedExtensions.trpg = structuredClone(current.extensions.trpg);
  }

  const protectedContent = preserveLockedFields(
    current,
    {
      ...result.value.data,
      extensions: mergedExtensions,
    },
    locked,
  );
  return ok({
    content: protectedContent,
    diffSummary: computeCardDiffSummary(current, protectedContent),
    tokenCount: estimateCardTokens(protectedContent),
  });
}

export async function compressRoleCard(
  current: RoleCardContent,
  targetMaxTokens: number,
  deps: RefineCardDeps,
): Promise<
  Result<
    {
      content: RoleCardContent;
      beforeTokens: number;
      afterTokens: number;
      diffSummary: string;
    },
    CoreError
  >
> {
  const beforeTokens = estimateCardTokens(current);
  const locked = deps.lockedFields ?? [];
  const lockNotice =
    locked.length > 0
      ? `\n已锁定字段必须原样保留不得精简：${locked.join(', ')}`
      : '';
  const { extensions: originalExtensions, ...compressibleContent } = current;

  const result = await completeStructuredJson(deps.llmPort, {
    slot: deps.llmSlot,
    schema: RoleCardContentSchema,
    schemaHint: '精简后的 RoleCardContent JSON 对象',
    temperature: 0.25,
    actionLabel: '执行语义精简（跳过 TRPG 面板与锁定字段）',
    onStrategyDowngraded: deps.onStrategyDowngraded,
    onProgress: deps.onProgress,
    onReasoningDelta: deps.onReasoningDelta,
    messages: [
      {
        role: 'system',
        content: `你是角色卡语义精简专家。请在不丢失核心人设、口癖、关键人际关系与开场白质感的前提下，去除冗余修饰语，将整卡文本精简至约 ${targetMaxTokens} Tokens 以内。注意：此过程属于有损语义压缩，请尽量保留角色核心识别度。${lockNotice}`,
      },
      {
        role: 'user',
        content: `待精简角色卡 JSON（当前约 ${beforeTokens} Tokens，已跳过不参与 Token 统计的 extensions 面板）：\n${JSON.stringify(compressibleContent, null, 2)}`,
      },
    ],
  });

  if (!result.ok) {
    return result;
  }

  const withPreservedExtensions: RoleCardContent = {
    ...result.value.data,
    extensions: structuredClone(originalExtensions),
  };
  const protectedContent = preserveLockedFields(current, withPreservedExtensions, locked);
  const afterTokens = estimateCardTokens(protectedContent);

  return ok({
    content: protectedContent,
    beforeTokens,
    afterTokens,
    diffSummary: `语义精简 (${beforeTokens} -> ${afterTokens} Tokens)`,
  });
}

const CARD_FIELD_META: Record<
  CardGeneratableField,
  { label: string; guidance: string; schemaHint: string }
> = {
  summary: {
    label: '角色简介',
    guidance: '提炼 1~2 句话的高概念定位，概括角色核心身份、时代/世界观定位与戏剧魅力。',
    schemaHint: '{ "value": "一句话高概念角色简介" }',
  },
  personality: {
    label: '性格特征',
    guidance: '详细刻画角色的性格特质、行为准则、价值观、内在矛盾与对外界刺激的典型反应。',
    schemaHint: '{ "value": "性格特征与行为准则正文" }',
  },
  appearance: {
    label: '外貌立绘',
    guidance: '生动细致地描写角色的体型身高、五官神态、发色瞳色、标志性服饰、配饰与整体氛围感（便于人类阅读与 AI 立绘参考）。',
    schemaHint: '{ "value": "外貌、服饰与视觉特征描写" }',
  },
  background: {
    label: '背景故事',
    guidance: '结合既有设定梳理角色的出身来历、关键转折事件、过往羁绊与当前处境，脉络清晰且不与已有设定冲突。',
    schemaHint: '{ "value": "背景故事与经历正文" }',
  },
  scenario: {
    label: '场景设定',
    guidance: '构建适合展开互动的当前时间线、地点环境、氛围与双方所处的剧情切入背景。',
    schemaHint: '{ "value": "当前场景设定正文" }',
  },
  speech_style: {
    label: '语言风格与口癖',
    guidance: '提炼角色的典型说话语调（tone）、标志性口癖列表（catchphrases）与表达习惯（habits）。',
    schemaHint: '{ "value": { "tone": "语调特征", "catchphrases": ["口癖1", "口癖2"], "habits": ["语言习惯1"] } }',
  },
  relationships: {
    label: '人际关系',
    guidance: '梳理 2~5 组关键人物关系，每条包含 target（对方名称）、relation（关系定位）与 attitude（具体态度与互动张力）。',
    schemaHint: '{ "value": [{ "target": "关联角色", "relation": "关系", "attitude": "态度" }] }',
  },
  first_mes: {
    label: '默认开场白',
    guidance: '编写富有代入感与画面感的默认开场白，结合动作神态、环境描写与自然对话钩子（可使用 {{char}} 和 {{user}} 占位符）。',
    schemaHint: '{ "value": "沉浸式默认开场白正文" }',
  },
  alternate_greetings: {
    label: '备选开场白',
    guidance: '编写 2~3 条风格或切入情境各异的备选开场白，返回字符串数组。',
    schemaHint: '{ "value": ["备选开场白1", "备选开场白2"] }',
  },
  mes_example: {
    label: '对话示例',
    guidance: '严格按照 SillyTavern 标准格式编写 2~3 组对话示例，每组以 <START> 开头，交替使用 {{user}}: 与 {{char}}: 展示典型口癖、心理活动与动作神态。',
    schemaHint: '{ "value": "<START>\\n{{user}}: ...\\n{{char}}: ..." }',
  },
  system_prompt: {
    label: '系统提示词',
    guidance: '编写清晰的角色扮演系统提示词，明确视角、文风、语言习惯、核心禁忌与防 OOC（不跳戏）约束。',
    schemaHint: '{ "value": "角色扮演系统提示词" }',
  },
  creator_notes: {
    label: '作者备注',
    guidance: '总结使用建议、推荐交互方式、核心设定要点或考据说明，返回简洁清晰的备注文本。',
    schemaHint: '{ "value": "创作与使用备注" }',
  },
  tags: {
    label: '角色标签',
    guidance:
      '结合角色的人设、所属作品/世界观、性格特质、外貌与职业定位，提炼 4~8 个精准简短的中文分类标签（每个标签 2~8 个字，不带 # 号，不要输出整句解释）。',
    schemaHint: '{ "value": ["标签1", "标签2", "标签3", "标签4"] }',
  },
};

export interface GenerateCardFieldDeps {
  llmPort: LlmCompletionPort;
  llmSlot: LlmSlotRuntimeConfig;
  workName?: string;
  cardType?: CardType;
  entityType?: EntityType;
  sources?: readonly SourceEntry[];
  sourceIndices?: readonly number[];
  instruction?: string;
  customSystemPrompt?: string;
  onStrategyDowngraded?: (strategy: 'prompt') => void | Promise<void>;
  onProgress?: (event: { step: string; message: string }) => void | Promise<void>;
  onReasoningDelta?: (delta: string) => void | Promise<void>;
}

export async function generateCardField(
  current: RoleCardContent,
  field: CardGeneratableField,
  deps: GenerateCardFieldDeps,
): Promise<
  Result<
    {
      content: RoleCardContent;
      field: CardGeneratableField;
      fieldLabel: string;
      diffSummary: string;
      tokenCount: number;
    },
    CoreError
  >
> {
  const meta = CARD_FIELD_META[field];

  const fieldValueSchema: z.ZodType<{ value: unknown }> =
    field === 'speech_style'
      ? z.object({ value: SpeechStyleSchema })
      : field === 'relationships'
        ? z.object({ value: z.array(RelationshipEntrySchema) })
        : field === 'alternate_greetings'
          ? z.object({ value: z.array(z.string().trim().min(1)) })
          : field === 'tags'
            ? z.object({ value: z.array(z.string().trim().min(1).max(32)).min(1).max(20) })
            : field === 'summary' || field === 'personality'
              ? z.object({ value: z.string().trim().min(1) })
              : z.object({ value: z.string() });

  const systemLines = [
    '你是 RoleCard Studio 角色卡精细化创作助手。请在不破坏角色整体人设一致性的前提下，专门为目标区块生成高质量内容。',
    `目标区块：${meta.label} (${field})`,
    `生成要求：${meta.guidance}`,
    '你必须只返回 JSON 对象：{ "value": ... }，不要包含其他字段或额外解释。',
  ];
  if (deps.customSystemPrompt?.trim()) {
    systemLines.push(`全局附加风格要求：${deps.customSystemPrompt.trim()}`);
  }

  const sourceSnippets = selectSourcesForGeneration(deps.sources, deps.sourceIndices);

  const userParts = [
    `角色名称：${current.name}`,
    deps.workName ? `所属作品/世界观：${deps.workName}` : '',
    deps.cardType ? `卡片规格：${deps.cardType}` : '',
    deps.entityType ? `实体类型：${deps.entityType === 'real_person' ? '现实人物' : '虚构角色'}` : '',
    `现有完整角色卡设定（请保持世界观、性格与语气与之一致）：\n${JSON.stringify(current, null, 2)}`,
    sourceSnippets ? `考据与参考资料摘录：\n${sourceSnippets}` : '',
    deps.instruction?.trim() ? `用户附加要求：${deps.instruction.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await completeStructuredJson(deps.llmPort, {
    slot: deps.llmSlot,
    schema: fieldValueSchema,
    schemaHint: meta.schemaHint,
    temperature: 0.5,
    actionLabel: `生成「${meta.label}」`,
    onStrategyDowngraded: deps.onStrategyDowngraded,
    onProgress: deps.onProgress,
    onReasoningDelta: deps.onReasoningDelta,
    messages: [
      { role: 'system', content: systemLines.join('\n') },
      { role: 'user', content: userParts },
    ],
  });

  if (!result.ok) {
    return result;
  }

  const nextContent = structuredClone(current);
  let diffSummary = `AI 单区块生成: ${meta.label}`;
  if (field === 'tags') {
    const incoming = Array.isArray(result.value.data.value)
      ? (result.value.data.value as string[])
      : [];
    const mergedTags = mergeCardTagsDedupe(current.tags, incoming);
    const addedCount = Math.max(0, mergedTags.length - mergeCardTagsDedupe(current.tags, []).length);
    nextContent.tags = mergedTags;
    diffSummary = `AI 生成标签：追加 ${addedCount} 个（共 ${mergedTags.length} 个）`;
  } else {
    (nextContent as Record<string, unknown>)[field] = result.value.data.value;
  }

  return ok({
    content: nextContent,
    field,
    fieldLabel: meta.label,
    diffSummary,
    tokenCount: estimateCardTokens(nextContent),
  });
}

export function mergeCardTagsDedupe(
  existing: readonly string[],
  generated: readonly string[],
  maxTags = 30,
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const raw of [...existing, ...generated]) {
    const clean = raw.replace(/^#+/, '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(clean.slice(0, 32));
    }
    if (merged.length >= maxTags) break;
  }
  return merged;
}

export interface RegenerateCardDeps {
  llmPort: LlmCompletionPort;
  llmSlot: LlmSlotRuntimeConfig;
  lockedFields?: readonly string[];
  sources?: readonly SourceEntry[];
  sourceIndices?: readonly number[];
  workName?: string;
  cardType?: CardType;
  entityType?: EntityType;
  instruction?: string;
  customSystemPrompt?: string;
  onStrategyDowngraded?: (strategy: 'prompt') => void | Promise<void>;
  onProgress?: (event: { step: string; message: string }) => void | Promise<void>;
  onReasoningDelta?: (delta: string) => void | Promise<void>;
}

export async function regenerateRoleCard(
  current: RoleCardContent,
  deps: RegenerateCardDeps,
): Promise<
  Result<
    {
      content: RoleCardContent;
      regeneratedFields: string[];
      skippedLockedFields: string[];
      diffSummary: string;
      tokenCount: number;
    },
    CoreError
  >
> {
  const locked = deps.lockedFields ?? [];
  const lockedSet = new Set(locked);
  const editableKeys = CARD_LOCKABLE_KEYS.filter((k) => k !== 'name');
  const unlockedKeys = editableKeys.filter((k) => !lockedSet.has(k));
  const skippedLockedFields = editableKeys.filter((k) => lockedSet.has(k));

  if (unlockedKeys.length === 0) {
    return err({
      code: 'ALL_FIELDS_LOCKED',
      message: '所有可编辑区块均已锁定，请至少解锁一个区块后再执行一键生成',
      status: 400,
    });
  }

  const { extensions: originalExtensions, ...baseCard } = current;
  const sourceSnippets = selectSourcesForGeneration(deps.sources, deps.sourceIndices);

  const systemLines = [
    '你是 RoleCard Studio 资深角色卡重构专家。请根据现有角色设定与参考资料，对未锁定的全部角色卡区块进行高质量协同重写与丰富，确保人设、语言风格、背景与开场白高度统一。',
    `角色名称必须保持为「${current.name}」。`,
    `本次需要生成/更新的区块：${unlockedKeys.join(', ')}`,
    skippedLockedFields.length > 0
      ? `以下字段已被用户锁定，严禁修改其内容，输出时请保持原样一致：${skippedLockedFields.join(', ')}`
      : '当前无锁定字段，请协同优化全部内容区块（tags 请提炼 4~8 个精准简短中文标签）。',
    'extensions 字段无需改动，输出 `{}` 或保留即可。',
  ];
  if (deps.customSystemPrompt?.trim()) {
    systemLines.push(`全局附加风格要求：${deps.customSystemPrompt.trim()}`);
  }

  const userParts = [
    `角色名称：${current.name}`,
    deps.workName ? `所属作品/世界观：${deps.workName}` : '',
    deps.cardType ? `卡片规格：${deps.cardType}` : '',
    deps.entityType ? `实体类型：${deps.entityType === 'real_person' ? '现实人物' : '虚构角色'}` : '',
    `当前角色卡基线（供保持角色一致性与参考已锁定字段）：\n${JSON.stringify(baseCard, null, 2)}`,
    sourceSnippets ? `参考与考据资料：\n${sourceSnippets}` : '',
    deps.instruction?.trim() ? `用户附加生成要求：${deps.instruction.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await completeStructuredJson(deps.llmPort, {
    slot: deps.llmSlot,
    schema: RoleCardContentSchema,
    schemaHint: '完整的 RoleCardContent JSON 对象',
    temperature: 0.45,
    actionLabel: `一键生成未锁定区块（${unlockedKeys.length} 项）`,
    onStrategyDowngraded: deps.onStrategyDowngraded,
    onProgress: deps.onProgress,
    onReasoningDelta: deps.onReasoningDelta,
    messages: [
      { role: 'system', content: systemLines.join('\n') },
      { role: 'user', content: userParts },
    ],
  });

  if (!result.ok) {
    return result;
  }

  const mergedExtensions: RoleCardContent = {
    ...result.value.data,
    name: current.name,
    extensions: structuredClone(originalExtensions),
  };
  const protectedContent = preserveLockedFields(current, mergedExtensions, locked);

  return ok({
    content: protectedContent,
    regeneratedFields: unlockedKeys,
    skippedLockedFields,
    diffSummary: `一键 AI 生成 (${unlockedKeys.length} 项更新${skippedLockedFields.length > 0 ? `，跳过 ${skippedLockedFields.length} 项锁定` : ''})`,
    tokenCount: estimateCardTokens(protectedContent),
  });
}
