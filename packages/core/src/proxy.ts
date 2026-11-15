import { isIP } from 'node:net';
import {
  ALL_PROXY_SCOPES,
  type MaskedProxyConfig,
  type MaskedProxyScopeOverride,
  type ProxyOverrideMode,
  type ProxyScope,
} from '@rolecard/shared';
import { socksDispatcher } from 'fetch-socks';
import { type Dispatcher, ProxyAgent, fetch as undiciFetch } from 'undici';
import {
  defaultHttpFetch,
  registerFakeIpAllowedChecker,
  registerProxiedFetchChecker,
} from './ssrf.js';
import type { HttpFetchPort } from './types.js';

export interface RuntimeProxyOverride {
  mode: ProxyOverrideMode;
  url: string;
}

export interface RuntimeProxyConfig {
  globalEnabled: boolean;
  globalUrl: string;
  bypassLocal: boolean;
  allowFakeIp?: boolean;
  useEnvProxy?: boolean;
  overrides: Partial<Record<ProxyScope, RuntimeProxyOverride>>;
}

export const DEFAULT_RUNTIME_PROXY_CONFIG: RuntimeProxyConfig = {
  globalEnabled: false,
  globalUrl: '',
  bypassLocal: true,
  allowFakeIp: false,
  useEnvProxy: true,
  overrides: {},
};

const ALLOWED_PROXY_PROTOCOLS = new Set([
  'http:',
  'https:',
  'socks5:',
  'socks5h:',
  'socks4:',
  'socks4a:',
]);

const dispatcherCache = new Map<string, Dispatcher>();
const MAX_DISPATCHER_CACHE_SIZE = 32;

export function validateProxyUrl(
  rawUrl: string,
): { ok: true; normalized: string; parsed: URL } | { ok: false; error: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, error: '代理地址不能为空' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: `非法代理 URL 格式: ${trimmed}` };
  }

  if (!ALLOWED_PROXY_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      error: `不支持的代理协议「${parsed.protocol}」，仅支持 http / https / socks5 / socks5h / socks4`,
    };
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').trim();
  if (!host) {
    return { ok: false, error: '代理地址缺少主机名或 IP' };
  }

  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return { ok: false, error: `代理端口无效: ${parsed.port}` };
    }
  }

  const normalized = `${parsed.protocol}//${parsed.username ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@` : ''}${parsed.host}`;
  return { ok: true, normalized, parsed };
}

export function maskProxyUrl(rawUrl: string | null | undefined): string | null {
  const trimmed = rawUrl?.trim() ?? '';
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) {
      const user = parsed.username || 'user';
      return `${parsed.protocol}//${user}:****@${parsed.host}`;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '****';
  }
}

const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isEnvFakeIpAllowed(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.ROLECARD_ALLOW_FAKE_IP?.trim().toLowerCase() ?? '';
  return TRUTHY_ENV_VALUES.has(raw);
}

export function isEffectiveAllowFakeIp(
  config: RuntimeProxyConfig | undefined | null,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(config?.allowFakeIp) || isEnvFakeIpAllowed(env);
}

export function isNoProxyMatch(
  targetUrl: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const rawNoProxy = env.NO_PROXY ?? env.no_proxy ?? '';
  const trimmed = rawNoProxy.trim();
  if (!trimmed) return false;

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }

  const targetHost = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const targetPort =
    parsed.port || (parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : '');

  for (const rawEntry of trimmed.split(',')) {
    const entry = rawEntry.trim().toLowerCase();
    if (!entry) continue;
    if (entry === '*') return true;

    let patternHost = entry;
    let patternPort = '';
    const lastColon = entry.lastIndexOf(':');
    if (lastColon > 0 && !entry.includes(']')) {
      const portPart = entry.slice(lastColon + 1);
      if (/^\d+$/.test(portPart)) {
        patternHost = entry.slice(0, lastColon);
        patternPort = portPart;
      }
    }
    patternHost = patternHost.replace(/^\[|\]$/g, '');
    if (patternPort && patternPort !== targetPort) {
      continue;
    }

    const normalizedDomain = patternHost.startsWith('.') ? patternHost.slice(1) : patternHost;
    if (!normalizedDomain) continue;
    if (targetHost === normalizedDomain || targetHost.endsWith(`.${normalizedDomain}`)) {
      return true;
    }
  }

  return false;
}

