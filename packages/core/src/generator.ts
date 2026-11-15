import { z } from 'zod';
import {
  estimateCardTokens,
  RoleCardContentSchema,
  type CardType,
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
  onProgress?: (event: { step: string; message: string }) => void | Promise<void>;
  onReasoningDelta?: (delta: string) => void | Promise<void>;
}

export interface GeneratedCardOutput {
  content: RoleCardContent;
  sources: SourceEntry[];
  tokenCount: number;
  effectiveJsonStrategy: 'json_object' | 'prompt';
  attempts: number;
  temperature: number;
}

function buildSchemaHintForCardType(cardType: CardType): string {
  const trpgSnippet =
    cardType === 'trpg_coc7'
      ? `{
    "trpg": {
      "system": "Call of Cthulhu 7e",
      "occupation": "结合设定推断的调查员职业",
      "era": "所属时代背景",
      "characteristics": { "STR": 50, "CON": 60, "SIZ": 55, "DEX": 70, "APP": 65, "INT": 80, "POW": 75, "EDU": 75 },
      "derived": { "HP": 11, "MP": 15, "SAN": 75, "Luck": 60, "Move": 8, "DB": "0", "Build": 0 },
      "keySkills": ["核心技能1 75%", "核心技能2 70%", "核心技能3 65%", "核心技能4 60%", "核心技能5 55%", "核心技能6 50%"],
      "backstory": { "ideologyBeliefs": "信念与信条", "significantPeople": "重要之人", "treasuredPossessions": "珍视之物" }
    }
  }`
      : cardType === 'trpg_dnd5e'
        ? `{
    "trpg": {
      "system": "D&D 5e",
      "race": "种族",
      "className": "职业与子职（如：魔剑士 / 游侠）",
      "background": "背景",
      "alignment": "九宫格阵营（如：守序善良）",
      "level": 5,
      "abilityScores": { "STR": 12, "DEX": 16, "CON": 14, "INT": 14, "WIS": 13, "CHA": 12 },
      "combat": { "AC": 16, "MaxHP": 38, "HitDice": "5d8", "Speed": "30 ft", "Initiative": 3, "ProficiencyBonus": 3 },
      "savingThrows": ["敏捷", "智力"],
      "proficiencies": ["察觉", "奥秘", "体操", "调查"],
      "featuresAndTraits": ["代表性职业特性或战技1", "特性2"]
    }
  }`
        : `{}`;

  return `{
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
  "extensions": ${trpgSnippet}
}`;
}

function describeCardTypeSpec(cardType: CardType): string[] {
  switch (cardType) {
    case 'trpg_coc7':
      return [
        '当前卡片规格为【TRPG · Call of Cthulhu 7e 调查员车卡】：',
        '1. 必须在 extensions.trpg 中根据该角色的体格、战斗力、智力、意志、学识与特长，推演真实的 CoC 7e 属性（characteristics 各项为 15~90 的 5 的倍数，禁止照抄示例数字），并正确计算衍生值（HP=floor((CON+SIZ)/10), MP=floor(POW/5), SAN=POW）；',
        '2. keySkills 必须结合角色能力列出 6~8 项具体技能和百分率（如“格斗(斗殴) 70%”“神秘学 75%”）；',
        '3. system_prompt 与 scenario 应兼顾跑团代入感与守秘人（KP）参考。',
      ];
    case 'trpg_dnd5e':
      return [
        '当前卡片规格为【TRPG · D&D 5e 冒险者车卡】：',
        '1. 必须在 extensions.trpg 中根据该角色的战斗风格、体质、灵巧、学识、感知与魅力，推演真实的 D&D 5e 六维属性（abilityScores 3~20，禁止照抄示例数字）、合理的种族/职业/阵营/等级及 AC/MaxHP/HitDice；',
        '2. proficiencies 与 featuresAndTraits 必须贴合角色的标志性技能、法术或武器特长；',
        '3. 保持角色背景、阵营与战斗特征的一致性，可直接导出至 Foundry VTT 导入使用。',
      ];
    case 'general':
      return [
        '当前卡片规格为【通用角色设定档案】：',
        '1. 侧重清晰、客观、结构化的人物档案（核心定位、性格动机、经历脉络、能力与弱点、人际网络）；',
        '2. 保持设定严谨精炼，适用于小说创作、游戏策划、设定集归档等多种用途。',
      ];
    case 'sillytavern_v3':
    default:
      return [
        '当前卡片规格为【SillyTavern AI 角色扮演卡 (CCV3)】：',
        '1. 强化沉浸式互动体验：first_mes 需具备鲜活的动作描写与对话钩子；alternate_greetings 提供 2~3 种不同切入情境；',
        '2. mes_example 需使用标准 <START> / {{user}} / {{char}} 对话格式高度还原角色口癖与思维习惯；',
        '3. system_prompt 需明确角色的语音语调、行为准则与防 OOC（不跳戏）边界。',
      ];
  }
}

