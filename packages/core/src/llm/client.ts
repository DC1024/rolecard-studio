import { LLM_PROVIDER_DEFAULTS, type LlmProvider, type LlmSlotPurpose } from '@rolecard/shared';
import type {
  HttpFetchPort,
  LlmCompletionPort,
  LlmCompletionRequest,
  LlmCompletionResponse,
} from '../types.js';
import { validateModelSlotCapability } from './capabilities.js';

const PROBE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAJklEQVR4nO3NMQ0AAAwDoPo33arYsQQMkB6LQCAQCAQCgUAg+BIMi1X0pjxKe0gAAAAASUVORK5CYII=';

export function resolveProviderBaseUrl(provider: LlmProvider, customBaseUrl?: string): string {
  const trimmed = customBaseUrl?.trim() ?? '';
  if (trimmed) {
    return trimmed.replace(/\/+$/, '');
  }
  return LLM_PROVIDER_DEFAULTS[provider].baseUrl.replace(/\/+$/, '');
}

/**
 * Extract inline `<think>...</think>` blocks from non-streaming content.
 */
export function splitThinkTags(raw: string): { content: string; reasoning: string } {
  const thinkChunks: string[] = [];
  const cleaned = raw.replace(/<think>([\s\S]*?)<\/think>/gi, (_full, inner: string) => {
    if (inner.trim()) {
      thinkChunks.push(inner.trim());
    }
    return '';
  });
  return {
    content: cleaned.trim(),
    reasoning: thinkChunks.join('\n').trim(),
  };
}

class ThinkTagStreamSplitter {
  private inThink = false;
  private carry = '';

  async feed(
    chunk: string,
    emitReasoning: (delta: string) => Promise<void>,
    emitContent: (delta: string) => Promise<void>,
  ): Promise<void> {
    let text = this.carry + chunk;
    this.carry = '';

    while (text.length > 0) {
      if (!this.inThink) {
        const openIdx = text.indexOf('<think>');
        if (openIdx !== -1) {
          const before = text.slice(0, openIdx);
          if (before) await emitContent(before);
          this.inThink = true;
          text = text.slice(openIdx + '<think>'.length);
          continue;
        }
        // Hold trailing partial `<think` prefix across chunk boundaries
        const partialIdx = findPartialTagPrefix(text, '<think>');
        if (partialIdx !== -1) {
          const safe = text.slice(0, partialIdx);
          if (safe) await emitContent(safe);
          this.carry = text.slice(partialIdx);
          return;
        }
        await emitContent(text);
        return;
      }

      const closeIdx = text.indexOf('</think>');
      if (closeIdx !== -1) {
        const thought = text.slice(0, closeIdx);
        if (thought) await emitReasoning(thought);
        this.inThink = false;
        text = text.slice(closeIdx + '</think>'.length);
        continue;
      }
      const partialIdx = findPartialTagPrefix(text, '</think>');
      if (partialIdx !== -1) {
        const safe = text.slice(0, partialIdx);
        if (safe) await emitReasoning(safe);
        this.carry = text.slice(partialIdx);
        return;
      }
      await emitReasoning(text);
      return;
    }
  }

  async flush(
    emitReasoning: (delta: string) => Promise<void>,
    emitContent: (delta: string) => Promise<void>,
  ): Promise<void> {
    if (!this.carry) return;
    const leftover = this.carry;
    this.carry = '';
    if (this.inThink) {
      await emitReasoning(leftover);
    } else {
      await emitContent(leftover);
    }
  }
}

function findPartialTagPrefix(text: string, tag: string): number {
  const maxCheck = Math.min(text.length, tag.length - 1);
  for (let len = maxCheck; len >= 1; len -= 1) {
    if (text.endsWith(tag.slice(0, len))) {
      return text.length - len;
    }
  }
  return -1;
}

