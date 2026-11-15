import type { ZodError, ZodType, ZodTypeDef } from 'zod';
import { type CoreError, type LlmCompletionPort, type LlmMessage, type LlmSlotRuntimeConfig, type Result, err, ok } from '../types.js';

export function extractJsonCandidate(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return trimmed;
  }

  // Strip ```json ... ``` or ``` ... ``` fences if present
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;

  // Find the first balanced JSON object or array
  const startObj = candidate.indexOf('{');
  const startArr = candidate.indexOf('[');
  let start = -1;
  if (startObj !== -1 && startArr !== -1) {
    start = Math.min(startObj, startArr);
  } else {
    start = Math.max(startObj, startArr);
  }
  if (start === -1) {
    return candidate;
  }

  const openChar = candidate[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return candidate.slice(start, i + 1);
      }
    }
  }

  return candidate.slice(start);
}

export function repairCommonJsonFlaws(jsonText: string): string {
  // Remove trailing commas before closing } or ] outside strings
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonText.length; i++) {
    const ch = jsonText[i]!;
    if (inString) {
      result += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }

    if (ch === ',') {
      let j = i + 1;
      while (j < jsonText.length && /\s/.test(jsonText[j]!)) {
        j += 1;
      }
      const next = jsonText[j];
      if (next === '}' || next === ']') {
        continue; // Drop trailing comma
      }
    }

    result += ch;
  }

  return result;
}

export function formatZodRepairPrompt(error: ZodError): string {
  const lines = error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `- 字段 "${path}": ${issue.message}`;
  });
  return [
    '你上一次输出的 JSON 未通过严格 Schema 校验，请仅输出修复后的合法纯 JSON 对象（不要包含 Markdown 代码块或额外解释）：',
    ...lines,
  ].join('\n');
}

export interface StructuredCompletionOptions<T> {
  slot: LlmSlotRuntimeConfig;
  messages: LlmMessage[];
  schema: ZodType<T, ZodTypeDef, unknown>;
  schemaHint: string;
  temperature: number;
  maxRepairRetries?: number;
  onStrategyDowngraded?: (newStrategy: 'prompt') => void | Promise<void>;
  onProgress?: (event: { step: string; message: string }) => void | Promise<void>;
  onReasoningDelta?: (delta: string) => void | Promise<void>;
}

export interface StructuredCompletionResult<T> {
  data: T;
  effectiveStrategy: 'json_object' | 'prompt';
  attempts: number;
}

export async function completeStructuredJson<T>(
  llmPort: LlmCompletionPort,
  options: StructuredCompletionOptions<T>,
): Promise<Result<StructuredCompletionResult<T>, CoreError>> {
  const maxRepairRetries = options.maxRepairRetries ?? 2;
  let strategy: 'json_object' | 'prompt' =
    options.slot.jsonModeStrategy === 'prompt' ? 'prompt' : 'json_object';

  const baseMessages = [...options.messages];
  const promptMessagesWithSchema = (msgs: LlmMessage[]): LlmMessage[] => {
    const copy = msgs.map((m) => ({ ...m }));
    const first = copy[0];
    const hint = `\n\n请严格输出符合以下 JSON Schema 描述的单个合法 JSON 对象：\n${options.schemaHint}`;
    if (first && first.role === 'system') {
      first.content = `${first.content}${hint}`;
    } else {
      copy.unshift({ role: 'system', content: hint.trim() });
    }
    return copy;
  };

  let conversation =
    strategy === 'prompt' ? promptMessagesWithSchema(baseMessages) : [...baseMessages];
  let attempts = 0;

  for (let round = 0; round <= maxRepairRetries; round++) {
    attempts += 1;
    await options.onProgress?.({
      step: 'llm_request',
      message:
        round === 0
          ? `正在调用 ${options.slot.model} 生成结构化角色卡...`
          : `正在执行第 ${round} 次 JSON 自愈重试...`,
    });
    let completion = await llmPort({
      provider: options.slot.provider,
      apiKey: options.slot.apiKey,
      baseUrl: options.slot.baseUrl,
      model: options.slot.model,
      messages: conversation,
      temperature: options.temperature,
      jsonMode: strategy === 'json_object',
      onReasoningDelta: options.onReasoningDelta,
    });

    // Level 1 -> Level 2 automatic downgrade if provider rejects response_format=json_object with HTTP 400
    if (
      strategy === 'json_object' &&
      (completion.supportsJsonObjectRejected ||
        (completion.status === 400 &&
          options.slot.jsonModeStrategy === 'auto'))
    ) {
      strategy = 'prompt';
      if (options.onStrategyDowngraded) {
        await options.onStrategyDowngraded('prompt');
      }
      await options.onProgress?.({
        step: 'llm_request',
        message: '模型网关不支持 json_object，正在自动降级为 Prompt 约束重试...',
      });
      conversation = promptMessagesWithSchema(baseMessages);
      attempts += 1;
      completion = await llmPort({
        provider: options.slot.provider,
        apiKey: options.slot.apiKey,
        baseUrl: options.slot.baseUrl,
        model: options.slot.model,
        messages: conversation,
        temperature: options.temperature,
        jsonMode: false,
        onReasoningDelta: options.onReasoningDelta,
      });
    }

    if (completion.status >= 400) {
      return err({
        code: 'LLM_HTTP_ERROR',
        message: `大模型请求失败 (HTTP ${completion.status}): ${completion.rawError ?? '未知错误'}`,
        status: 502,
      });
    }

    await options.onProgress?.({
      step: 'validating',
      message: '正在解析并校验结构化 JSON 与角色卡 Schema...',
    });

    // Level 3: Clean + extract + repair + Zod validate
    const extracted = extractJsonCandidate(completion.content);
    const repaired = repairCommonJsonFlaws(extracted);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(repaired);
    } catch (parseErr) {
      if (round < maxRepairRetries) {
        conversation = [
          ...conversation,
          { role: 'assistant', content: completion.content },
          {
            role: 'user',
            content: `输出不是合法的 JSON 格式 (${parseErr instanceof Error ? parseErr.message : 'SyntaxError'})。请仅返回单个完整且合法的 JSON 对象，禁止附加说明文字。`,
          },
        ];
        continue;
      }
      return err({
        code: 'LLM_INVALID_JSON',
        message: '大模型输出经多轮自愈重试后仍无法解析为合法 JSON',
        status: 502,
      });
    }

    const zodResult = options.schema.safeParse(parsedJson);
    if (zodResult.success) {
      return ok({
        data: zodResult.data,
        effectiveStrategy: strategy,
        attempts,
      });
    }

    if (round < maxRepairRetries) {
      conversation = [
        ...conversation,
        { role: 'assistant', content: JSON.stringify(parsedJson) },
        { role: 'user', content: formatZodRepairPrompt(zodResult.error) },
      ];
      continue;
    }

    return err({
      code: 'LLM_SCHEMA_VALIDATION_FAILED',
      message: '大模型输出字段未能通过 Zod Schema 校验',
      status: 502,
      details: zodResult.error.issues,
    });
  }

  return err({
    code: 'LLM_RETRIES_EXHAUSTED',
    message: '大模型结构化输出重试耗尽',
    status: 502,
  });
}
