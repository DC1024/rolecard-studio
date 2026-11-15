import {
  BUILTIN_PORTRAIT_STYLE_PRESETS,
  type ImageGenerateRequest,
  type ImageSearchItem,
  type LlmProvider,
  type PortraitPromptMode,
  type PortraitPromptResponse,
  type PortraitPromptStyle,
  type VisionAnalyzeRequest,
  type VisionAnalyzeResponse,
} from '@rolecard/shared';
import { z } from 'zod';
import { detectImageMagicBytes } from './ccv3.js';
import { resolveProviderBaseUrl } from './llm/provider.js';
import {
  completeStructuredJson,
  extractJsonCandidate,
  repairCommonJsonFlaws,
} from './llm/json-repair.js';
import {
  defaultDnsLookup,
  defaultHttpFetch,
  isFakeIpAllowedByFetch,
  isUrlProxiedByFetch,
  validatePublicUrl,
} from './ssrf.js';
import {
  type CoreError,
  type DnsLookupPort,
  type HttpFetchPort,
  type LlmCompletionPort,
  type LlmSlotRuntimeConfig,
  type Result,
  err,
  ok,
} from './types.js';

export interface VisionDeps {
  fetchImpl?: HttpFetchPort;
  dnsLookup?: DnsLookupPort;
  onProgress?: (evt: { step: string; message: string }) => void | Promise<void>;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  includeResponseFormat?: boolean;
}

export type ImageProtocolDialect = 'openai' | 'siliconflow' | 'zhipu' | 'modelscope';

export function detectImageProtocolDialect(
  provider: LlmProvider,
  baseUrl: string,
): ImageProtocolDialect {
  const lower = baseUrl.toLowerCase();
  if (provider === 'siliconflow' || lower.includes('siliconflow.cn')) {
    return 'siliconflow';
  }
  if (provider === 'zhipu' || lower.includes('bigmodel.cn')) {
    return 'zhipu';
  }
  if (provider === 'modelscope' || lower.includes('modelscope.cn')) {
    return 'modelscope';
  }
  return 'openai';
}

