import { z } from 'zod';
import { RoleCardContentSchema, SourceEntrySchema } from './cards.js';

export const SyncScopeSchema = z.enum(['canon', 'meta_reputation', 'both']);
export type SyncScope = z.infer<typeof SyncScopeSchema>;

export const AutoApplyThresholdSchema = z.enum(['manual_review', 'auto_minor']);
export type AutoApplyThreshold = z.infer<typeof AutoApplyThresholdSchema>;

export const UpdateScheduleSchema = z.object({
  enabled: z.boolean().default(false),
  intervalDays: z.number().int().min(1).max(365).default(7),
  syncScope: SyncScopeSchema.default('canon'),
  autoApplyThreshold: AutoApplyThresholdSchema.default('manual_review'),
});
export type UpdateScheduleRequest = z.infer<typeof UpdateScheduleSchema>;

export interface SyncScheduleDto {
  id: string;
  cardId: string;
  enabled: boolean;
  intervalDays: number;
  syncScope: SyncScope;
  autoApplyThreshold: AutoApplyThreshold;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastSourceHash: string | null;
  updatedAt: string;
}

export interface ImpressionEventDto {
  id: string;
  cardId: string;
  characterName: string;
  eventType: string;
  diffSummary: string;
  beforeContent: z.infer<typeof RoleCardContentSchema>;
  afterContent: z.infer<typeof RoleCardContentSchema>;
  sources: z.infer<typeof SourceEntrySchema>[];
  status: 'pending_review' | 'applied' | 'rejected';
  createdAt: string;
  resolvedAt: string | null;
}

export interface RippleProposalDto {
  id: string;
  sourceCardId: string;
  sourceCharacterName: string;
  targetCardId: string;
  targetCharacterName: string;
  lorebookId: string | null;
  hop: number;
  proposedAttitude: string;
  reason: string;
  status: 'pending_review' | 'approved' | 'rejected';
  createdAt: string;
  resolvedAt: string | null;
}

export const ResolveProposalSchema = z.object({
  decision: z.enum(['approve', 'reject']),
});
export type ResolveProposalRequest = z.infer<typeof ResolveProposalSchema>;

export const UpdateMetaSettingsSchema = z.object({
  enableMetaInChat: z.boolean(),
});
export type UpdateMetaSettingsRequest = z.infer<typeof UpdateMetaSettingsSchema>;
