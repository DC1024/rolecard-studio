import { Readability } from '@mozilla/readability';
import {
  estimateTokens,
  type SearchProvider,
  type SearchTestResult,
  type SourceEntry,
} from '@rolecard/shared';
import { parseHTML } from 'linkedom';
import { safeFetchText } from './ssrf.js';
import type { DnsLookupPort, HttpFetchPort, SearchProviderPort } from './types.js';

export interface WikiSiteConfig {
  id: string;
  label: string;
  apiEndpoint: string;
  pageBaseUrl: string;
}

export const BUILTIN_WIKI_SITES: readonly WikiSiteConfig[] = [
  {
    id: 'moegirl',
    label: '萌娘百科',
    apiEndpoint: 'https://zh.moegirl.org.cn/api.php',
    pageBaseUrl: 'https://zh.moegirl.org.cn/index.php?curid=',
  },
  {
    id: 'prts',
    label: 'PRTS Wiki',
    apiEndpoint: 'https://prts.wiki/api.php',
    pageBaseUrl: 'https://prts.wiki/index.php?curid=',
  },
  {
    id: 'wikipedia-zh',
    label: 'Wikipedia (中文)',
    apiEndpoint: 'https://zh.wikipedia.org/w/api.php',
    pageBaseUrl: 'https://zh.wikipedia.org/?curid=',
  },
  {
    id: 'wikipedia-en',
    label: 'Wikipedia (EN)',
    apiEndpoint: 'https://en.wikipedia.org/w/api.php',
    pageBaseUrl: 'https://en.wikipedia.org/?curid=',
  },
];

export interface ExtractedArticle {
  title: string;
  textContent: string;
  excerpt: string;
}

export function extractReadableHtml(html: string): ExtractedArticle | null {
  if (!html.trim()) {
    return null;
  }

  const parsed = parseHTML(html);
  const doc = parsed.document;
  const reader = new Readability(doc as unknown as ConstructorParameters<typeof Readability>[0]);
  const article = reader.parse();

  if (article && article.textContent.trim().length > 0) {
    const cleaned = normalizeWhitespace(article.textContent);
    return {
      title: article.title?.trim() || doc.title?.trim() || '未命名网页',
      textContent: cleaned,
      excerpt: article.excerpt?.trim() || cleaned.slice(0, 280),
    };
  }

  const fallbackText = normalizeWhitespace(doc.body?.textContent ?? '');
  if (!fallbackText) {
    return null;
  }
  return {
    title: doc.title?.trim() || '未命名网页',
    textContent: fallbackText,
    excerpt: fallbackText.slice(0, 280),
  };
}

function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface RetrievalDeps {
  fetchImpl?: HttpFetchPort;
  dnsLookup?: DnsLookupPort;
  searchProviderPort?: SearchProviderPort;
  wikiSites?: readonly WikiSiteConfig[];
}

export async function fetchUserReferenceUrl(
  url: string,
  deps: RetrievalDeps = {},
): Promise<{ ok: true; source: SourceEntry } | { ok: false; message: string }> {
  const fetched = await safeFetchText(url, {
    fetchImpl: deps.fetchImpl,
    dnsLookup: deps.dnsLookup,
  });
  if (!fetched.ok) {
    return { ok: false, message: fetched.error.message };
  }
  if (fetched.value.status >= 400) {
    return { ok: false, message: `抓取参考链接失败 (HTTP ${fetched.value.status}): ${url}` };
  }

  const isHtml = fetched.value.contentType.toLowerCase().includes('html');
  if (isHtml) {
    const extracted = extractReadableHtml(fetched.value.bodyText);
    if (!extracted) {
      return { ok: false, message: `参考链接未提取到有效正文: ${url}` };
    }
    return {
      ok: true,
      source: {
        title: extracted.title,
        url: fetched.value.finalUrl,
        snippet: clipToTokenBudget(extracted.textContent, 2500),
        origin: 'user_provided',
        provider: 'user_url',
      },
    };
  }

  const plainText = normalizeWhitespace(fetched.value.bodyText);
  if (!plainText) {
    return { ok: false, message: `参考链接内容为空: ${url}` };
  }

  return {
    ok: true,
    source: {
      title: new URL(fetched.value.finalUrl).hostname,
      url: fetched.value.finalUrl,
      snippet: clipToTokenBudget(plainText, 2500),
      origin: 'user_provided',
      provider: 'user_url',
    },
  };
}