export async function generateRoleCard(
  input: GenerateCardRequest,
  deps: GenerateCardDeps,
): Promise<Result<GeneratedCardOutput, CoreError>> {
  const userSources: SourceEntry[] = [];
  const retrievalSources: SourceEntry[] = [];

  // 1. Collect Mode A / Mode C user-provided material
  await deps.onProgress?.({
    step: 'preparing',
    message: '正在整理用户设定材料与参考链接...',
  });
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
    await deps.onProgress?.({
      step: 'retrieving',
      message: `正在考据公开百科与联网来源（${input.characterName}${input.workName ? ` · ${input.workName}` : ''}）...`,
    });
    const retrieved = await layeredRetrieve(
      {
        characterName: input.characterName,
        workName: input.workName,
        enableLayer1Wiki: deps.enableLayer1Wiki,
        searchProvider: deps.searchProvider,
        searchApiKey: deps.searchApiKey,
        deepSearch: input.mode === 'B' || input.mode === 'C',
        onSiteChecked: async (site, hit) => {
          await deps.onProgress?.({
            step: 'retrieving',
            message: hit
              ? `已命中 ${site.label}：${hit.title}`
              : `已检视 ${site.label}（暂无匹配条目）`,
          });
        },
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
  await deps.onProgress?.({
    step: 'building_prompt',
    message: `已汇总 ${allSources.length} 条参考来源，正在组装结构化角色卡提示词...`,
  });
  const temperature = input.mode === 'A' ? 0.55 : input.mode === 'B' ? 0.25 : 0.4;

  const messages = buildGenerationMessages(input, userSources, retrievalSources, deps.customSystemPrompt);
  const completionResult = await completeStructuredJson(deps.llmPort, {
    slot: deps.llmSlot,
    messages,
    schema: RoleCardContentSchema,
    schemaHint: buildSchemaHintForCardType(input.cardType),
    temperature,
    onStrategyDowngraded: deps.onStrategyDowngraded,
    onProgress: deps.onProgress,
    onReasoningDelta: deps.onReasoningDelta,
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
    ...describeCardTypeSpec(input.cardType),
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

const TrpgOnlySchema = z.object({
  trpg: z.record(z.unknown()),
});

export async function generateTrpgAttributesForCard(
  content: RoleCardContent,
  system: 'coc7e' | 'dnd5e',
  deps: {
    llmPort: LlmCompletionPort;
    llmSlot: LlmSlotRuntimeConfig;
    onStrategyDowngraded?: (strategy: 'prompt') => void | Promise<void>;
  },
): Promise<Result<{ cardType: CardType; content: RoleCardContent }, CoreError>> {
  const targetCardType: CardType = system === 'coc7e' ? 'trpg_coc7' : 'trpg_dnd5e';
  const systemPrompt = [
    '你是资深 TRPG 规则构筑师。请根据下方角色设定，生成贴合该角色背景、性格、体格与能力的真实 TRPG 车卡数据，严禁照抄默认模板数字。',
    ...describeCardTypeSpec(targetCardType),
    '你必须只返回 JSON 对象：{"trpg": { ... }}',
  ].join('\n');

  const schemaHint =
    system === 'coc7e'
      ? `{
  "trpg": {
    "system": "Call of Cthulhu 7e",
    "occupation": "调查员职业",
    "era": "所属时代",
    "characteristics": { "STR": 50, "CON": 60, "SIZ": 55, "DEX": 70, "APP": 65, "INT": 80, "POW": 75, "EDU": 75 },
    "derived": { "HP": 11, "MP": 15, "SAN": 75, "Luck": 60, "Move": 8, "DB": "0", "Build": 0 },
    "keySkills": ["核心技能1 75%", "核心技能2 70%", "核心技能3 65%"],
    "backstory": { "ideologyBeliefs": "...", "significantPeople": "...", "treasuredPossessions": "..." }
  }
}`
      : `{
  "trpg": {
    "system": "D&D 5e",
    "race": "种族",
    "className": "职业与子职",
    "background": "背景",
    "alignment": "阵营",
    "level": 5,
    "abilityScores": { "STR": 12, "DEX": 16, "CON": 14, "INT": 14, "WIS": 13, "CHA": 12 },
    "combat": { "AC": 16, "MaxHP": 38, "HitDice": "5d8", "Speed": "30 ft", "Initiative": 3, "ProficiencyBonus": 3 },
    "savingThrows": ["敏捷", "智力"],
    "proficiencies": ["察觉", "奥秘", "体操"],
    "featuresAndTraits": ["代表性职业特性或战技"]
  }
}`;

  const userPrompt = [
    `角色名称：${content.name}`,
    `一句话定位：${content.summary}`,
    `性格特征：${content.personality}`,
    content.appearance ? `外貌特征：${content.appearance}` : '',
    content.background ? `背景故事：${content.background}` : '',
    content.tags.length > 0 ? `标签：${content.tags.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const completion = await completeStructuredJson(deps.llmPort, {
    slot: deps.llmSlot,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    schema: TrpgOnlySchema,
    schemaHint,
    temperature: 0.3,
    onStrategyDowngraded: deps.onStrategyDowngraded,
  });

  if (!completion.ok) {
    return completion;
  }

  const nextContent = applyTrpgPresetFields(targetCardType, {
    ...content,
    extensions: {
      ...content.extensions,
      trpg: completion.value.data.trpg,
    },
  });

  return ok({
    cardType: targetCardType,
    content: nextContent,
  });
}