export function resolveEnvProxyUrl(
  targetUrl: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (isNoProxyMatch(targetUrl, env)) {
    return null;
  }

  let protocol = '';
  try {
    protocol = new URL(targetUrl).protocol.toLowerCase();
  } catch {
    protocol = '';
  }

  const candidates =
    protocol === 'https:'
      ? [env.HTTPS_PROXY, env.https_proxy, env.ALL_PROXY, env.all_proxy]
      : protocol === 'http:'
        ? [env.HTTP_PROXY, env.http_proxy, env.ALL_PROXY, env.all_proxy]
        : [env.ALL_PROXY, env.all_proxy, env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy];

  for (const raw of candidates) {
    const val = raw?.trim();
    if (!val) continue;
    const checked = validateProxyUrl(val);
    if (checked.ok) {
      return checked.normalized;
    }
  }

  return null;
}

export function detectEnvProxySummary(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const candidates = [
    env.HTTPS_PROXY,
    env.https_proxy,
    env.HTTP_PROXY,
    env.http_proxy,
    env.ALL_PROXY,
    env.all_proxy,
  ];
  for (const raw of candidates) {
    const val = raw?.trim();
    if (!val) continue;
    const checked = validateProxyUrl(val);
    if (checked.ok) {
      return maskProxyUrl(checked.normalized);
    }
  }
  return null;
}

export function maskProxyConfig(
  config?: RuntimeProxyConfig | null,
  env: Record<string, string | undefined> = process.env,
): MaskedProxyConfig {
  const safe = config ?? DEFAULT_RUNTIME_PROXY_CONFIG;
  const overrides: Partial<Record<ProxyScope, MaskedProxyScopeOverride>> = {};
  for (const scope of ALL_PROXY_SCOPES) {
    const item = safe.overrides?.[scope];
    if (!item) {
      overrides[scope] = { mode: 'inherit', urlMasked: null, hasUrl: false };
    } else {
      const masked = maskProxyUrl(item.url);
      overrides[scope] = {
        mode: item.mode,
        urlMasked: masked,
        hasUrl: Boolean(item.url.trim()),
      };
    }
  }
  return {
    globalEnabled: Boolean(safe.globalEnabled),
    globalUrlMasked: maskProxyUrl(safe.globalUrl),
    hasGlobalUrl: Boolean(safe.globalUrl.trim()),
    bypassLocal: safe.bypassLocal !== false,
    allowFakeIp: Boolean(safe.allowFakeIp),
    useEnvProxy: safe.useEnvProxy !== false,
    envProxyDetected: detectEnvProxySummary(env),
    overrides,
  };
}

export function isLocalBypassHost(rawHostname: string): boolean {
  const host = rawHostname.replace(/^\[|\]$/g, '').trim().toLowerCase();
  if (!host) return false;
  if (
    host === 'localhost' ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }

  if (isIP(host) === 4) {
    const octets = host.split('.').map((n) => Number.parseInt(n, 10));
    if (octets.length !== 4) return false;
    const [a, b] = octets as [number, number, number, number];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }

  if (isIP(host) === 6) {
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
      return true;
    }
  }

  return false;
}

export function resolveEffectiveProxyUrl(
  config: RuntimeProxyConfig | undefined | null,
  scope: ProxyScope,
  targetUrl: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!config) return null;

  let targetHost = '';
  try {
    targetHost = new URL(targetUrl).hostname;
  } catch {
    targetHost = '';
  }

  const bypassLocal = config.bypassLocal !== false;
  const override = config.overrides?.[scope];
  const mode: ProxyOverrideMode = override?.mode ?? 'inherit';

  if (mode === 'direct') {
    return null;
  }

  let candidateUrl = '';
  if (mode === 'custom') {
    candidateUrl = override?.url?.trim() ?? '';
  } else if (config.globalEnabled) {
    candidateUrl = config.globalUrl?.trim() ?? '';
  } else if (config.useEnvProxy !== false) {
    candidateUrl = resolveEnvProxyUrl(targetUrl, env) ?? '';
  }

  if (!candidateUrl) {
    return null;
  }

  if (bypassLocal && targetHost && isLocalBypassHost(targetHost)) {
    return null;
  }

  const checked = validateProxyUrl(candidateUrl);
  return checked.ok ? checked.normalized : null;
}