interface MediaWikiSearchResponse {
  query?: {
    search?: Array<{
      pageid: number;
      title: string;
      snippet?: string;
    }>;
  };
}

interface MediaWikiPageRecord {
  pageid?: number;
  title?: string;
  missing?: string;
  extract?: string;
  fullurl?: string;
  canonicalurl?: string;
  pageprops?: {
    disambiguation?: string;
  };
}

interface MediaWikiExtractResponse {
  query?: {
    pages?: Record<string, MediaWikiPageRecord>;
  };
}

interface MediaWikiParseResponse {
  parse?: {
    title?: string;
    text?: {
      '*'?: string;
    };
  };
}

export interface MediaWikiQueryOptions {
  exactTitle?: string;
  workName?: string;
}

function extractPlainTextFromWikiHtml(html: string): string {
  if (!html.trim()) return '';
  const wrapped = /<body[\s>]/i.test(html)
    ? html
    : `<!doctype html><html><body>${html}</body></html>`;
  const parsed = parseHTML(wrapped);
  const doc = parsed.document;
  for (const selector of ['script', 'style', '.navbox', '.mw-editsection', '.toc']) {
    for (const node of doc.querySelectorAll(selector)) {
      node.remove();
    }
  }
  return normalizeWhitespace(
    doc.body?.textContent ?? doc.documentElement?.textContent ?? doc.textContent ?? '',
  );
}

function scoreMediaWikiCandidate(
  candidateTitle: string,
  snippet: string,
  exactTitle: string,
  workName?: string,
): number {
  const titleLower = candidateTitle.trim().toLowerCase();
  const targetLower = exactTitle.trim().toLowerCase();
  let score = 0;

  if (titleLower === targetLower) score += 200;
  else if (titleLower.startsWith(`${targetLower} `) || titleLower.startsWith(`${targetLower}(`) || titleLower.startsWith(`${targetLower}（`)) score += 120;
  else if (titleLower.includes(targetLower)) score += 60;

  // Strongly penalize resource / animation / dialogue subpages (e.g. "演出阿米娅/spine")
  if (candidateTitle.includes('/')) score -= 80;
  if (/(spine|语音|台词|图鉴|立绘|模型|模板|sandbox)/i.test(candidateTitle)) score -= 40;

  if (workName?.trim()) {
    const workLower = workName.trim().toLowerCase();
    if (titleLower.includes(workLower) || snippet.toLowerCase().includes(workLower)) {
      score += 50;
    }
  }

  // Prefer concise canonical titles over long derivative names
  score -= Math.min(candidateTitle.length, 60) * 0.2;
  return score;
}

async function fetchWikiPageParseText(
  site: WikiSiteConfig,
  pageid: number,
  deps: RetrievalDeps,
): Promise<string> {
  const parseUrl = new URL(site.apiEndpoint);
  parseUrl.searchParams.set('action', 'parse');
  parseUrl.searchParams.set('pageid', String(pageid));
  parseUrl.searchParams.set('prop', 'text');
  parseUrl.searchParams.set('disableeditsection', '1');
  parseUrl.searchParams.set('format', 'json');

  const parseRes = await safeFetchText(parseUrl.toString(), {
    fetchImpl: deps.fetchImpl,
    dnsLookup: deps.dnsLookup,
    timeoutMs: 8000,
  });
  if (!parseRes.ok || parseRes.value.status >= 400) {
    return '';
  }

  try {
    const parsed = JSON.parse(parseRes.value.bodyText) as MediaWikiParseResponse;
    const html = parsed.parse?.text?.['*'] ?? '';
    return extractPlainTextFromWikiHtml(html);
  } catch {
    return '';
  }
}

