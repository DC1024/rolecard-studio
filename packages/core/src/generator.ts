import {
  estimateCardTokens,
  RoleCardContentSchema,
  type GenerateCardRequest,
  type RoleCardContent,
  type SearchProvider,
  type SourceEntry,
} from '@rolecard/shared';
import { completeStructuredJson } from './llm/json-repair.js';
import { applyTrpgPresetFields } from './lorebook.js';
import {
  clipToTokenBudget,
  fetchUserReferenceUrl,
  layeredRetrieve,
  type RetrievalDeps,
} from './retrieval.js';
import {
  type CoreError,
  type LlmCompletionPort,
  type LlmMessage,
  type LlmSlotRuntimeConfig,
  type Result,
  err,
  ok,
} from './types.js';

export interface GenerateCardDeps extends RetrievalDeps {
  llmPort: LlmCompletionPort;
  llmSlot: LlmSlotRuntimeConfig;
  enableLayer1Wiki?: boolean;
  searchProvider?: SearchProvider;
  searchApiKey?: string;
  customSystemPrompt?: string;
  onStrategyDowngraded?: (strategy: 'prompt') => void | Promise<void>;
}

export interface GeneratedCardOutput {
  content: RoleCardContent;
  sources: SourceEntry[];
  tokenCount: number;
  effectiveJsonStrategy: 'json_object' | 'prompt';
  attempts: number;
  temperature: number;
}

const ROLE_CARD_SCHEMA_HINT = `{
  "name": "角色名称",
  "summary": "一句话高概念定位",
  "personality": "性格特征与行为准则",
  "appearance": "外貌、服饰与特征",
  "background": "背景故事与经历",
  "speech_style": { "tone": "语调", "catchphrases": ["口癖1"], "habits": ["语言习惯1"] },
  "relationships": [{ "target": "关联角色", "relation": "关系", "attitude": "态度" }],
  "first_mes": "默认开场白",
  "alternate_greetings": ["备选开场白"],
  "mes_example": "<START>\\n{{user}}: ...\\n{{char}}: ...",
  "system_prompt": "角色扮演系统提示词",
  "scenario": "当前场景设定",
  "creator_notes": "创作与溯源备注",
  "tags": ["标签1"],
  "extensions": {}
}`;

export async function generateRoleCard(
  input: GenerateCardRequest,
  deps: GenerateCardDeps,
): Promise<Result<GeneratedCardOutput, CoreError>> {
  const userSources: SourceEntry[] = [];
  const retrievalSources: SourceEntry[] = [];

  // 1. Collect Mode A / Mode C user-provided material
  if (input.mode === 'A' || input.mode === 'C') {
    if (input.referenceText.trim()) {
      userSources.push({
        title: `${input.characterName} 用户提供设定文本`,
        snippet: clipToTokenBudget(input.referenceText.trim(), 3000),
        origin: 'user_provided',
        provider: 'user_text',
      });
    }

    if (input.visionDescription.trim()) {
      userSources.push({
        title: `${input.characterName} 立绘 Vision 反推`,
        snippet: clipToTokenBudget(input.visionDescription.trim(), 1200),
        origin: 'user_provided',
        provider: 'vision',
      });
    }

    for (const refUrl of input.referenceUrls) {
      const urlRes = await fetchUserReferenceUrl(refUrl, deps);
      if (!urlRes.ok) {
        return err({
          code: 'REFERENCE_URL_FETCH_FAILED',
          message: urlRes.message,
          status: 400,
        });
      }
      userSources.push(urlRes.source);
    }
  }

  // Validate Mode A material presence
  if (input.mode === 'A' && userSources.length === 0) {
    return err({
      code: 'NO_REFERENCE_MATERIAL',
      message: '模式 A（参考资料生成）要求至少提供文本设定、参考 URL 或立绘描述之一，严禁无源纯编造',
      status: 400,
    });
  }

  // Validate Mode C user material presence
  if (input.mode === 'C' && userSources.length === 0) {
    return err({
      code: 'MODE_C_REQUIRES_USER_MATERIAL',
      message: '模式 C（A+B 混合）需同时保留用户提供的参考资料，请先输入设定文本/URL 或切换为模式 B',
      status: 400,
    });
  }

  // 2. Run retrieval for Mode B, Mode C, or Mode A with supplement search
  const shouldRetrieve =
    input.mode === 'B' ||
    input.mode === 'C' ||
    (input.mode === 'A' && input.enableSupplementSearch);

  if (shouldRetrieve) {
    const retrieved = await layeredRetrieve(
      {
        characterName: input.characterName,
        workName: input.workName,
        enableLayer1Wiki: deps.enableLayer1Wiki,
        searchProvider: deps.searchProvider,
        searchApiKey: deps.searchApiKey,
        deepSearch: input.mode === 'B' || input.mode === 'C',
      },
      deps,
    );
    retrievalSources.push(...retrieved.sources);
  }

  // Hard gate for Mode B: zero retrieval results -> MUST block, never hallucinate
  if (input.mode === 'B' && retrievalSources.length === 0) {
    return err({
      code: 'NO_RETRIEVAL_RESULTS',
      message:
        '未检索到该角色的公开百科或网页依据。为防止纯幻觉编造，已拦截生成；请补充作品名、粘贴参考 URL 或切换模式 A。',
      status: 422,
    });
  }

  // Hard gate for Mode C: must have both user material and retrieval supplement per SPEC 1.3
  if (input.mode === 'C' && retrievalSources.length === 0) {
    return err({
      code: 'MODE_C_NO_RETRIEVAL_RESULTS',
      message:
        '模式 C 需结合联网检索资料补全设定，但当前未检索到公开依据；请补充作品名或改用模式 A（纯用户资料生成）。',
      status: 422,
    });
  }

  const allSources: SourceEntry[] = [...userSources, ...retrievalSources];
  const temperature = input.mode === 'A' ? 0.55 : input.mode === 'B' ? 0.25 : 0.4;

  const messages = buildGenerationMessages(input, userSources, retrievalSources, deps.customSystemPrompt);
  const completionResult = await completeStructuredJson(deps.llmPort, {
    slot: deps.llmSlot,
    messages,
    schema: RoleCardContentSchema,
    schemaHint: ROLE_CARD_SCHEMA_HINT,
    temperature,
    onStrategyDowngraded: deps.onStrategyDowngraded,
  });

  if (!completionResult.ok) {
    return completionResult;
  }

  const cardContent: RoleCardContent = applyTrpgPresetFields(input.cardType, {
    ...completionResult.value.data,
    tags: mergeCardTags(input.tags, completionResult.value.data.tags),
  });

  return ok({
    content: cardContent,
    sources: allSources,
    tokenCount: estimateCardTokens(cardContent),
    effectiveJsonStrategy: completionResult.value.effectiveStrategy,
    attempts: completionResult.value.attempts,
    temperature,
  });
}

