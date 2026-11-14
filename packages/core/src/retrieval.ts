import { Readability } from '@mozilla/readability';
import { estimateTokens, type SearchProvider, type SourceEntry } from '@rolecard/shared';
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

interface MediaWikiExtractResponse {
  query?: {
    pages?: Record<
      string,
      {
        pageid?: number;
        title?: string;
        extract?: string;
      }
    >;
  };
}

export async function queryMediaWikiSite(
  site: WikiSiteConfig,
  searchTerm: string,
  deps: RetrievalDeps = {},
): Promise<SourceEntry | null> {
  const searchUrl = new URL(site.apiEndpoint);
  searchUrl.searchParams.set('action', 'query');
  searchUrl.searchParams.set('list', 'search');
  searchUrl.searchParams.set('srsearch', searchTerm);
  searchUrl.searchParams.set('srlimit', '1');
  searchUrl.searchParams.set('format', 'json');

  const searchRes = await safeFetchText(searchUrl.toString(), {
    fetchImpl: deps.fetchImpl,
    dnsLookup: deps.dnsLookup,
    timeoutMs: 8000,
  });
  if (!searchRes.ok || searchRes.value.status >= 400) {
    return null;
  }

  let firstMatch: { pageid: number; title: string; snippet?: string } | undefined;
  try {
    const parsed = JSON.parse(searchRes.value.bodyText) as MediaWikiSearchResponse;
    firstMatch = parsed.query?.search?.[0];
  } catch {
    return null;
  }

  if (!firstMatch) {
    return null;
  }

  const extractUrl = new URL(site.apiEndpoint);
  extractUrl.searchParams.set('action', 'query');
  extractUrl.searchParams.set('prop', 'extracts');
  extractUrl.searchParams.set('explaintext', '1');
  extractUrl.searchParams.set('exsectionformat', 'plain');
  extractUrl.searchParams.set('pageids', String(firstMatch.pageid));
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
    const page = pages[String(firstMatch.pageid)] ?? Object.values(pages)[0];
    const extract = normalizeWhitespace(page?.extract ?? '');
    if (!extract) {
      return null;
    }

    return {
      title: `${page?.title ?? firstMatch.title} (${site.label})`,
      url: `${site.pageBaseUrl}${firstMatch.pageid}`,
      snippet: clipToTokenBudget(extract, 2000),
      origin: 'search_supplement',
      provider: site.id,
    };
  } catch {
    return null;
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
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (data.results ?? [])
      .filter((r) => Boolean(r.title && r.content))
      .map((r) => ({
        title: r.title ?? 'Tavily 结果',
        url: r.url,
        snippet: normalizeWhitespace(r.content ?? ''),
        origin: 'search_supplement' as const,
        provider: 'tavily',
      }));
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
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: { webPages?: { value?: Array<{ name?: string; url?: string; summary?: string; snippet?: string }> } };
    };
    return (data.data?.webPages?.value ?? [])
      .filter((r) => Boolean(r.name && (r.summary || r.snippet)))
      .map((r) => ({
        title: r.name ?? 'Bocha 结果',
        url: r.url,
        snippet: normalizeWhitespace(r.summary || r.snippet || ''),
        origin: 'search_supplement' as const,
        provider: 'bocha',
      }));
  }

  if (input.provider === 'serpapi') {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('q', input.query);
    url.searchParams.set('api_key', input.apiKey);
    url.searchParams.set('num', String(input.limit));
    const res = await fetchImpl(url.toString(), { method: 'GET' });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
    };
    return (data.organic_results ?? [])
      .filter((r) => Boolean(r.title && r.snippet))
      .map((r) => ({
        title: r.title ?? 'SerpApi 结果',
        url: r.link,
        snippet: normalizeWhitespace(r.snippet ?? ''),
        origin: 'search_supplement' as const,
        provider: 'serpapi',
      }));
  }

  if (input.provider === 'bing') {
    const url = new URL('https://api.bing.microsoft.com/v7.0/search');
    url.searchParams.set('q', input.query);
    url.searchParams.set('count', String(input.limit));
    const res = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': input.apiKey },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> };
    };
    return (data.webPages?.value ?? [])
      .filter((r) => Boolean(r.name && r.snippet))
      .map((r) => ({
        title: r.name ?? 'Bing 结果',
        url: r.url,
        snippet: normalizeWhitespace(r.snippet ?? ''),
        origin: 'search_supplement' as const,
        provider: 'bing',
      }));
  }

  return [];
}

export interface LayeredRetrieveInput {
  characterName: string;
  workName?: string;
  enableLayer1Wiki?: boolean;
  searchProvider?: SearchProvider;
  searchApiKey?: string;
  deepSearch?: boolean;
  maxTotalTokens?: number;
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
  const queryTerm = input.workName?.trim()
    ? `${input.characterName.trim()} ${input.workName.trim()}`
    : input.characterName.trim();

  const sources: SourceEntry[] = [];
  let layer1Hits = 0;
  let layer2Hits = 0;

  if (input.enableLayer1Wiki !== false) {
    const sites = deps.wikiSites ?? BUILTIN_WIKI_SITES;
    const wikiResults = await Promise.all(
      sites.map((site) => queryMediaWikiSite(site, queryTerm, deps).catch(() => null)),
    );
    for (const item of wikiResults) {
      if (item) {
        sources.push(item);
        layer1Hits += 1;
      }
    }
  }

  const shouldRunLayer2 =
    (layer1Hits === 0 || input.deepSearch === true) &&
    input.searchProvider &&
    input.searchProvider !== 'none' &&
    Boolean(input.searchApiKey?.trim());

  if (shouldRunLayer2 && input.searchProvider && input.searchApiKey) {
    const searchPort =
      deps.searchProviderPort ??
      ((q) => runLayer2Search(q, deps.fetchImpl ?? fetch));
    const webResults = await searchPort({
      query: queryTerm,
      limit: 3,
      provider: input.searchProvider,
      apiKey: input.searchApiKey,
    }).catch(() => []);

    for (const item of webResults) {
      sources.push(item);
      layer2Hits += 1;
    }
  }

  const budget = input.maxTotalTokens ?? 5500;
  return {
    sources: trimSourcesToBudget(sources, budget),
    layer1Hits,
    layer2Hits,
  };
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