async function buildSourceFromWikiPage(
  site: WikiSiteConfig,
  page: MediaWikiPageRecord,
  fallbackTitle: string,
  fallbackPageId: number | undefined,
  deps: RetrievalDeps,
): Promise<SourceEntry | null> {
  const pageId = page.pageid ?? fallbackPageId;
  const title = page.title ?? fallbackTitle;
  let extract = normalizeWhitespace(page.extract ?? '');

  // PRTS / template-heavy wikis strip infobox content in prop=extracts; fall back to action=parse when sparse
  if (extract.length < 220 && pageId) {
    const parsedText = await fetchWikiPageParseText(site, pageId, deps);
    if (parsedText.length > extract.length) {
      extract = parsedText;
    }
  }

  if (!extract) {
    return null;
  }

  const canonicalUrl =
    page.canonicalurl ||
    page.fullurl ||
    (pageId ? `${site.pageBaseUrl}${pageId}` : undefined);

  return {
    title: `${title} (${site.label})`,
    url: canonicalUrl,
    snippet: clipToTokenBudget(extract, 2000),
    origin: 'search_supplement',
    provider: site.id,
  };
}

export async function queryMediaWikiSite(
  site: WikiSiteConfig,
  searchTerm: string,
  deps: RetrievalDeps = {},
  options: MediaWikiQueryOptions = {},
): Promise<SourceEntry | null> {
  const exactCandidate = (options.exactTitle || searchTerm).trim();

  // Phase 1: Exact page title lookup with redirect resolution & canonical URL
  if (exactCandidate) {
    const exactUrl = new URL(site.apiEndpoint);
    exactUrl.searchParams.set('action', 'query');
    exactUrl.searchParams.set('titles', exactCandidate);
    exactUrl.searchParams.set('redirects', '1');
    exactUrl.searchParams.set('prop', 'info|extracts|pageprops');
    exactUrl.searchParams.set('explaintext', '1');
    exactUrl.searchParams.set('exsectionformat', 'plain');
    exactUrl.searchParams.set('inprop', 'url');
    exactUrl.searchParams.set('format', 'json');

    const exactRes = await safeFetchText(exactUrl.toString(), {
      fetchImpl: deps.fetchImpl,
      dnsLookup: deps.dnsLookup,
      timeoutMs: 8000,
    });

    if (exactRes.ok && exactRes.value.status < 400) {
      try {
        const parsed = JSON.parse(exactRes.value.bodyText) as MediaWikiExtractResponse;
        const pages = parsed.query?.pages;
        if (pages) {
          const page = Object.values(pages).find(
            (p) => p && p.missing === undefined && typeof p.pageid === 'number' && p.pageid > 0,
          );
          const isDisambig = Boolean(page?.pageprops && 'disambiguation' in page.pageprops);
          if (page && !isDisambig) {
            const built = await buildSourceFromWikiPage(
              site,
              page,
              exactCandidate,
              page.pageid,
              deps,
            );
            if (built) {
              return built;
            }
          }
        }
      } catch {
        // fall through to search phase
      }
    }
  }

  // Phase 2: Full-text search fallback with candidate ranking (deprioritize subpages like /spine)
  const searchUrl = new URL(site.apiEndpoint);
  searchUrl.searchParams.set('action', 'query');
  searchUrl.searchParams.set('list', 'search');
  searchUrl.searchParams.set('srsearch', searchTerm);
  searchUrl.searchParams.set('srlimit', '5');
  searchUrl.searchParams.set('format', 'json');

  const searchRes = await safeFetchText(searchUrl.toString(), {
    fetchImpl: deps.fetchImpl,
    dnsLookup: deps.dnsLookup,
    timeoutMs: 8000,
  });
  if (!searchRes.ok || searchRes.value.status >= 400) {
    return null;
  }

  let candidates: Array<{ pageid: number; title: string; snippet?: string }> = [];
  try {
    const parsed = JSON.parse(searchRes.value.bodyText) as MediaWikiSearchResponse;
    candidates = parsed.query?.search ?? [];
  } catch {
    return null;
  }

  if (candidates.length === 0) {
    return null;
  }

  const ranked = [...candidates].sort((a, b) => {
    const scoreA = scoreMediaWikiCandidate(a.title, a.snippet ?? '', exactCandidate, options.workName);
    const scoreB = scoreMediaWikiCandidate(b.title, b.snippet ?? '', exactCandidate, options.workName);
    return scoreB - scoreA;
  });
  const bestMatch = ranked[0]!;

  const extractUrl = new URL(site.apiEndpoint);
  extractUrl.searchParams.set('action', 'query');
  extractUrl.searchParams.set('prop', 'info|extracts');
  extractUrl.searchParams.set('explaintext', '1');
  extractUrl.searchParams.set('exsectionformat', 'plain');
  extractUrl.searchParams.set('inprop', 'url');
  extractUrl.searchParams.set('pageids', String(bestMatch.pageid));
  extractUrl.searchParams.set('format', 'json');

  const extractRes = await safeFetchText(extractUrl.toString(), {
    fetchImpl: deps.fetchImpl,
    dnsLookup: deps.dnsLookup,
    timeoutMs: 8000,
  });
  if (!extractRes.ok || extractRes.value.status >= 400) {
    return null;
  }

  try {
    const parsed = JSON.parse(extractRes.value.bodyText) as MediaWikiExtractResponse;
    const pages = parsed.query?.pages;
    if (!pages) return null;
    const page = pages[String(bestMatch.pageid)] ?? Object.values(pages)[0];
    if (!page) return null;
    return await buildSourceFromWikiPage(site, page, bestMatch.title, bestMatch.pageid, deps);
  } catch {
    return null;
  }
}

