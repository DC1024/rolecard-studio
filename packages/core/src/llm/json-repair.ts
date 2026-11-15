import { DEFAULT_LLM_MAX_TOKENS } from '@rolecard/shared';
import type { ZodError, ZodType, ZodTypeDef } from 'zod';
import { type CoreError, type LlmCompletionPort, type LlmCompletionResponse, type LlmMessage, type LlmSlotRuntimeConfig, type Result, err, ok } from '../types.js';
import { splitThinkTags } from './client.js';

function sliceBalancedJson(text: string, start: number): { slice: string; balanced: boolean } {
  const openChar = text[start];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
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
        return { slice: text.slice(start, i + 1), balanced: true };
      }
    }
  }

  return { slice: text.slice(start), balanced: false };
}

function tryJsonParse(text: string): boolean {
  try {
    JSON.parse(repairCommonJsonFlaws(text));
    return true;
  } catch {
    return false;
  }
}

export function extractJsonCandidate(rawText: string): string {
  const withoutThink = splitThinkTags(rawText).content;
  const trimmed = withoutThink.trim();
  if (!trimmed) {
    return trimmed;
  }

  // Prefer the last fenced ```json ... ``` or ``` ... ``` block containing JSON
  let candidate = trimmed;
  const closedFences = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)];
  if (closedFences.length > 0) {
    let picked = '';
    for (let i = closedFences.length - 1; i >= 0; i--) {
      const inner = closedFences[i]?.[1]?.trim() ?? '';
      if (inner.includes('{') || inner.includes('[')) {
        picked = inner;
        if (tryJsonParse(inner)) {
          break;
        }
      }
    }
    if (picked) {
      candidate = picked;
    }
  } else {
    // Handle unclosed trailing ```json fence (e.g. truncated by max_tokens)
    const unclosedFence = trimmed.match(/```(?:json)?\s*([\s\S]*)$/i);
    const inner = unclosedFence?.[1]?.trim() ?? '';
    if (inner && (inner.includes('{') || inner.includes('['))) {
      candidate = inner;
    }
  }

  // Scan candidate JSON start positions; skip false positives like `{user}` in prose if a valid JSON follows
  let fallbackSlice = '';
  let scanFrom = 0;
  let attempts = 0;
  while (scanFrom < candidate.length && attempts < 24) {
    const startObj = candidate.indexOf('{', scanFrom);
    const startArr = candidate.indexOf('[', scanFrom);
    let start = -1;
    if (startObj !== -1 && startArr !== -1) {
      start = Math.min(startObj, startArr);
    } else {
      start = Math.max(startObj, startArr);
    }
    if (start === -1) {
      break;
    }

    attempts += 1;
    const { slice, balanced } = sliceBalancedJson(candidate, start);
    if (!fallbackSlice) {
      fallbackSlice = slice;
    }
    if (balanced && tryJsonParse(slice)) {
      return slice;
    }
    // If truncated (unbalanced) and looks like a real object/array start, keep the longest/first real one
    if (!balanced && slice.length > fallbackSlice.length) {
      fallbackSlice = slice;
    }
    scanFrom = start + 1;
  }

  return fallbackSlice || candidate;
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

/**
 * Best-effort structural closure for JSON truncated mid-stream (e.g. due to max_tokens).
 * Caller MUST still validate the parsed value against the strict Zod schema.
 */
export function repairTruncatedJson(jsonText: string): string {
  let text = repairCommonJsonFlaws(jsonText.trim());
  if (!text || (text[0] !== '{' && text[0] !== '[')) {
    return text;
  }

  const stack: Array<'}' | ']'> = [];
  let inString = false;
  let escaped = false;
  let lastStringStart = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
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
      lastStringStart = i;
    } else if (ch === '{') {
      stack.push('}');
    } else if (ch === '[') {
      stack.push(']');
    } else if ((ch === '}' || ch === ']') && stack.length > 0 && stack[stack.length - 1] === ch) {
      stack.pop();
    }
  }

  if (inString) {
    // Strip dangling trailing backslash before closing quote
    if (escaped) {
      text = text.slice(0, -1);
    }
    const beforeQuote = text.slice(0, lastStringStart).trimEnd();
    const prevCh = beforeQuote[beforeQuote.length - 1];
    // If truncated inside an object key (preceded by `,` or `{`), drop the incomplete key
    if (stack[stack.length - 1] === '}' && (prevCh === ',' || prevCh === '{')) {
      text = beforeQuote;
    } else {
      text = `${text}"`;
    }
  }

  text = text.trimEnd();

  // If truncated right after a complete object key without `: value`, drop the dangling key
  if (stack[stack.length - 1] === '}' && text.endsWith('"')) {
    const endQuote = text.length - 1;
    let openQuote = endQuote - 1;
    while (openQuote >= 0) {
      if (text[openQuote] === '"') {
        let bs = 0;
        let p = openQuote - 1;
        while (p >= 0 && text[p] === '\\') {
          bs += 1;
          p -= 1;
        }
        if (bs % 2 === 0) break;
      }
      openQuote -= 1;
    }
    if (openQuote >= 0) {
      const beforeKey = text.slice(0, openQuote).trimEnd();
      const prevCh = beforeKey[beforeKey.length - 1];
      if (prevCh === ',' || prevCh === '{') {
        text = beforeKey;
      }
    }
  }

  text = text.trimEnd();

  // Handle incomplete primitive literal after `:` or `,` / `[`
  const incompleteColonLiteral = text.match(/^(.*:\s*)(?:t(?:r(?:ue?)?)?|f(?:a(?:l(?:se?)?)?)?|n(?:u(?:ll?)?)?|-|\d+\.)$/s);
  if (incompleteColonLiteral) {
    text = `${incompleteColonLiteral[1]}null`;
  } else if (stack[stack.length - 1] === ']') {
    const incompleteArrayLiteral = text.match(/^(.*[,[])\s*(?:t(?:r(?:ue?)?)?|f(?:a(?:l(?:se?)?)?)?|n(?:u(?:ll?)?)?|-|\d+\.)$/s);
    if (incompleteArrayLiteral) {
      text = incompleteArrayLiteral[1]!;
    }
  }

  text = text.trimEnd();
  if (text.endsWith(':')) {
    text = `${text} ""`;
  } else if (text.endsWith(',')) {
    text = text.slice(0, -1).trimEnd();
  }

  while (stack.length > 0) {
    text += stack.pop();
  }

  return repairCommonJsonFlaws(text);
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
  actionLabel?: string;
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
  const targetLabel = options.actionLabel?.trim() || '生成结构化数据';
  let strategy: 'json_object' | 'prompt' =
    options.slot.jsonModeStrategy === 'prompt' ? 'prompt' : 'json_object';
  let useMaxTokens: number | undefined = options.slot.maxTokens ?? DEFAULT_LLM_MAX_TOKENS;
  let useReasoningEffort: 'low' | 'medium' | 'high' | undefined = undefined;

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

  const invokeWithCapabilityFallback = async (): Promise<LlmCompletionResponse> => {
    for (let fallbackIdx = 0; fallbackIdx < 4; fallbackIdx++) {
      attempts += 1;
      const res = await llmPort({
        provider: options.slot.provider,
        apiKey: options.slot.apiKey,
        baseUrl: options.slot.baseUrl,
        model: options.slot.model,
        messages: conversation,
        temperature: options.temperature,
        maxTokens: useMaxTokens,
        reasoningEffort: useReasoningEffort,
        jsonMode: strategy === 'json_object',
        onReasoningDelta: options.onReasoningDelta,
      });

      if (res.status !== 400) {
        return res;
      }

      if (res.maxTokensRejected && useMaxTokens !== undefined) {
        useMaxTokens = undefined;
        await options.onProgress?.({
          step: 'llm_request',
          message: `${options.slot.model} 网关拒绝 max_tokens 参数，正在自动去掉限制重试（${targetLabel}）...`,
        });
        continue;
      }

      if (res.reasoningEffortRejected && useReasoningEffort !== undefined) {
        useReasoningEffort = undefined;
        await options.onProgress?.({
          step: 'llm_request',
          message: `${options.slot.model} 网关不支持 reasoning_effort 参数，正在自动回退重试（${targetLabel}）...`,
        });
        continue;
      }

      if (
        strategy === 'json_object' &&
        (res.supportsJsonObjectRejected || options.slot.jsonModeStrategy === 'auto')
      ) {
        strategy = 'prompt';
        if (options.onStrategyDowngraded) {
          await options.onStrategyDowngraded('prompt');
        }
        await options.onProgress?.({
          step: 'llm_request',
          message: `${options.slot.model} 网关不支持 json_object，正在自动降级为 Prompt 约束重试（${targetLabel}）...`,
        });
        conversation = promptMessagesWithSchema(baseMessages);
        continue;
      }

      return res;
    }

    attempts += 1;
    return llmPort({
      provider: options.slot.provider,
      apiKey: options.slot.apiKey,
      baseUrl: options.slot.baseUrl,
      model: options.slot.model,
      messages: conversation,
      temperature: options.temperature,
      maxTokens: useMaxTokens,
      reasoningEffort: useReasoningEffort,
      jsonMode: strategy === 'json_object',
      onReasoningDelta: options.onReasoningDelta,
    });
  };

  for (let round = 0; round <= maxRepairRetries; round++) {
    await options.onProgress?.({
      step: 'llm_request',
      message:
        round === 0
          ? `正在调用 ${options.slot.model} ${targetLabel}...`
          : `正在调用 ${options.slot.model} ${targetLabel}（第 ${round} 次 JSON 自愈重试）...`,
    });

    const completion = await invokeWithCapabilityFallback();

    if (completion.status >= 400) {
      return err({
        code: 'LLM_HTTP_ERROR',
        message: `大模型请求失败 (HTTP ${completion.status}): ${completion.rawError ?? '未知错误'}`,
        status: 502,
      });
    }

    await options.onProgress?.({
      step: 'validating',
      message: `正在解析并校验 ${options.slot.model} 返回的「${targetLabel}」结构化数据...`,
    });

    const isTruncated = completion.finishReason === 'length';
    const hasContent = completion.content.trim().length > 0;

    // Level 3: Clean + extract + repair + Zod validate
    const extracted = extractJsonCandidate(completion.content);
    const repaired = repairCommonJsonFlaws(extracted);

    let parsedJson: unknown;
    let parseFailed = false;
    let lastParseError: unknown = null;

    if (!hasContent) {
      parseFailed = true;
      lastParseError = new Error('模型正文输出为空（可能全部用于思考过程）');
    } else {
      try {
        parsedJson = JSON.parse(repaired);
      } catch (parseErr) {
        parseFailed = true;
        lastParseError = parseErr;

        // If not truncated (minor syntax tail issue) OR this is our final round, try structural truncation closure
        if (!isTruncated || round === maxRepairRetries) {
          const closed = repairTruncatedJson(repaired);
          try {
            const rescued = JSON.parse(closed);
            parsedJson = rescued;
            parseFailed = false;
          } catch {
            // keep parseFailed = true
          }
        }
      }
    }

    if (parseFailed) {
      if (round < maxRepairRetries) {
        // Avoid snowballing giant (>12KB) broken outputs or empty-thinking-exhausted turns into retry history
        if (isTruncated || !hasContent || completion.content.length > 12000) {
          useReasoningEffort = 'low';
          const reasonHint = isTruncated || !hasContent
            ? '【重要提示】上一次生成因思考过程过长或输出达到上限被截断，未能产出完整 JSON。请跳过长篇推理推演，精简思考并直接输出完整、紧凑且合法的纯 JSON 对象。'
            : `【重要提示】上一次输出无法解析为合法 JSON (${lastParseError instanceof Error ? lastParseError.message : 'SyntaxError'})。请简短思考后直接输出单个完整合法的 JSON 对象，禁止附加解释文字。`;
          const rebuilt = strategy === 'prompt' ? promptMessagesWithSchema(baseMessages) : baseMessages.map((m) => ({ ...m }));
          rebuilt.push({ role: 'user', content: reasonHint });
          conversation = rebuilt;
          await options.onProgress?.({
            step: 'llm_request',
            message: isTruncated || !hasContent
              ? `检测到 ${options.slot.model} ${targetLabel} 时思考或输出过长被截断，正在切换精简推理模式重试...`
              : `${options.slot.model} ${targetLabel} 输出体量过大且解析失败，正在切换精简重试模式...`,
          });
        } else {
          conversation = [
            ...conversation,
            { role: 'assistant', content: completion.content },
            {
              role: 'user',
              content: `输出不是合法的 JSON 格式 (${lastParseError instanceof Error ? lastParseError.message : 'SyntaxError'})。请仅返回单个完整且合法的 JSON 对象，禁止附加说明文字。`,
            },
          ];
        }
        continue;
      }

      if (isTruncated || !hasContent) {
        return err({
          code: 'LLM_OUTPUT_TRUNCATED',
          message:
            '大模型思考或输出过程过长导致响应被截断（finish_reason=length），未能产出完整 JSON。建议在设置中调大 maxTokens 或精简参考资料后重试。',
          status: 502,
        });
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