export function getOrCreateProxyDispatcher(proxyUrl: string): Dispatcher {
  const existing = dispatcherCache.get(proxyUrl);
  if (existing) {
    return existing;
  }

  const parsed = new URL(proxyUrl);
  let dispatcher: Dispatcher;

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    dispatcher = new ProxyAgent({
      uri: proxyUrl,
      headersTimeout: 600_000,
      bodyTimeout: 600_000,
    });
  } else {
    const type: 4 | 5 = parsed.protocol.startsWith('socks4') ? 4 : 5;
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    const port = parsed.port ? Number.parseInt(parsed.port, 10) : 1080;
    const userId = parsed.username ? decodeURIComponent(parsed.username) : undefined;
    const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;

    dispatcher = socksDispatcher({
      type,
      host,
      port,
      ...(userId ? { userId } : {}),
      ...(password ? { password } : {}),
    });
  }

  if (dispatcherCache.size >= MAX_DISPATCHER_CACHE_SIZE) {
    const oldestKey = dispatcherCache.keys().next().value;
    if (oldestKey) {
      dispatcherCache.delete(oldestKey);
    }
  }
  dispatcherCache.set(proxyUrl, dispatcher);
  return dispatcher;
}

export function createProxyFetch(proxyUrl: string): HttpFetchPort {
  const checked = validateProxyUrl(proxyUrl);
  const normalized = checked.ok ? checked.normalized : proxyUrl;
  const fn: HttpFetchPort = async (url, init) => {
    const dispatcher = getOrCreateProxyDispatcher(normalized);
    const response = await undiciFetch(url, {
      ...(init as Record<string, unknown> | undefined),
      dispatcher,
    });
    return response as unknown as Response;
  };
  return registerProxiedFetchChecker(fn, () => true);
}

export function createScopedProxyFetch(
  config: RuntimeProxyConfig | undefined | null,
  scope: ProxyScope,
  fallbackFetch: HttpFetchPort = defaultHttpFetch,
  env: Record<string, string | undefined> = process.env,
): HttpFetchPort {
  if (!config) {
    return fallbackFetch;
  }
  const fn: HttpFetchPort = async (url, init) => {
    const proxyUrl = resolveEffectiveProxyUrl(config, scope, url, env);
    if (!proxyUrl || fallbackFetch !== defaultHttpFetch) {
      return fallbackFetch(url, init);
    }
    const dispatcher = getOrCreateProxyDispatcher(proxyUrl);
    const response = await undiciFetch(url, {
      ...(init as Record<string, unknown> | undefined),
      dispatcher,
    });
    return response as unknown as Response;
  };
  registerFakeIpAllowedChecker(fn, () => isEffectiveAllowFakeIp(config, env));
  return registerProxiedFetchChecker(fn, (targetUrl) =>
    Boolean(resolveEffectiveProxyUrl(config, scope, targetUrl, env)),
  );
}

export async function testProxyConnectivity(
  params: {
    proxyUrl: string;
    targetUrl?: string;
  },
  customFetch?: HttpFetchPort,
): Promise<{
  ok: boolean;
  latencyMs: number;
  status?: number;
  message: string;
}> {
  const validated = validateProxyUrl(params.proxyUrl);
  if (!validated.ok) {
    return {
      ok: false,
      latencyMs: 0,
      message: validated.error,
    };
  }

  const targetUrl = params.targetUrl?.trim() || 'https://cp.cloudflare.com/generate_204';
  const fetchFn = customFetch ?? createProxyFetch(validated.normalized);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetchFn(targetUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'RoleCardStudio-ProxyProbe/1.0',
      },
    });
    const latencyMs = Date.now() - startedAt;

    if (res.status === 407) {
      return {
        ok: false,
        latencyMs,
        status: 407,
        message: '代理服务器认证失败 (HTTP 407)，请检查代理用户名与密码',
      };
    }

    if (res.status >= 500) {
      return {
        ok: false,
        latencyMs,
        status: res.status,
        message: `经代理访问测试目标返回服务端错误 (HTTP ${res.status})`,
      };
    }

    return {
      ok: true,
      latencyMs,
      status: res.status,
      message: `代理隧道连通正常（目标响应 HTTP ${res.status}，耗时 ${latencyMs}ms）`,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const raw =
      error instanceof Error
        ? error.name === 'AbortError'
          ? '代理探测超时 (12000ms)'
          : error.message
        : '代理连接异常';
    return {
      ok: false,
      latencyMs,
      message: `代理连接失败: ${raw}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
