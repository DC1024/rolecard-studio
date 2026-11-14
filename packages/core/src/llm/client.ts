import { LLM_PROVIDER_DEFAULTS, type LlmProvider } from '@rolecard/shared';
import type {
  HttpFetchPort,
  LlmCompletionPort,
  LlmCompletionRequest,
  LlmCompletionResponse,
} from '../types.js';

export function resolveProviderBaseUrl(provider: LlmProvider, customBaseUrl?: string): string {
  const trimmed = customBaseUrl?.trim() ?? '';
  if (trimmed) {
    return trimmed.replace(/\/+$/, '');
  }
  return LLM_PROVIDER_DEFAULTS[provider].baseUrl.replace(/\/+$/, '');
}

export function createOpenAiCompatibleLlmPort(
  fetchImpl: HttpFetchPort = fetch,
  timeoutMs = 60_000,
): LlmCompletionPort {
  return async (request: LlmCompletionRequest): Promise<LlmCompletionResponse> => {
    const baseUrl = resolveProviderBaseUrl(request.provider, request.baseUrl);
    if (!baseUrl) {
      return {
        content: '',
        status: 400,
        rawError: `提供商 ${request.provider} 缺少 Base URL`,
      };
    }

    const endpoint = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
    };
    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }
    if (request.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (request.apiKey.trim()) {
      headers.Authorization = `Bearer ${request.apiKey.trim()}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const rawText = await response.text();
      if (!response.ok) {
        const lower = rawText.toLowerCase();
        const jsonRejected =
          response.status === 400 &&
          (lower.includes('response_format') || lower.includes('json_object'));
        return {
          content: '',
          status: response.status,
          rawError: rawText.slice(0, 500),
          supportsJsonObjectRejected: jsonRejected,
        };
      }

      const parsed = JSON.parse(rawText) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = parsed.choices?.[0]?.message?.content ?? '';
      return {
        content,
        status: response.status,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.name === 'AbortError'
            ? `请求超时 (${timeoutMs}ms)`
            : error.message
          : '网络请求异常';
      return {
        content: '',
        status: 502,
        rawError: message,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function testLlmConnectivity(
  params: {
    provider: LlmProvider;
    apiKey: string;
    baseUrl?: string;
    model: string;
  },
  fetchImpl: HttpFetchPort = fetch,
): Promise<{
  ok: boolean;
  latencyMs: number;
  replyPreview?: string;
  error?: string;
}> {
  const startedAt = Date.now();
  const port = createOpenAiCompatibleLlmPort(fetchImpl, 15_000);
  const baseUrl = resolveProviderBaseUrl(params.provider, params.baseUrl);
  const res = await port({
    provider: params.provider,
    apiKey: params.apiKey,
    baseUrl,
    model: params.model,
    messages: [{ role: 'user', content: 'Reply with OK only.' }],
    temperature: 0,
    maxTokens: 16,
    jsonMode: false,
  });
  const latencyMs = Date.now() - startedAt;

  if (res.status >= 400 || !res.content.trim()) {
    return {
      ok: false,
      latencyMs,
      error: res.rawError || `HTTP ${res.status}`,
    };
  }

  return {
    ok: true,
    latencyMs,
    replyPreview: res.content.trim().slice(0, 60),
  };
}