function mergeCardTags(requested: string[], generated: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const tag of [...requested, ...generated]) {
    const clean = tag.trim();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      merged.push(clean);
    }
  }
  return merged.slice(0, 20);
}

function buildGenerationMessages(
  input: GenerateCardRequest,
  userSources: SourceEntry[],
  retrievalSources: SourceEntry[],
  customSystemPrompt?: string,
): LlmMessage[] {
  const systemLines = [
    '你是 RoleCard Studio 专业角色卡架构师。你必须严格依据提供的参考资料提炼结构化角色卡，严禁捏造未提供的核心事实。',
    `目标卡片规格: ${input.cardType}；实体类型: ${input.entityType === 'real_person' ? '现实人物（保持客观中立）' : '虚构角色'}。`,
  ];

  if (input.mode === 'C') {
    systemLines.push(
      '当前为【模式 C：A+B 混合考据模式】！裁决铁律：',
      '1. [用户提供] 材料为第一优先级权威基线，当 [检索补充] 与之冲突时，必须无条件以 [用户提供] 为准；',
      '2. 仅使用 [检索补充] 增量填补用户未提及的世界观背景、时间线、关系称谓与口癖细节；',
      '3. 在 creator_notes 中清晰标注哪些核心设定源自 [用户提供]、哪些源自 [检索补充]。',
    );
  } else if (input.mode === 'B') {
    systemLines.push(
      '当前为【模式 B：纯联网考据模式】，所有设定必须忠实于以下 [检索补充] 原文依据，保持角色性格与台词还原度。',
    );
  } else {
    systemLines.push(
      '当前为【模式 A：参考资料精准提炼模式】，忠实保留用户提供设定文本中的细粒度口癖、人设与剧情细节。',
    );
  }

  if (customSystemPrompt?.trim()) {
    systemLines.push(`附加系统要求：${customSystemPrompt.trim()}`);
  }

  const materialBlocks: string[] = [];
  if (userSources.length > 0) {
    materialBlocks.push(
      '=== [用户提供] 第一优先级参考材料 ===',
      ...userSources.map((s, idx) => `[用户提供 #${idx + 1}] ${s.title}\n${s.snippet}`),
    );
  }
  if (retrievalSources.length > 0) {
    materialBlocks.push(
      '=== [检索补充] 百科与网页考据资料 ===',
      ...retrievalSources.map(
        (s, idx) =>
          `[检索补充 #${idx + 1}] ${s.title}${s.url ? ` (${s.url})` : ''}\n${s.snippet}`,
      ),
    );
  }

  const userPrompt = [
    `请为角色「${input.characterName}」${input.workName ? `（所属作品/世界观：${input.workName}）` : ''} 生成结构化角色卡 JSON。`,
    input.customPrompt.trim() ? `用户额外创作指令：${input.customPrompt.trim()}` : '',
    '',
    ...materialBlocks,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: systemLines.join('\n') },
    { role: 'user', content: userPrompt },
  ];
}
