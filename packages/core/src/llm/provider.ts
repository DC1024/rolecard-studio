import { LLM_PROVIDER_DEFAULTS, type LlmProvider } from '@rolecard/shared';

export function resolveProviderBaseUrl(provider: LlmProvider, customBaseUrl?: string): string {
  const trimmed = customBaseUrl?.trim() ?? '';
  if (trimmed) {
    return trimmed.replace(/\/+$/, '');
  }
  return LLM_PROVIDER_DEFAULTS[provider].baseUrl.replace(/\/+$/, '');
}
