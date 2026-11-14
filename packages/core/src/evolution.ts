import { createHash } from 'node:crypto';
import {
  RoleCardContentSchema,
  type EntityType,
  type RoleCardContent,
  type SearchProvider,
  type SourceEntry,
  type SyncScope,
} from '@rolecard/shared';
import { z } from 'zod';
import { completeStructuredJson } from './llm/json-repair.js';
import { computeCardDiffSummary, preserveLockedFields } from './playtest.js';
import { layeredRetrieve, type RetrievalDeps } from './retrieval.js';
import {
  type CoreError,
  type LlmCompletionPort,
  type LlmSlotRuntimeConfig,
  type Result,
  ok,
} from './types.js';

export const MAX_RIPPLE_HOP = 1;

export function computeSourcesHash(sources: readonly SourceEntry[]): string {
  const normalized = sources
    .map((s) => `${s.origin}|${s.title}|${s.url ?? ''}|${s.snippet}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(normalized).digest('hex');
}

export function computeStaggeredNextRunIso(
  now: Date,
  intervalDays: number,
  cardId: string,
): string {
  const hashBytes = createHash('sha256').update(cardId).digest();
  const jitterMinutes = ((hashBytes[0] ?? 0) * 256 + (hashBytes[1] ?? 0)) % 720;
  const nextMs =
    now.getTime() +
    intervalDays * 24 * 60 * 60 * 1000 +
    jitterMinutes * 60 * 1000;
  return new Date(nextMs).toISOString();
}

const EvolutionLlmOutputSchema = z.object({
  content: RoleCardContentSchema,
  metaSummary: z.string().max(600).nullable().optional().default(null),
  changeReason: z.string().max(400).optional().default('根据最新资料更新设定'),
});

export interface EvolveCardInput {
  cardId: string;
  characterName: string;
  workName: string;
  entityType: EntityType;
  currentContent: RoleCardContent;
  lockedFields: readonly string[];
  syncScope: SyncScope;
  lastSourceHash?: string | null;
}

export interface EvolveCardDeps extends RetrievalDeps {
  llmPort: LlmCompletionPort;
  llmSlot: LlmSlotRuntimeConfig;
  enableLayer1Wiki?: boolean;
  searchProvider?: SearchProvider;
  searchApiKey?: string;
}

export type EvolveCardOutcome =
  | {
      skipped: true;
      reason: 'SOURCE_HASH_UNCHANGED' | 'NO_NEW_SOURCES';
      sourceHash: string;
    }
  | {
      skipped: false;
      sourceHash: string;
      updatedContent: RoleCardContent;
      diffSummary: string;
      metaSummary: string | null;
      sources: SourceEntry[];
      changeReason: string;
    };

export async function evolveRoleCard(
  input: EvolveCardInput,
  deps: EvolveCardDeps,
): Promise<Result<EvolveCardOutcome, CoreError>> {
  const retrieval = await layeredRetrieve(
    {
      characterName: input.characterName,
      workName: input.workName,
      enableLayer1Wiki: deps.enableLayer1Wiki ?? true,
      searchProvider: deps.searchProvider ?? 'none',
      searchApiKey: deps.searchApiKey,
    },
    deps,
  );

  if (retrieval.sources.length === 0) {
    return ok({
      skipped: true,
      reason: 'NO_NEW_SOURCES',
      sourceHash: input.lastSourceHash ?? '',
    });
  }

  const nextHash = computeSourcesHash(retrieval.sources);
  if (input.lastSourceHash && input.lastSourceHash === nextHash) {
    return ok({
      skipped: true,
      reason: 'SOURCE_HASH_UNCHANGED',
      sourceHash: nextHash,
    });
  }

  // Hard compliance barrier: real_person cards never collect or inject meta_reputation
  const effectiveScope: SyncScope =
    input.entityType === 'real_person' ? 'canon' : input.syncScope;

  const lockNote =
    input.lockedFields.length > 0
      ? `以下字段已被用户锁定，严禁更改：${input.lockedFields.join(', ')}。`
      : '';

  const scopeNote =
    effectiveScope === 'canon'
      ? '仅更新正典设定（canon），metaSummary 必须返回 null。'
      : '可同时整理社群风评/二创热梗放入独立的 metaSummary（最多300字），绝不能混入正典性格/背景字段中。';

  const llmRes = await completeStructuredJson(deps.llmPort, {
    slot: deps.llmSlot,
    schema: EvolutionLlmOutputSchema,
    schemaHint: '{ content: RoleCardContent, metaSummary: string | null, changeReason: string }',
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: `你是 RoleCard Studio 角色演化维护引擎。请依据最新检索资料对比现有角色卡，生成克制、高保真的增量更新。${lockNote}${scopeNote}`,
      },
      {
        role: 'user',
        content: [
          `角色：${input.characterName}（${input.workName || '原创'}）`,
          `现有角色卡：\n${JSON.stringify(input.currentContent, null, 2)}`,
          `最新检索依据：\n${retrieval.sources.map((s, i) => `[${i + 1}] ${s.title}: ${s.snippet}`).join('\n')}`,
        ].join('\n\n'),
      },
    ],
  });

  if (!llmRes.ok) {
    return llmRes;
  }

  const protectedContent = preserveLockedFields(
    input.currentContent,
    llmRes.value.data.content,
    input.lockedFields,
  );
  const diffSummary = computeCardDiffSummary(input.currentContent, protectedContent);

  const safeMetaSummary =
    input.entityType === 'real_person' || effectiveScope === 'canon'
      ? null
      : (llmRes.value.data.metaSummary ?? null);

  return ok({
    skipped: false,
    sourceHash: nextHash,
    updatedContent: protectedContent,
    diffSummary,
    metaSummary: safeMetaSummary,
    sources: retrieval.sources,
    changeReason: llmRes.value.data.changeReason,
  });
}

export interface RippleNeighborInput {
  targetCardId: string;
  targetCharacterName: string;
  lorebookId: string | null;
  relationRole: string;
}

export interface GeneratedRippleProposal {
  sourceCardId: string;
  targetCardId: string;
  lorebookId: string | null;
  hop: number;
  proposedAttitude: string;
  reason: string;
}

/**
 * Generates strictly 1-hop ripple proposals (max_hop = 1) for directly linked
 * neighbors in shared Lorebooks without cascading to hop >= 2.
 */
export function generateSingleHopRippleProposals(
  sourceCardId: string,
  sourceCharacterName: string,
  sourceDiffSummary: string,
  neighbors: readonly RippleNeighborInput[],
): GeneratedRippleProposal[] {
  const seenTargets = new Set<string>();
  const proposals: GeneratedRippleProposal[] = [];

  for (const neighbor of neighbors) {
    if (neighbor.targetCardId === sourceCardId) continue;
    if (seenTargets.has(neighbor.targetCardId)) continue;
    seenTargets.add(neighbor.targetCardId);

    proposals.push({
      sourceCardId,
      targetCardId: neighbor.targetCardId,
      lorebookId: neighbor.lorebookId,
      hop: MAX_RIPPLE_HOP,
      proposedAttitude: `因「${sourceCharacterName}」近期设定演化（${sourceDiffSummary}），建议微调对其关注度与互动态度。`,
      reason: `同处关联世界书（角色定位：${neighbor.relationRole}），触发 1-hop 关系涟漪检视。`,
    });
  }

  return proposals;
}
