import { z } from 'zod';

export const SyncEventTypeSchema = z.enum([
  'card.updated',
  'card.evolved',
  'lorebook.updated',
  'ripple.approved',
]);
export type SyncEventType = z.infer<typeof SyncEventTypeSchema>;

export const CreateSyncSubscriptionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  webhookUrl: z.string().url().max(1024),
  events: z.array(SyncEventTypeSchema).min(1).default(['card.updated', 'card.evolved']),
});
export type CreateSyncSubscriptionRequest = z.infer<typeof CreateSyncSubscriptionSchema>;

export interface SyncSubscriptionDto {
  id: string;
  name: string;
  webhookUrl: string;
  events: SyncEventType[];
  secretMasked: string;
  isActive: boolean;
  lastCursor: number;
  createdAt: string;
  updatedAt: string;
}

export interface SyncEventDto {
  cursor: number;
  id: string;
  eventType: SyncEventType;
  targetType: 'card' | 'lorebook';
  targetId: string;
  version: number;
  payload: Record<string, unknown>;
  createdAt: string;
}
