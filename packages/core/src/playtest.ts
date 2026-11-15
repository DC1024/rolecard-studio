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
} from '@rolecard/shared';
import { completeStructuredJson } from './llm/json-repair.js';
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

  const recentText = [
    ...request.history.slice(-4).map((h) => h.content),
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

  const messages: LlmMessage[] = [
    { role: 'system', content: systemParts.join('\n') },
    { role: 'assistant', content: greetingText },
    ...request.history.map((item) => ({
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

export interface RefineCardDeps {
  llmPort: LlmCompletionPort;
  llmSlot: LlmSlotRuntimeConfig;
  lockedFields?: readonly string[];
  onStrategyDowngraded?: (strategy: 'prompt') => void | Promise<void>;
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

  const result = await completeStructuredJson(deps.llmPort, {
    slot: deps.llmSlot,
    schema: RoleCardContentSchema,
    schemaHint: '完整的 RoleCardContent JSON 对象',
    temperature: 0.35,
    onStrategyDowngraded: deps.onStrategyDowngraded,
    messages: [
      {
        role: 'system',
        content: `你是角色卡局部微调专家。请基于现有角色卡 JSON 执行用户的微调指令，仅调整需要修改的字段，保持其余设定完整一致。${lockNotice}`,
      },
      {
        role: 'user',
        content: `现有角色卡 JSON：\n${JSON.stringify(current, null, 2)}\n\n微调指令：${instruction}`,
      },
    ],
  });

  if (!result.ok) {
    return result;
  }

  const protectedContent = preserveLockedFields(current, result.value.data, locked);
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

  const result = await completeStructuredJson(deps.llmPort, {
    slot: deps.llmSlot,
    schema: RoleCardContentSchema,
    schemaHint: '精简后的 RoleCardContent JSON 对象',
    temperature: 0.25,
    onStrategyDowngraded: deps.onStrategyDowngraded,
    messages: [
      {
        role: 'system',
        content: `你是角色卡无损压缩专家。请在不丢失核心人设、口癖、关键人际关系与开场白质感的前提下，去除冗余修饰语，将整卡文本压缩至约 ${targetMaxTokens} Tokens 以内。${lockNotice}`,
      },
      {
        role: 'user',
        content: `待精简角色卡 JSON（当前约 ${beforeTokens} Tokens）：\n${JSON.stringify(current, null, 2)}`,
      },
    ],
  });

  if (!result.ok) {
    return result;
  }

  const protectedContent = preserveLockedFields(current, result.value.data, locked);
  const afterTokens = estimateCardTokens(protectedContent);

  return ok({
    content: protectedContent,
    beforeTokens,
    afterTokens,
    diffSummary: `无损精简 (${beforeTokens} -> ${afterTokens} Tokens)`,
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
};

export interface GenerateCardFieldDeps {
  llmPort: LlmCompletionPort;
  llmSlot: LlmSlotRuntimeConfig;
  workName?: string;
  cardType?: CardType;
  entityType?: EntityType;
  sources?: readonly SourceEntry[];
  instruction?: string;
  customSystemPrompt?: string;
  onStrategyDowngraded?: (strategy: 'prompt') => void | Promise<void>;
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

  const sourceSnippets = (deps.sources ?? [])
    .slice(0, 4)
    .map((s, idx) => `[参考资料 #${idx + 1}] ${s.title}: ${s.snippet.slice(0, 600)}`)
    .join('\n');

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
    onStrategyDowngraded: deps.onStrategyDowngraded,
    messages: [
      { role: 'system', content: systemLines.join('\n') },
      { role: 'user', content: userParts },
    ],
  });

  if (!result.ok) {
    return result;
  }

  const nextContent = structuredClone(current);
  (nextContent as Record<string, unknown>)[field] = result.value.data.value;

  return ok({
    content: nextContent,
    field,
    fieldLabel: meta.label,
    diffSummary: `AI 单区块生成: ${meta.label}`,
    tokenCount: estimateCardTokens(nextContent),
  });
}
