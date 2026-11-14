import type {
  ClockPort,
  DnsLookupPort,
  HttpFetchPort,
  LlmCompletionPort,
  SearchProviderPort,
} from '@rolecard/core';
import type { AppDatabase } from './db/client.js';

export interface ServerContext {
  db: AppDatabase;
  masterKey: Buffer;
  dataDir: string;
  deploymentMode: 'local' | 'cloud';
  llmPort?: LlmCompletionPort;
  fetchImpl?: HttpFetchPort;
  dnsLookup?: DnsLookupPort;
  searchProviderPort?: SearchProviderPort;
  clock?: ClockPort;
}

export function getNow(ctx: ServerContext): Date {
  return ctx.clock ? ctx.clock.now() : new Date();
}