export function createOpenAiCompatibleLlmPort(
  fetchImpl: HttpFetchPort = fetch,
  timeoutMs = 90_000,
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

    const wantsStream = Boolean(request.onReasoningDelta || request.onContentDelta);
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
    if (wantsStream) {
      body.stream = true;
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

      if (!response.ok) {
        const rawText = await response.text();
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

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (wantsStream && contentType.includes('text/event-stream') && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const splitter = new ThinkTagStreamSplitter();
        let buffer = '';
        let contentOut = '';
        let reasoningOut = '';

        const emitReasoning = async (delta: string) => {
          reasoningOut += delta;
          if (request.onReasoningDelta) {
            await request.onReasoningDelta(delta);
          }
        };
        const emitContent = async (delta: string) => {
          contentOut += delta;
          if (request.onContentDelta) {
            await request.onContentDelta(delta);
          }
        };

        const processLine = async (line: string) => {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) return;
          const dataStr = trimmed.slice(5).trim();
          if (!dataStr || dataStr === '[DONE]') return;
          try {
            const chunk = JSON.parse(dataStr) as {
              choices?: Array<{
                delta?: {
                  content?: string | null;
                  reasoning_content?: string | null;
                  reasoning?: string | null;
                };
              }>;
            };
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) return;
            const rDelta = delta.reasoning_content ?? delta.reasoning;
            if (typeof rDelta === 'string' && rDelta.length > 0) {
              await emitReasoning(rDelta);
            }
            if (typeof delta.content === 'string' && delta.content.length > 0) {
              await splitter.feed(delta.content, emitReasoning, emitContent);
            }
          } catch {
            // ignore malformed keepalive chunk
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            await processLine(line);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) {
          await processLine(buffer);
        }
        await splitter.flush(emitReasoning, emitContent);

        return {
          content: contentOut,
          reasoning: reasoningOut || undefined,
          status: response.status,
        };
      }

      const rawText = await response.text();
      const parsed = JSON.parse(rawText) as {
        choices?: Array<{
          message?: {
            content?: string;
            reasoning_content?: string;
            reasoning?: string;
          };
        }>;
      };
      const message = parsed.choices?.[0]?.message;
      const rawContent = message?.content ?? '';
      const rawReasoning = message?.reasoning_content ?? message?.reasoning ?? '';
      const split = splitThinkTags(rawContent);
      const combinedReasoning = [rawReasoning.trim(), split.reasoning].filter(Boolean).join('\n');

      if (combinedReasoning && request.onReasoningDelta) {
        await request.onReasoningDelta(combinedReasoning);
      }
      if (split.content && request.onContentDelta) {
        await request.onContentDelta(split.content);
      }

      return {
        content: split.content,
        reasoning: combinedReasoning || undefined,
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

function enrichEndpointError(rawError: string, slotType: LlmSlotPurpose, model: string): string {
  const lower = rawError.toLowerCase();
  if (
    slotType !== 'image' &&
    (lower.includes('not a chat model') ||
      lower.includes('image generation') ||
      lower.includes('only supports images') ||
      lower.includes('v1/images'))
  ) {
    return `模型「${model}」不支持文本对话接口（可能为生图或非对话模型）：${rawError}`;
  }
  if (
    slotType === 'vision' &&
    (lower.includes('image_url') ||
      lower.includes('multimodal') ||
      lower.includes('vision') ||
      lower.includes('content must be a string'))
  ) {
    return `模型「${model}」不支持视觉图片输入 (Vision)：${rawError}`;
  }
  if (
    slotType === 'image' &&
    (lower.includes('not an image') ||
      lower.includes('invalid model') ||
      lower.includes('chat/completions'))
  ) {
    return `模型「${model}」不支持文生图接口 (/images/generations)：${rawError}`;
  }
  return rawError;
}

export async function testLlmConnectivity(
  params: {
    provider: LlmProvider;
    apiKey: string;
    baseUrl?: string;
    model: string;
    slotType?: LlmSlotPurpose;
    onProgress?: (evt: { step: string; message: string }) => void | Promise<void>;
    onReasoningDelta?: (delta: string) => void | Promise<void>;
    onContentDelta?: (delta: string) => void | Promise<void>;
  },
  fetchImpl: HttpFetchPort = fetch,
): Promise<{
  ok: boolean;
  latencyMs: number;
  replyPreview?: string;
  reasoning?: string;
  error?: string;
}> {
  const slotType: LlmSlotPurpose = params.slotType ?? 'primary';
  await params.onProgress?.({
    step: 'validating',
    message: `正在校验 ${params.model} 的槽位能力与端点配置...`,
  });
  const capability = validateModelSlotCapability({
    slotType,
    provider: params.provider,
    model: params.model,
  });
  if (!capability.ok) {
    return {
      ok: false,
      latencyMs: 0,
      error: capability.message,
    };
  }

  const startedAt = Date.now();
  const baseUrl = resolveProviderBaseUrl(params.provider, params.baseUrl);
  if (!baseUrl) {
    return {
      ok: false,
      latencyMs: 0,
      error: `提供商 ${params.provider} 缺少 Base URL`,
    };
  }

  if (slotType === 'image') {
    await params.onProgress?.({
      step: 'probing',
      message: `正在连接文生图端点 ${baseUrl}...`,
    });
    const endpoint = baseUrl.endsWith('/images/generations')
      ? baseUrl
      : `${baseUrl}/images/generations`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (params.apiKey.trim()) {
      headers.Authorization = `Bearer ${params.apiKey.trim()}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: params.model,
          prompt: 'minimalist white circle icon',
          size: '1024x1024',
          n: 1,
        }),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return {
          ok: false,
          latencyMs,
          error: enrichEndpointError(
            errText.slice(0, 300) || `HTTP ${response.status}`,
            'image',
            params.model,
          ),
        };
      }
      const json = (await response.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      const first = json.data?.[0];
      if (!first?.b64_json && !first?.url) {
        return {
          ok: false,
          latencyMs,
          error: '生图端点未返回图片数据 (data[0].b64_json 或 url)',
        };
      }
      return {
        ok: true,
        latencyMs,
        replyPreview: '文生图接口探测通过',
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : '生图连接测试异常',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  if (slotType === 'vision') {
    await params.onProgress?.({
      step: 'probing',
      message: `正在向视觉模型 ${params.model} 发送多模态探测请求...`,
    });
    const endpoint = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (params.apiKey.trim()) {
      headers.Authorization = `Bearer ${params.apiKey.trim()}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: params.model,
          temperature: 0,
          max_tokens: 256,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Reply with OK only.' },
                { type: 'image_url', image_url: { url: PROBE_PNG_DATA_URL } },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return {
          ok: false,
          latencyMs,
          error: enrichEndpointError(
            errText.slice(0, 300) || `HTTP ${response.status}`,
            'vision',
            params.model,
          ),
        };
      }
      const parsed = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
            reasoning_content?: string;
            reasoning?: string;
          };
        }>;
      };
      const message = parsed.choices?.[0]?.message;
      const rawContent = message?.content ?? '';
      const rawReasoning = message?.reasoning_content ?? message?.reasoning ?? '';
      const split = splitThinkTags(rawContent);
      const combinedReasoning = [rawReasoning.trim(), split.reasoning].filter(Boolean).join('\n');
      if (combinedReasoning && params.onReasoningDelta) {
        await params.onReasoningDelta(combinedReasoning);
      }
      if (split.content && params.onContentDelta) {
        await params.onContentDelta(split.content);
      }
      const reply = split.content.trim();
      if (!reply && !combinedReasoning) {
        return {
          ok: false,
          latencyMs,
          error: 'Vision 模型返回空响应',
        };
      }
      return {
        ok: true,
        latencyMs,
        reasoning: combinedReasoning || undefined,
        replyPreview: reply
          ? `视觉识别探测通过: ${reply.slice(0, 40)}`
          : '视觉识别探测通过（已收到模型思考流）',
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : 'Vision 连接测试异常',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  await params.onProgress?.({
    step: 'probing',
    message: `正在流式连接 ${params.model} 并接收思考与响应...`,
  });
  const port = createOpenAiCompatibleLlmPort(fetchImpl, 30_000);
  const res = await port({
    provider: params.provider,
    apiKey: params.apiKey,
    baseUrl,
    model: params.model,
    messages: [{ role: 'user', content: 'Reply with OK only.' }],
    temperature: 0,
    maxTokens: 512,
    jsonMode: false,
    onReasoningDelta: params.onReasoningDelta,
    onContentDelta: params.onContentDelta,
  });
  const latencyMs = Date.now() - startedAt;

  if (res.status >= 400) {
    return {
      ok: false,
      latencyMs,
      reasoning: res.reasoning,
      error: enrichEndpointError(
        res.rawError || `HTTP ${res.status}`,
        slotType,
        params.model,
      ),
    };
  }

  const trimmedContent = res.content.trim();
  const trimmedReasoning = res.reasoning?.trim() ?? '';
  if (!trimmedContent && !trimmedReasoning) {
    return {
      ok: false,
      latencyMs,
      error: enrichEndpointError('模型返回空响应', slotType, params.model),
    };
  }

  return {
    ok: true,
    latencyMs,
    reasoning: trimmedReasoning || undefined,
    replyPreview: trimmedContent
      ? trimmedContent.slice(0, 60)
      : '连通正常（已收到模型思考流）',
  };
}