interface Layer2DetailedResult {
  ok: boolean;
  items: SourceEntry[];
  status?: number;
  error?: string;
}

async function readErrorSnippet(res: Response): Promise<string> {
  try {
    const raw = await res.text();
    const compact = raw.replace(/\s+/g, ' ').trim();
    return compact ? compact.slice(0, 180) : `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function executeLayer2Search(
  input: {
    query: string;
    limit: number;
    provider: SearchProvider;
    apiKey: string;
  },
  fetchImpl: HttpFetchPort = fetch,
): Promise<Layer2DetailedResult> {
  if (input.provider === 'none') {
    return { ok: false, items: [], error: '未选择商业搜索服务商' };
  }
  if (!input.apiKey.trim()) {
    return { ok: false, items: [], error: 'Search API Key 不能为空' };
  }

  try {
    if (input.provider === 'tavily') {
      const res = await fetchImpl('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: input.apiKey,
          query: input.query,
          max_results: input.limit,
          include_answer: false,
        }),
      });
      if (!res.ok) {
        return {
          ok: false,
          items: [],
          status: res.status,
          error: `Tavily 请求失败 (HTTP ${res.status}): ${await readErrorSnippet(res)}`,
        };
      }
      const data = (await res.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };
      const items = (data.results ?? [])
        .filter((r) => Boolean(r.title && r.content))
        .map((r) => ({
          title: r.title ?? 'Tavily 结果',
          url: r.url,
          snippet: normalizeWhitespace(r.content ?? ''),
          origin: 'search_supplement' as const,
          provider: 'tavily',
        }));
      return { ok: true, items, status: res.status };
    }

    if (input.provider === 'bocha') {
      const res = await fetchImpl('https://api.bochaai.com/v1/web-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({
          query: input.query,
          count: input.limit,
          summary: true,
        }),
      });
      if (!res.ok) {
        return {
          ok: false,
          items: [],
          status: res.status,
          error: `Bocha 请求失败 (HTTP ${res.status}): ${await readErrorSnippet(res)}`,
        };
      }
      const data = (await res.json()) as {
        data?: { webPages?: { value?: Array<{ name?: string; url?: string; summary?: string; snippet?: string }> } };
      };
      const items = (data.data?.webPages?.value ?? [])
        .filter((r) => Boolean(r.name && (r.summary || r.snippet)))
        .map((r) => ({
          title: r.name ?? 'Bocha 结果',
          url: r.url,
          snippet: normalizeWhitespace(r.summary || r.snippet || ''),
          origin: 'search_supplement' as const,
          provider: 'bocha',
        }));
      return { ok: true, items, status: res.status };
    }

    if (input.provider === 'serpapi') {
      const url = new URL('https://serpapi.com/search.json');
      url.searchParams.set('q', input.query);
      url.searchParams.set('api_key', input.apiKey);
      url.searchParams.set('num', String(input.limit));
      const res = await fetchImpl(url.toString(), { method: 'GET' });
      if (!res.ok) {
        return {
          ok: false,
          items: [],
          status: res.status,
          error: `SerpAPI 请求失败 (HTTP ${res.status}): ${await readErrorSnippet(res)}`,
        };
      }
      const data = (await res.json()) as {
        organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
      };
      const items = (data.organic_results ?? [])
        .filter((r) => Boolean(r.title && r.snippet))
        .map((r) => ({
          title: r.title ?? 'SerpApi 结果',
          url: r.link,
          snippet: normalizeWhitespace(r.snippet ?? ''),
          origin: 'search_supplement' as const,
          provider: 'serpapi',
        }));
      return { ok: true, items, status: res.status };
    }

    if (input.provider === 'bing') {
      const url = new URL('https://api.bing.microsoft.com/v7.0/search');
      url.searchParams.set('q', input.query);
      url.searchParams.set('count', String(input.limit));
      const res = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: { 'Ocp-Apim-Subscription-Key': input.apiKey },
      });
      if (!res.ok) {
        return {
          ok: false,
          items: [],
          status: res.status,
          error: `Bing 请求失败 (HTTP ${res.status}): ${await readErrorSnippet(res)}`,
        };
      }
      const data = (await res.json()) as {
        webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> };
      };
      const items = (data.webPages?.value ?? [])
        .filter((r) => Boolean(r.name && r.snippet))
        .map((r) => ({
          title: r.name ?? 'Bing 结果',
          url: r.url,
          snippet: normalizeWhitespace(r.snippet ?? ''),
          origin: 'search_supplement' as const,
          provider: 'bing',
        }));
      return { ok: true, items, status: res.status };
    }

    return { ok: false, items: [], error: `不支持的搜索服务商: ${String(input.provider)}` };
  } catch (err) {
    return {
      ok: false,
      items: [],
      error: err instanceof Error ? err.message : '搜索服务网络请求异常',
    };
  }
}

export async function runLayer2Search(
  input: {
    query: string;
    limit: number;
    provider: SearchProvider;
    apiKey: string;
  },
  fetchImpl: HttpFetchPort = fetch,
): Promise<SourceEntry[]> {
  if (input.provider === 'none' || !input.apiKey.trim()) {
    return [];
  }
  const result = await executeLayer2Search(input, fetchImpl);
  return result.ok ? result.items : [];
}

export async function testSearchConnectivity(
  input: {
    provider: SearchProvider;
    apiKey?: string;
    query?: string;
    testLayer1Wiki?: boolean;
  },
  deps: RetrievalDeps = {},
): Promise<SearchTestResult> {
  const startedAt = Date.now();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const query = input.query?.trim() || 'Alan Turing';

  let layer1Reachable: boolean | undefined;
  let layer1Summary: string | undefined;

  if (input.testLayer1Wiki) {
    const sites = deps.wikiSites ?? BUILTIN_WIKI_SITES;
    const checks = await Promise.all(
      sites.map(async (site) => {
        const probeUrl = new URL(site.apiEndpoint);
        probeUrl.searchParams.set('action', 'query');
        probeUrl.searchParams.set('meta', 'siteinfo');
        probeUrl.searchParams.set('format', 'json');
        const res = await safeFetchText(probeUrl.toString(), {
          fetchImpl,
          dnsLookup: deps.dnsLookup,
          timeoutMs: 6000,
        }).catch(() => null);
        return {
          label: site.label,
          ok: Boolean(res && res.ok && res.value.status < 400),
        };
      }),
    );
    const okSites = checks.filter((c) => c.ok).map((c) => c.label);
    const failSites = checks.filter((c) => !c.ok).map((c) => c.label);
    layer1Reachable = okSites.length > 0;
    layer1Summary =
      failSites.length === 0
        ? `Layer 1 百科全部连通 (${okSites.join('、')})`
        : okSites.length > 0
          ? `Layer 1 部分连通 (${okSites.join('、')}；不可达: ${failSites.join('、')})`
          : `Layer 1 全部站点不可达 (${failSites.join('、')})`;
  }

  if (input.provider === 'none') {
    const latencyMs = Date.now() - startedAt;
    if (input.testLayer1Wiki) {
      return {
        ok: Boolean(layer1Reachable),
        provider: 'none',
        latencyMs,
        hitCount: 0,
        sampleTitles: [],
        layer1Reachable,
        layer1Summary,
        message: layer1Summary ?? 'Layer 1 百科检测完成',
        ...(layer1Reachable ? {} : { error: layer1Summary }),
      };
    }
    return {
      ok: false,
      provider: 'none',
      latencyMs,
      hitCount: 0,
      sampleTitles: [],
      message: '请先选择 Layer 2 商业搜索服务商（或勾选测试 Layer 1 公开百科）',
      error: '当前未选择商业搜索服务商',
    };
  }

  const trimmedKey = input.apiKey?.trim() ?? '';
  if (!trimmedKey) {
    return {
      ok: false,
      provider: input.provider,
      latencyMs: Date.now() - startedAt,
      hitCount: 0,
      sampleTitles: [],
      layer1Reachable,
      layer1Summary,
      message: '请填写 Search API Key（或保留已保存的 Key）后再测试',
      error: 'Search API Key 不能为空',
    };
  }

  const res = await executeLayer2Search(
    {
      query,
      limit: 2,
      provider: input.provider,
      apiKey: trimmedKey,
    },
    fetchImpl,
  );
  const latencyMs = Date.now() - startedAt;

  if (!res.ok) {
    const msg = res.error || '搜索连通性测试失败';
    return {
      ok: false,
      provider: input.provider,
      latencyMs,
      hitCount: 0,
      sampleTitles: [],
      layer1Reachable,
      layer1Summary,
      message: layer1Summary ? `${msg}；${layer1Summary}` : msg,
      error: msg,
    };
  }

  const sampleTitles = res.items.map((item) => item.title).slice(0, 3);
  const baseMsg = `连接成功 (${latencyMs}ms)，返回 ${res.items.length} 条搜索结果${sampleTitles.length > 0 ? `：${sampleTitles.join(' / ')}` : ''}`;
  return {
    ok: true,
    provider: input.provider,
    latencyMs,
    hitCount: res.items.length,
    sampleTitles,
    layer1Reachable,
    layer1Summary,
    message: layer1Summary ? `${baseMsg}；${layer1Summary}` : baseMsg,
  };
}

export interface LayeredRetrieveInput {
  characterName: string;
  workName?: string;
  enableLayer1Wiki?: boolean;
  searchProvider?: SearchProvider;
  searchApiKey?: string;
  deepSearch?: boolean;
  maxTotalTokens?: number;
  onSiteChecked?: (site: WikiSiteConfig, hit: SourceEntry | null) => void | Promise<void>;
}

export interface LayeredRetrieveOutput {
  sources: SourceEntry[];
  layer1Hits: number;
  layer2Hits: number;
}

export async function layeredRetrieve(
  input: LayeredRetrieveInput,
  deps: RetrievalDeps = {},
): Promise<LayeredRetrieveOutput> {
  const exactTitle = input.characterName.trim();
  const workName = input.workName?.trim();
  const queryTerm = workName ? `${exactTitle} ${workName}` : exactTitle;

  const layer1Sources: SourceEntry[] = [];
  const layer2Sources: SourceEntry[] = [];
  let layer1Hits = 0;
  let layer2Hits = 0;

  const hasLayer2Config = Boolean(
    input.searchProvider &&
      input.searchProvider !== 'none' &&
      input.searchApiKey?.trim(),
  );
  const runLayer1 = input.enableLayer1Wiki !== false;
  const runLayer2Concurrently = hasLayer2Config && input.deepSearch === true;

  const searchPort =
    deps.searchProviderPort ??
    ((q) => runLayer2Search(q, deps.fetchImpl ?? fetch));

  const layer1Promise = runLayer1
    ? (async () => {
        const sites = deps.wikiSites ?? BUILTIN_WIKI_SITES;
        const wikiResults = await Promise.all(
          sites.map(async (site) => {
            const hit = await queryMediaWikiSite(site, queryTerm, deps, {
              exactTitle,
              workName,
            }).catch(() => null);
            if (input.onSiteChecked) {
              await input.onSiteChecked(site, hit);
            }
            return hit;
          }),
        );
        for (const item of wikiResults) {
          if (item) {
            layer1Sources.push(item);
            layer1Hits += 1;
          }
        }
      })()
    : Promise.resolve();

  const layer2Promise = runLayer2Concurrently
    ? (async () => {
        const webResults = await searchPort({
          query: queryTerm,
          limit: 3,
          provider: input.searchProvider!,
          apiKey: input.searchApiKey!,
        }).catch(() => []);
        for (const item of webResults) {
          layer2Sources.push(item);
          layer2Hits += 1;
        }
      })()
    : Promise.resolve();

  await Promise.all([layer1Promise, layer2Promise]);

  // Fallback: if Layer 1 was enabled and yielded 0 hits and deepSearch was false, still try Layer 2
  if (!runLayer2Concurrently && hasLayer2Config && layer1Hits === 0) {
    const webResults = await searchPort({
      query: queryTerm,
      limit: 3,
      provider: input.searchProvider!,
      apiKey: input.searchApiKey!,
    }).catch(() => []);
    for (const item of webResults) {
      layer2Sources.push(item);
      layer2Hits += 1;
    }
  }

  const budget = input.maxTotalTokens ?? 5500;
  return {
    sources: trimLayeredSourcesToBudget(layer1Sources, layer2Sources, budget),
    layer1Hits,
    layer2Hits,
  };
}

function sumSourceTokens(sources: readonly SourceEntry[]): number {
  return sources.reduce((sum, src) => sum + estimateTokens(src.snippet), 0);
}

function trimLayeredSourcesToBudget(
  layer1Sources: SourceEntry[],
  layer2Sources: SourceEntry[],
  maxTokens: number,
): SourceEntry[] {
  if (layer2Sources.length === 0) {
    return trimSourcesToBudget(layer1Sources, maxTokens);
  }
  if (layer1Sources.length === 0) {
    return trimSourcesToBudget(layer2Sources, maxTokens);
  }

  const layer2MinShare = Math.min(2000, Math.floor(maxTokens * 0.35));
  const totalL1Tokens = sumSourceTokens(layer1Sources);
  const totalL2Tokens = sumSourceTokens(layer2Sources);

  const l2Reserved = Math.min(
    totalL2Tokens,
    Math.max(layer2MinShare, maxTokens - totalL1Tokens),
  );
  const l1Budget = Math.max(0, maxTokens - l2Reserved);

  const trimmedL1 = trimSourcesToBudget(layer1Sources, l1Budget);
  const usedL1 = sumSourceTokens(trimmedL1);
  const trimmedL2 = trimSourcesToBudget(layer2Sources, Math.max(0, maxTokens - usedL1));

  return [...trimmedL1, ...trimmedL2];
}

function trimSourcesToBudget(sources: SourceEntry[], maxTokens: number): SourceEntry[] {
  const result: SourceEntry[] = [];
  let used = 0;

  for (const src of sources) {
    const remaining = maxTokens - used;
    if (remaining <= 100) {
      break;
    }
    const tokens = estimateTokens(src.snippet);
    if (tokens <= remaining) {
      result.push(src);
      used += tokens;
    } else {
      result.push({
        ...src,
        snippet: clipToTokenBudget(src.snippet, remaining),
      });
      break;
    }
  }

  return result;
}

export function clipToTokenBudget(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) {
    return text;
  }
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(text.slice(0, mid)) <= maxTokens) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${text.slice(0, Math.max(0, low)).trimEnd()}...`;
}
