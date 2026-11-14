import {
  estimateCardTokens,
  RoleCardContentSchema,
  type HitLorebookDebugItem,
  type LorebookEntry,
  type PlaytestRequest,
  type PlaytestResponse,
  type RoleCardContent,
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
