import type {
  ClockPort,
  DnsLookupPort,
  HttpFetchPort,
  LlmCompletionPort,
  SearchProviderPort,
  SmtpTransportPort,
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
  smtpTransport?: SmtpTransportPort;
  clock?: ClockPort;
  env?: Record<string, string | undefined>;
  webDistDir?: string;
  pluginsDir?: string;
  memoryUploads?: Map<string, { data: Buffer; contentType: string }>;
}

export function getNow(ctx: ServerContext): Date {
  return ctx.clock ? ctx.clock.now() : new Date();
}
