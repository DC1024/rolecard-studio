import type { JsonModeStrategy, LlmProvider, SearchProvider, SourceEntry } from '@rolecard/shared';

export interface CoreError {
  code: string;
  message: string;
  status: number;
  details?: unknown;
}

export type Result<T, E = CoreError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E = CoreError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export interface DnsAddressRecord {
  address: string;
  family: 4 | 6;
}

export type DnsLookupPort = (hostname: string) => Promise<DnsAddressRecord[]>;

export type HttpFetchPort = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export interface ClockPort {
  now(): Date;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionRequest {
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: LlmMessage[];
  temperature: number;
  maxTokens?: number;
  jsonMode: boolean;
}

export interface LlmCompletionResponse {
  content: string;
  status: number;
  rawError?: string;
  supportsJsonObjectRejected?: boolean;
}

export interface LlmSlotRuntimeConfig {
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  jsonModeStrategy: JsonModeStrategy;
}

export type LlmCompletionPort = (
  request: LlmCompletionRequest,
) => Promise<LlmCompletionResponse>;

export interface SearchQueryInput {
  query: string;
  limit: number;
  provider: SearchProvider;
  apiKey: string;
}

export type SearchProviderPort = (
  input: SearchQueryInput,
) => Promise<SourceEntry[]>;
