import type {
  ImageGenerateRequest,
  ImageSearchItem,
  VisionAnalyzeRequest,
  VisionAnalyzeResponse,
} from '@rolecard/shared';
import { z } from 'zod';
import { detectImageMagicBytes } from './ccv3.js';
import { resolveProviderBaseUrl } from './llm/client.js';
import { extractJsonCandidate, repairCommonJsonFlaws } from './llm/json-repair.js';
import { defaultDnsLookup, defaultHttpFetch, validatePublicUrl } from './ssrf.js';
import {
  type CoreError,
  type DnsLookupPort,
  type HttpFetchPort,
  type LlmSlotRuntimeConfig,
  type Result,
  err,
  ok,
} from './types.js';

export interface VisionDeps {
  fetchImpl?: HttpFetchPort;
  dnsLookup?: DnsLookupPort;
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
    const ssrf = await validatePublicUrl(input.imageUrl, dnsLookup);
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
  targetUrl.searchParams.set('iiurlwidth', '480');

  const urlCheck = await validatePublicUrl(targetUrl.toString(), dnsLookup);
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

export async function generatePortraitImage(
  input: ImageGenerateRequest,
  slot: LlmSlotRuntimeConfig,
  imageModel = 'gpt-image-1',
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

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/images/generations`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (slot.apiKey) {
    headers.Authorization = `Bearer ${slot.apiKey}`;
  }

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: imageModel,
        prompt: input.prompt,
        size: input.size,
        n: 1,
        response_format: 'b64_json',
      }),
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
  };
  const first = payload.data?.[0];
  if (first?.b64_json) {
    return ok({ dataUrl: `data:image/png;base64,${first.b64_json}` });
  }
  if (first?.url) {
    return ok({ imageUrl: first.url });
  }

  return err({
    code: 'IMAGE_GEN_EMPTY',
    message: 'AI 生图接口未返回有效图像数据',
    status: 502,
  });
}
