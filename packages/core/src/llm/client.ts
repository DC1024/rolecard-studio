import type { LlmProvider, LlmSlotPurpose } from '@rolecard/shared';
import type {
  HttpFetchPort,
  LlmCompletionPort,
  LlmCompletionRequest,
  LlmCompletionResponse,
} from '../types.js';
import { generatePortraitImage } from '../vision.js';
import { validateModelSlotCapability } from './capabilities.js';
import { resolveProviderBaseUrl } from './provider.js';

export { resolveProviderBaseUrl } from './provider.js';

const PROBE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAJklEQVR4nO3NMQ0AAAwDoPo33arYsQQMkB6LQCAQCAQCgUAg+BIMi1X0pjxKe0gAAAAASUVORK5CYII=';

const THINK_OPEN_TAGS = ['<think>', '<thought>', '<reasoning>'] as const;

/**
 * Extract inline `<think>...</think>`, `<thought>...</thought>`, or `<reasoning>...</reasoning>` blocks from non-streaming content.
 */
export function splitThinkTags(raw: string): { content: string; reasoning: string } {
  const thinkChunks: string[] = [];
  let cleaned = raw.replace(
    /<(think|thought|reasoning)>([\s\S]*?)<\/\1>/gi,
    (_full, _tag: string, inner: string) => {
      if (inner.trim()) {
        thinkChunks.push(inner.trim());
      }
      return '';
    },
  );
  // Handle unclosed trailing thinking tag when truncated by max_tokens
  cleaned = cleaned.replace(/<(think|thought|reasoning)>([\s\S]*)$/i, (_full, _tag: string, inner: string) => {
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
  private activeTag: 'think' | 'thought' | 'reasoning' | null = null;
  private carry = '';

  async feed(
    chunk: string,
    emitReasoning: (delta: string) => Promise<void>,
    emitContent: (delta: string) => Promise<void>,
  ): Promise<void> {
    let text = this.carry + chunk;
    this.carry = '';

    while (text.length > 0) {
      const lower = text.toLowerCase();
      if (!this.activeTag) {
        let earliestIdx = -1;
        let matchedTag: 'think' | 'thought' | 'reasoning' | null = null;
        let matchedOpenLen = 0;

        for (const openTag of THINK_OPEN_TAGS) {
          const idx = lower.indexOf(openTag);
          if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
            earliestIdx = idx;
            matchedTag = openTag.slice(1, -1) as 'think' | 'thought' | 'reasoning';
            matchedOpenLen = openTag.length;
          }
        }

        if (earliestIdx !== -1 && matchedTag) {
          const before = text.slice(0, earliestIdx);
          if (before) await emitContent(before);
          this.activeTag = matchedTag;
          text = text.slice(earliestIdx + matchedOpenLen);
          continue;
        }

        // Hold trailing partial `<think` / `<thought` / `<reasoning` prefix across chunk boundaries
        const partialIdx = findEarliestPartialPrefix(lower, THINK_OPEN_TAGS);
        if (partialIdx !== -1) {
          const safe = text.slice(0, partialIdx);
          if (safe) await emitContent(safe);
          this.carry = text.slice(partialIdx);
          return;
        }
        await emitContent(text);
        return;
      }

      const closeTag = `</${this.activeTag}>`;
      const closeIdx = lower.indexOf(closeTag);
      if (closeIdx !== -1) {
        const thought = text.slice(0, closeIdx);
        if (thought) await emitReasoning(thought);
        this.activeTag = null;
        text = text.slice(closeIdx + closeTag.length);
        continue;
      }
      const partialIdx = findPartialTagPrefix(lower, closeTag);
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
    if (this.activeTag) {
      await emitReasoning(leftover);
    } else {
      await emitContent(leftover);
    }
  }
}

function findEarliestPartialPrefix(lowerText: string, tags: readonly string[]): number {
  let earliest = -1;
  for (const tag of tags) {
    const idx = findPartialTagPrefix(lowerText, tag);
    if (idx !== -1 && (earliest === -1 || idx < earliest)) {
      earliest = idx;
    }
  }
  return earliest;
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

export interface OpenAiLlmPortTimeouts {
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
}

export function createOpenAiCompatibleLlmPort(
  fetchImpl: HttpFetchPort = fetch,
  timeoutConfig: number | OpenAiLlmPortTimeouts = 300_000,
): LlmCompletionPort {
  const idleTimeoutMs =
    typeof timeoutConfig === 'number'
      ? Math.max(1_000, timeoutConfig)
      : Math.max(1_000, timeoutConfig.idleTimeoutMs ?? 300_000);
  const totalTimeoutMs =
    typeof timeoutConfig === 'number'
      ? Math.max(idleTimeoutMs * 4, 1_800_000)
      : Math.max(idleTimeoutMs, timeoutConfig.totalTimeoutMs ?? Math.max(idleTimeoutMs * 4, 1_800_000));

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
    if (request.reasoningEffort) {
      body.reasoning_effort = request.reasoningEffort;
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
    if (request.provider === 'openrouter' || baseUrl.toLowerCase().includes('openrouter.ai')) {
      headers['X-Title'] = 'RoleCard Studio';
      headers['HTTP-Referer'] = 'https://github.com/rolecard-studio';
    }

    const controller = new AbortController();
    let abortReason: 'idle' | 'total' | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const resetIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        abortReason = 'idle';
        controller.abort();
      }, idleTimeoutMs);
    };

    resetIdleTimer();
    const totalTimer = setTimeout(() => {
      abortReason = 'total';
      controller.abort();
    }, totalTimeoutMs);

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
        const maxTokensRejected =
          response.status === 400 &&
          (lower.includes('max_tokens') || lower.includes('max_completion_tokens'));
        const reasoningEffortRejected =
          response.status === 400 && lower.includes('reasoning_effort');
        return {
          content: '',
          status: response.status,
          rawError: rawText.slice(0, 500),
          supportsJsonObjectRejected: jsonRejected,
          maxTokensRejected,
          reasoningEffortRejected,
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
        let finishReason: string | undefined;

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
                finish_reason?: string | null;
                delta?: {
                  content?: string | null;
                  reasoning_content?: string | null;
                  reasoning?: string | null;
                };
              }>;
            };
            const firstChoice = chunk.choices?.[0];
            if (!firstChoice) return;
            if (typeof firstChoice.finish_reason === 'string' && firstChoice.finish_reason) {
              finishReason = firstChoice.finish_reason;
            }
            const delta = firstChoice.delta;
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
          resetIdleTimer();
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
          finishReason,
          status: response.status,
        };
      }

      const rawText = await response.text();
      const parsed = JSON.parse(rawText) as {
        choices?: Array<{
          finish_reason?: string | null;
          message?: {
            content?: string;
            reasoning_content?: string;
            reasoning?: string;
          };
        }>;
      };
      const firstChoice = parsed.choices?.[0];
      const message = firstChoice?.message;
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
        finishReason:
          typeof firstChoice?.finish_reason === 'string' && firstChoice.finish_reason
            ? firstChoice.finish_reason
            : undefined,
        status: response.status,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.name === 'AbortError'
            ? abortReason === 'total'
              ? `请求总耗时超出上限 (${Math.round(totalTimeoutMs / 1000)}s)`
              : `请求流式空闲超时 (${Math.round(idleTimeoutMs / 1000)}s 内未收到模型任何新输出)`
            : error.message
          : '网络请求异常';
      return {
        content: '',
        status: 502,
        rawError: message,
      };
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      if (totalTimer) clearTimeout(totalTimer);
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
    imagePollIntervalMs?: number;
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const result = await generatePortraitImage(
        {
          prompt: 'minimalist white circle icon',
          size: '1024x1024',
        },
        {
          provider: params.provider,
          apiKey: params.apiKey,
          baseUrl,
          model: params.model,
          jsonModeStrategy: 'auto',
        },
        params.model,
        {
          fetchImpl,
          onProgress: params.onProgress,
          signal: controller.signal,
          pollIntervalMs: params.imagePollIntervalMs,
          includeResponseFormat: false,
        },
      );
      const latencyMs = Date.now() - startedAt;
      if (!result.ok) {
        return {
          ok: false,
          latencyMs,
          error: enrichEndpointError(result.error.message, 'image', params.model),
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