export function mapImageSizeForDialect(
  size: string | undefined,
  dialect: ImageProtocolDialect,
  model: string,
): string {
  const target = size ?? '1024x1536';
  if (dialect === 'siliconflow') {
    if (/qwen-image/i.test(model)) {
      if (target === '1024x1536') return '1056x1584';
      if (target === '1024x1024') return '1328x1328';
      return target;
    }
    if (target === '1024x1536') return '960x1280';
    return target;
  }
  return target;
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const VisionAnalysisSchema = z.object({
  appearanceDescription: z.string().min(1).max(2000),
  suggestedTags: z.array(z.string().trim().min(1).max(32)).max(12).default([]),
  imagePrompt: z.string().min(1).max(1500),
});

export async function analyzePortraitWithVision(
  input: VisionAnalyzeRequest,
  slot: LlmSlotRuntimeConfig,
  deps: VisionDeps = {},
): Promise<Result<VisionAnalyzeResponse, CoreError>> {
  const fetchImpl = deps.fetchImpl ?? defaultHttpFetch;
  const dnsLookup = deps.dnsLookup ?? defaultDnsLookup;

  let imagePayloadUrl = '';
  if (input.imageDataUrl) {
    const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(
      input.imageDataUrl.trim(),
    );
    if (!match || !match[2]) {
      return err({
        code: 'INVALID_IMAGE_DATA_URL',
        message: '仅支持 PNG/JPEG/WEBP 格式的 DataURL',
        status: 400,
      });
    }
    const buf = Buffer.from(match[2], 'base64');
    if (!detectImageMagicBytes(buf)) {
      return err({
        code: 'INVALID_IMAGE_MAGIC',
        message: '图片魔数校验失败',
        status: 400,
      });
    }
    imagePayloadUrl = input.imageDataUrl.trim();
  } else if (input.imageUrl) {
    const ssrf = await validatePublicUrl(input.imageUrl, dnsLookup, {
      viaProxy: isUrlProxiedByFetch(fetchImpl, input.imageUrl),
      allowFakeIp: isFakeIpAllowedByFetch(fetchImpl),
    });
    if (!ssrf.ok) {
      return ssrf;
    }
    imagePayloadUrl = ssrf.value.toString();
  } else {
    return err({
      code: 'MISSING_IMAGE_INPUT',
      message: '请提供 imageDataUrl 或 imageUrl',
      status: 400,
    });
  }

  const baseUrl = resolveProviderBaseUrl(slot.provider, slot.baseUrl);
  if (!baseUrl) {
    return err({
      code: 'MISSING_BASE_URL',
      message: 'Vision 模型未配置 Base URL',
      status: 400,
    });
  }

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (slot.apiKey) {
    headers.Authorization = `Bearer ${slot.apiKey}`;
  }

  const promptText = [
    '请分析这张角色立绘或参考图，严格以 JSON 格式输出：',
    '{ "appearanceDescription": "中文外貌、服饰、神态与气场描写(120-260字)", "suggestedTags": ["标签1", "标签2"], "imagePrompt": "高质量英文生图提示词" }',
    input.hint ? `用户补充说明：${input.hint}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: slot.model,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              { type: 'image_url', image_url: { url: imagePayloadUrl } },
            ],
          },
        ],
      }),
    });
  } catch (error) {
    return err({
      code: 'VISION_REQUEST_FAILED',
      message: `Vision 模型调用失败: ${error instanceof Error ? error.message : '网络异常'}`,
      status: 502,
    });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return err({
      code: 'VISION_HTTP_ERROR',
      message: `Vision 接口返回 HTTP ${response.status}: ${text.slice(0, 200)}`,
      status: response.status >= 400 ? response.status : 502,
    });
  }

  const raw = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = raw.choices?.[0]?.message?.content ?? '';
  const candidate = repairCommonJsonFlaws(extractJsonCandidate(content));
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(candidate);
  } catch {
    return err({
      code: 'VISION_INVALID_JSON',
      message: 'Vision 模型未能返回可解析的 JSON 结果',
      status: 502,
    });
  }

  const parsed = VisionAnalysisSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return err({
      code: 'VISION_SCHEMA_MISMATCH',
      message: 'Vision 模型输出结构校验失败',
      status: 502,
      details: parsed.error.flatten(),
    });
  }

  return ok(parsed.data);
}

export async function searchWikimediaCommonsImages(
  query: string,
  limit = 6,
  deps: VisionDeps = {},
): Promise<Result<ImageSearchItem[], CoreError>> {
  const fetchImpl = deps.fetchImpl ?? defaultHttpFetch;
  const dnsLookup = deps.dnsLookup ?? defaultDnsLookup;

  const targetUrl = new URL('https://commons.wikimedia.org/w/api.php');
  targetUrl.searchParams.set('action', 'query');
  targetUrl.searchParams.set('format', 'json');
  targetUrl.searchParams.set('generator', 'search');
  targetUrl.searchParams.set('gsrnamespace', '6');
  targetUrl.searchParams.set('gsrsearch', `${query} filetype:bitmap`);
  targetUrl.searchParams.set('gsrlimit', String(Math.max(1, Math.min(limit, 12))));
  targetUrl.searchParams.set('prop', 'imageinfo');
  targetUrl.searchParams.set('iiprop', 'url|mime');
  targetUrl.searchParams.set('iiurlwidth', '640');

  const urlCheck = await validatePublicUrl(targetUrl.toString(), dnsLookup, {
    viaProxy: isUrlProxiedByFetch(fetchImpl, targetUrl.toString()),
    allowFakeIp: isFakeIpAllowedByFetch(fetchImpl),
  });
  if (!urlCheck.ok) {
    return urlCheck;
  }

  let response: Response;
  try {
    response = await fetchImpl(urlCheck.value.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'RoleCardStudio/1.0 (+https://github.com/DC1024/rolecard-studio)',
        Accept: 'application/json',
      },
    });
  } catch (error) {
    return err({
      code: 'IMAGE_SEARCH_FAILED',
      message: `搜图请求失败: ${error instanceof Error ? error.message : '网络异常'}`,
      status: 502,
    });
  }

  if (!response.ok) {
    return err({
      code: 'IMAGE_SEARCH_HTTP_ERROR',
      message: `搜图服务返回 HTTP ${response.status}`,
      status: 502,
    });
  }

  const data = (await response.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          pageid?: number;
          imageinfo?: Array<{
            url?: string;
            thumburl?: string;
            descriptionurl?: string;
            mime?: string;
          }>;
        }
      >;
    };
  };

  const pages = Object.values(data.query?.pages ?? {});
  const items: ImageSearchItem[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info?.url) continue;
    if (info.mime && !/^image\/(png|jpeg|webp)/i.test(info.mime)) continue;
    items.push({
      title: (page.title ?? 'Reference').replace(/^File:/i, ''),
      imageUrl: info.url,
      thumbUrl: info.thumburl ?? info.url,
      sourcePage: info.descriptionurl ?? info.url,
    });
  }

  return ok(items);
}

export async function fetchRemoteImageBuffer(
  imageUrl: string,
  deps: VisionDeps & { maxBytes?: number } = {},
): Promise<Result<{ buffer: Buffer; contentType: string }, CoreError>> {
  const fetchImpl = deps.fetchImpl ?? defaultHttpFetch;
  const dnsLookup = deps.dnsLookup ?? defaultDnsLookup;
  const maxBytes = deps.maxBytes ?? 12 * 1024 * 1024;

  const ssrf = await validatePublicUrl(imageUrl, dnsLookup, {
    viaProxy: isUrlProxiedByFetch(fetchImpl, imageUrl),
    allowFakeIp: isFakeIpAllowedByFetch(fetchImpl),
  });
  if (!ssrf.ok) {
    return ssrf;
  }

  let response: Response;
  try {
    response = await fetchImpl(ssrf.value.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'User-Agent': 'RoleCardStudio/1.0 (+https://github.com/DC1024/rolecard-studio)',
        Accept: 'image/png,image/jpeg,image/webp,image/*;q=0.8',
      },
    });
  } catch (error) {
    return err({
      code: 'PORTRAIT_FETCH_FAILED',
      message: `拉取外链图片失败: ${error instanceof Error ? error.message : '网络异常'}`,
      status: 502,
    });
  }

  if (!response.ok) {
    return err({
      code: 'PORTRAIT_FETCH_FAILED',
      message: `拉取外链图片失败 (HTTP ${response.status})`,
      status: response.status === 429 ? 429 : 502,
    });
  }

  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length === 0 || buf.length > maxBytes) {
    const limitMb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
    return err({
      code: 'IMAGE_TOO_LARGE',
      message: `外链图片体积超出限制 (最大 ${limitMb}MB)`,
      status: 400,
    });
  }

  const detected = detectImageMagicBytes(buf);
  if (!detected) {
    return err({
      code: 'INVALID_IMAGE_MAGIC',
      message: '外链返回内容不是受支持的 PNG/JPEG/WEBP 图片',
      status: 400,
    });
  }

  const contentType =
    detected === 'jpeg' ? 'image/jpeg' : detected === 'webp' ? 'image/webp' : 'image/png';
  return ok({ buffer: buf, contentType });
}

export async function generatePortraitImage(
  input: ImageGenerateRequest,
  slot: LlmSlotRuntimeConfig,
  imageModel = slot.model,
  deps: VisionDeps = {},
): Promise<Result<{ dataUrl?: string; imageUrl?: string }, CoreError>> {
  const fetchImpl = deps.fetchImpl ?? defaultHttpFetch;
  const baseUrl = resolveProviderBaseUrl(slot.provider, slot.baseUrl);
  if (!baseUrl) {
    return err({
      code: 'MISSING_BASE_URL',
      message: '未配置可用生图模型 Base URL',
      status: 400,
    });
  }

  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const baseRoot = normalizedBase.endsWith('/images/generations')
    ? normalizedBase.slice(0, -'/images/generations'.length)
    : normalizedBase;
  const endpoint = normalizedBase.endsWith('/images/generations')
    ? normalizedBase
    : `${normalizedBase}/images/generations`;

  const dialect = detectImageProtocolDialect(slot.provider, normalizedBase);
  const mappedSize = mapImageSizeForDialect(input.size, dialect, imageModel);
  const negativePrompt = input.negativePrompt?.trim() || undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (slot.apiKey?.trim()) {
    headers.Authorization = `Bearer ${slot.apiKey.trim()}`;
  }
  if (dialect === 'modelscope') {
    headers['X-ModelScope-Async-Mode'] = 'true';
  }

  let bodyPayload: Record<string, unknown>;
  if (dialect === 'siliconflow') {
    bodyPayload = {
      model: imageModel,
      prompt: input.prompt,
      image_size: mappedSize,
      ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
    };
  } else if (dialect === 'zhipu') {
    bodyPayload = {
      model: imageModel,
      prompt: input.prompt,
      size: mappedSize,
    };
  } else if (dialect === 'modelscope') {
    bodyPayload = {
      model: imageModel,
      prompt: input.prompt,
      size: mappedSize,
      ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
    };
  } else {
    bodyPayload = {
      model: imageModel,
      prompt: input.prompt,
      size: mappedSize,
      n: 1,
      ...(deps.includeResponseFormat === false ? {} : { response_format: 'b64_json' }),
    };
  }

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
      signal: deps.signal,
    });
  } catch (error) {
    return err({
      code: 'IMAGE_GEN_FAILED',
      message: `AI 生图调用失败: ${error instanceof Error ? error.message : '网络异常'}`,
      status: 502,
    });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return err({
      code: 'IMAGE_GEN_HTTP_ERROR',
      message: `AI 生图接口返回 HTTP ${response.status}: ${text.slice(0, 200)}`,
      status: response.status >= 400 ? response.status : 502,
    });
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    images?: Array<{ url?: string }>;
    task_id?: string;
  };
  const firstData = payload.data?.[0];
  if (firstData?.b64_json) {
    return ok({ dataUrl: `data:image/png;base64,${firstData.b64_json}` });
  }
  if (firstData?.url) {
    return ok({ imageUrl: firstData.url });
  }
  const firstImage = payload.images?.[0];
  if (firstImage?.url) {
    return ok({ imageUrl: firstImage.url });
  }

  if (dialect === 'modelscope' && payload.task_id) {
    const pollIntervalMs = deps.pollIntervalMs ?? 2000;
    const maxPollAttempts = deps.maxPollAttempts ?? 45;
    const taskEndpoint = `${baseRoot}/tasks/${encodeURIComponent(payload.task_id)}`;
    const taskHeaders: Record<string, string> = {
      'X-ModelScope-Task-Type': 'image_generation',
    };
    if (slot.apiKey?.trim()) {
      taskHeaders.Authorization = `Bearer ${slot.apiKey.trim()}`;
    }

    for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
      if (deps.signal?.aborted) {
        return err({
          code: 'IMAGE_GEN_FAILED',
          message: 'AI 生图任务已取消或超时',
          status: 504,
        });
      }
      await deps.onProgress?.({
        step: 'polling',
        message: `魔搭异步生图排队/渲染中 (${attempt}/${maxPollAttempts})...`,
      });
      await sleepWithAbort(pollIntervalMs, deps.signal);
      if (deps.signal?.aborted) {
        return err({
          code: 'IMAGE_GEN_FAILED',
          message: 'AI 生图任务已取消或超时',
          status: 504,
        });
      }

      let pollRes: Response;
      try {
        pollRes = await fetchImpl(taskEndpoint, {
          method: 'GET',
          headers: taskHeaders,
          signal: deps.signal,
        });
      } catch (error) {
        return err({
          code: 'IMAGE_GEN_FAILED',
          message: `魔搭生图任务轮询失败: ${error instanceof Error ? error.message : '网络异常'}`,
          status: 502,
        });
      }

      if (!pollRes.ok) {
        const errText = await pollRes.text().catch(() => '');
        return err({
          code: 'IMAGE_GEN_HTTP_ERROR',
          message: `魔搭生图任务查询返回 HTTP ${pollRes.status}: ${errText.slice(0, 200)}`,
          status: pollRes.status >= 400 ? pollRes.status : 502,
        });
      }

      const taskData = (await pollRes.json()) as {
        task_status?: string;
        output_images?: string[];
        outputs?: { output_images?: string[] };
        errors?: { message?: string } | string;
        message?: string;
      };
      const status = (taskData.task_status ?? '').toUpperCase();
      if (status === 'SUCCEED') {
        const url = taskData.output_images?.[0] ?? taskData.outputs?.output_images?.[0];
        if (url) {
          return ok({ imageUrl: url });
        }
        return err({
          code: 'IMAGE_GEN_EMPTY',
          message: '魔搭异步生图任务完成但未返回图片 URL',
          status: 502,
        });
      }
      if (status === 'FAILED' || status === 'CANCELED') {
        const detail =
          typeof taskData.errors === 'string'
            ? taskData.errors
            : (taskData.errors?.message ?? taskData.message ?? status);
        return err({
          code: 'IMAGE_GEN_FAILED',
          message: `魔搭生图任务失败: ${detail}`,
          status: 502,
        });
      }
    }

    return err({
      code: 'IMAGE_GEN_TIMEOUT',
      message: '魔搭异步生图等待超时，请稍后重试',
      status: 504,
    });
  }

  return err({
    code: 'IMAGE_GEN_EMPTY',
    message: 'AI 生图接口未返回有效图像数据',
    status: 502,
  });
}

const PortraitPromptOutputSchema = z.object({
  prompt: z.string().trim().min(3).max(2000),
  negativePrompt: z.string().max(800).optional().default(''),
  notes: z.string().max(400).optional().default(''),
});

const PORTRAIT_STYLE_DESCRIPTORS: Record<string, string> = Object.fromEntries(
  BUILTIN_PORTRAIT_STYLE_PRESETS.map((preset) => [preset.id, preset.stylePrompt]),
);

const PORTRAIT_STYLE_NEGATIVE_HINTS: Record<string, string> = Object.fromEntries(
  BUILTIN_PORTRAIT_STYLE_PRESETS.map((preset) => [preset.id, preset.negativePromptHint]),
);

export interface PortraitPromptCardContext {
  characterName: string;
  workName?: string;
  appearance?: string;
  personality?: string;
  background?: string;
  scenario?: string;
  tags?: string[];
}

export interface PortraitPromptDeps {
  llmPort: LlmCompletionPort;
  llmSlot: LlmSlotRuntimeConfig;
}

export async function generateOrOptimizePortraitPrompt(
  params: {
    card: PortraitPromptCardContext;
    mode: PortraitPromptMode;
    style?: PortraitPromptStyle | string;
    customStylePrompt?: string;
    customNegativeHint?: string;
    draftPrompt?: string;
    instruction?: string;
  },
  deps: PortraitPromptDeps,
): Promise<Result<PortraitPromptResponse, CoreError>> {
  const styleKey = params.style ?? 'anime';
  const styleDesc = (
    params.customStylePrompt !== undefined
      ? params.customStylePrompt
      : (PORTRAIT_STYLE_DESCRIPTORS[styleKey] ?? '')
  ).trim();
  const negativeHint = (
    params.customNegativeHint !== undefined
      ? params.customNegativeHint
      : (PORTRAIT_STYLE_NEGATIVE_HINTS[styleKey] ?? '')
  ).trim();
  const cardLines = [
    `角色名：${params.card.characterName}`,
    params.card.workName ? `所属作品/世界观：${params.card.workName}` : '',
    params.card.appearance ? `外貌与服饰设定：${params.card.appearance}` : '',
    params.card.personality ? `性格与神态气质：${params.card.personality}` : '',
    params.card.background ? `背景摘要：${params.card.background.slice(0, 450)}` : '',
    params.card.scenario ? `当前场景氛围：${params.card.scenario.slice(0, 300)}` : '',
    params.card.tags && params.card.tags.length > 0
      ? `角色标签：${params.card.tags.slice(0, 12).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const modeTask =
    params.mode === 'optimize'
      ? [
          '任务类型：结合上述角色卡设定，优化并润色用户当前的生图提示词草稿。',
          `当前草稿：${params.draftPrompt?.trim() || '（空）'}`,
          '要求：保留草稿中的合理构图意图，补充或修正与角色外貌、服饰、神态、氛围冲突之处，使其更具体、更有画面感。',
        ].join('\n')
      : [
          '任务类型：完全结合上述角色卡设定，提炼生成一份高质量英文角色立绘文生图提示词。',
          '要求：从角色外貌、发色瞳色、服饰细节、标志性道具、眼神表情、姿势构图、光影背景中提取可视元素，避免抽象剧透或无法绘制的心理活动。',
        ].join('\n');

  const instructionLine = params.instruction?.trim()
    ? `用户额外微调要求：${params.instruction.trim()}`
    : '';

  const result = await completeStructuredJson(deps.llmPort, {
    slot: deps.llmSlot,
    schema: PortraitPromptOutputSchema,
    schemaHint: '{ "prompt": "English image generation prompt", "negativePrompt": "English negative prompt", "notes": "中文简述提炼/优化思路" }',
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content: [
          '你是资深角色视觉美术总监与 AI 生图提示词工程师。',
          '你需要把角色卡设定转化为可直接用于文生图模型（gpt-image-1 / FLUX / Kolors / SDXL）的高质量英文提示词。',
          styleDesc
            ? `必须严格遵循用户指定的画风基底：${styleDesc}。`
            : '当前未指定固定画风预设（自由风格）：请完全尊重用户草稿提示词或补充画面要求中的画风设定；若用户均未指定画风，请根据角色所属作品与世界观背景自行选择最匹配的视觉风格。',
          negativeHint
            ? `建议在 negativePrompt 中融入以下风格避让参考词（可按语境微调）：${negativeHint}。`
            : '',
          'prompt 字段必须使用清晰具体的英文描述（单人立绘/半身或全身肖像视角，避免多人混入），禁止包含任何中文字符或多余解释；negativePrompt 也用英文；notes 用简体中文（40-120字）概括提取了哪些特征或优化了哪些细节。',
        ]
          .filter(Boolean)
          .join('\n'),
      },
      {
        role: 'user',
        content: [cardLines, modeTask, instructionLine].filter(Boolean).join('\n\n'),
      },
    ],
  });

  if (!result.ok) {
    return result;
  }

  return ok({
    prompt: result.value.data.prompt.trim(),
    negativePrompt: result.value.data.negativePrompt.trim(),
    notes: result.value.data.notes.trim(),
  });
}
