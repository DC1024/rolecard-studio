import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { type CoreError, type DnsLookupPort, type HttpFetchPort, type Result, err, ok } from './types.js';

export const DEFAULT_MAX_REDIRECTS = 3;
export const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export const defaultDnsLookup: DnsLookupPort = async (hostname: string) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((item) => ({
    address: item.address,
    family: item.family === 6 ? 6 : 4,
  }));
};

export const defaultHttpFetch: HttpFetchPort = (url, init) => fetch(url, init);

const proxiedFetchUrlCheckers = new WeakMap<HttpFetchPort, (targetUrl: string) => boolean>();
const fakeIpAllowedCheckers = new WeakMap<HttpFetchPort, () => boolean>();

export function registerProxiedFetchChecker(
  fetchImpl: HttpFetchPort,
  checker: (targetUrl: string) => boolean,
): HttpFetchPort {
  proxiedFetchUrlCheckers.set(fetchImpl, checker);
  return fetchImpl;
}

export function isUrlProxiedByFetch(
  fetchImpl: HttpFetchPort | undefined,
  targetUrl: string,
): boolean {
  if (!fetchImpl) return false;
  const checker = proxiedFetchUrlCheckers.get(fetchImpl);
  return checker ? checker(targetUrl) : false;
}

export function registerFakeIpAllowedChecker(
  fetchImpl: HttpFetchPort,
  checker: () => boolean,
): HttpFetchPort {
  fakeIpAllowedCheckers.set(fetchImpl, checker);
  return fetchImpl;
}

export function isFakeIpAllowedByFetch(fetchImpl: HttpFetchPort | undefined): boolean {
  if (!fetchImpl) return false;
  const checker = fakeIpAllowedCheckers.get(fetchImpl);
  return checker ? checker() : false;
}

function isFakeIpRange(ip: string): boolean {
  const octets = ip.trim().split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4) return false;
  return octets[0] === 198 && (octets[1] === 18 || octets[1] === 19);
}

/**
 * Checks whether an IPv4 or IPv6 literal falls into loopback, private,
 * link-local, CGNAT, multicast, or cloud metadata ranges.
 */
export function isDisallowedIp(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase();
  const version = isIP(ip);
  if (version === 0) {
    return true;
  }

  if (version === 4) {
    return isDisallowedIpv4(ip);
  }

  // Handle IPv4-mapped IPv6 such as ::ffff:127.0.0.1 or ::ffff:7f00:1
  if (ip.startsWith('::ffff:')) {
    const tail = ip.slice('::ffff:'.length);
    if (isIP(tail) === 4) {
      return isDisallowedIpv4(tail);
    }
    const hexParts = tail.split(':');
    if (hexParts.length === 2 && hexParts[0] && hexParts[1]) {
      const high = Number.parseInt(hexParts[0], 16);
      const low = Number.parseInt(hexParts[1], 16);
      if (!Number.isNaN(high) && !Number.isNaN(low)) {
        const ipv4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
        return isDisallowedIpv4(ipv4);
      }
    }
  }

  // Loopback ::1, unspecified ::
  if (ip === '::1' || ip === '::' || ip === '0:0:0:0:0:0:0:1' || ip === '0:0:0:0:0:0:0:0') {
    return true;
  }

  // Unique local addresses fc00::/7 (fc.. / fd..)
  if (ip.startsWith('fc') || ip.startsWith('fd')) {
    return true;
  }

  // Link-local fe80::/10 (fe80..febf)
  if (/^fe[89ab][0-9a-f]:/.test(ip) || /^fe[89ab][0-9a-f]$/.test(ip)) {
    return true;
  }

  // Multicast ff00::/8
  if (ip.startsWith('ff')) {
    return true;
  }

  return false;
}

function isDisallowedIpv4(ip: string): boolean {
  const octets = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = octets as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 192 && b === 0 && (octets[2] === 0 || octets[2] === 2)) return true; // IETF / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark / fake-ip
  if (a >= 224) return true; // multicast & reserved

  return false;
}

export async function validatePublicUrl(
  rawUrl: string,
  dnsLookup: DnsLookupPort = defaultDnsLookup,
  options: { viaProxy?: boolean; allowFakeIp?: boolean } = {},
): Promise<Result<URL, CoreError>> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return err({
      code: 'INVALID_URL',
      message: `非法 URL: ${rawUrl}`,
      status: 400,
    });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return err({
      code: 'SSRF_PROTOCOL_BLOCKED',
      message: `仅允许 http/https 协议，已拦截: ${parsed.protocol}`,
      status: 400,
    });
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return err({
      code: 'SSRF_HOST_BLOCKED',
      message: `禁止访问本机或内网域名: ${hostname}`,
      status: 400,
    });
  }

  if (isIP(hostname) !== 0) {
    if (isDisallowedIp(hostname)) {
      return err({
        code: 'SSRF_IP_BLOCKED',
        message: `禁止访问内网或保留 IP 地址: ${hostname}`,
        status: 400,
      });
    }
    return ok(parsed);
  }

  let addresses: { address: string; family: 4 | 6 }[];
  try {
    addresses = await dnsLookup(hostname);
  } catch {
    if (options.viaProxy) {
      return ok(parsed);
    }
    return err({
      code: 'DNS_RESOLUTION_FAILED',
      message: `无法解析目标域名: ${hostname}`,
      status: 400,
    });
  }

  if (addresses.length === 0) {
    if (options.viaProxy) {
      return ok(parsed);
    }
    return err({
      code: 'DNS_RESOLUTION_FAILED',
      message: `域名未返回有效 IP 记录: ${hostname}`,
      status: 400,
    });
  }

  for (const record of addresses) {
    if ((options.viaProxy || options.allowFakeIp) && isFakeIpRange(record.address)) {
      continue;
    }
    if (isDisallowedIp(record.address)) {
      if (isFakeIpRange(record.address)) {
        return err({
          code: 'SSRF_IP_BLOCKED',
          message: `域名 ${hostname} 解析到了透明代理 Fake-IP (${record.address})。若使用系统 TUN/Fake-IP 代理且未在应用内配置代理，请在「设置 → 网络代理」开启全局代理或勾选「允许系统透明代理 / TUN Fake-IP」`,
          status: 400,
        });
      }
      return err({
        code: 'SSRF_IP_BLOCKED',
        message: `域名 ${hostname} 解析到了禁止访问的 IP (${record.address})`,
        status: 400,
      });
    }
  }

  return ok(parsed);
}

export interface SafeFetchOptions {
  dnsLookup?: DnsLookupPort;
  fetchImpl?: HttpFetchPort;
  allowFakeIp?: boolean;
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  bodyText: string;
  byteLength: number;
}

export async function safeFetchText(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<Result<SafeFetchResult, CoreError>> {
  const dnsLookup = options.dnsLookup ?? defaultDnsLookup;
  const fetchImpl = options.fetchImpl ?? defaultHttpFetch;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BODY_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validated = await validatePublicUrl(currentUrl, dnsLookup, {
      viaProxy: isUrlProxiedByFetch(fetchImpl, currentUrl),
      allowFakeIp: options.allowFakeIp ?? isFakeIpAllowedByFetch(fetchImpl),
    });
    if (!validated.ok) {
      return validated;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(validated.value.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'RoleCardStudio/1.0 (+https://github.com/DC1024/rolecard-studio)',
          Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8',
          ...options.headers,
        },
      });
    } catch (error) {
      clearTimeout(timer);
      const isAbort = error instanceof Error && error.name === 'AbortError';
      return err({
        code: isAbort ? 'FETCH_TIMEOUT' : 'FETCH_FAILED',
        message: isAbort ? `请求超时 (${timeoutMs}ms): ${currentUrl}` : `抓取失败: ${currentUrl}`,
        status: 502,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return err({
          code: 'INVALID_REDIRECT',
          message: `重定向响应缺少 Location 头 (${response.status})`,
          status: 502,
        });
      }
      if (hop === maxRedirects) {
        return err({
          code: 'TOO_MANY_REDIRECTS',
          message: `重定向次数超过上限 (${maxRedirects})`,
          status: 502,
        });
      }
      currentUrl = new URL(location, validated.value).toString();
      continue;
    }

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const declaredLength = Number.parseInt(contentLengthHeader, 10);
      if (!Number.isNaN(declaredLength) && declaredLength > maxBytes) {
        return err({
          code: 'RESPONSE_TOO_LARGE',
          message: `目标响应体过大 (${declaredLength} bytes > ${maxBytes} bytes)`,
          status: 413,
        });
      }
    }

    const readResult = await readResponseUpToLimit(response, maxBytes);
    if (!readResult.ok) {
      return readResult;
    }

    return ok({
      finalUrl: validated.value.toString(),
      status: response.status,
      contentType: response.headers.get('content-type') ?? 'text/plain',
      bodyText: readResult.value.text,
      byteLength: readResult.value.byteLength,
    });
  }

  return err({
    code: 'TOO_MANY_REDIRECTS',
    message: `重定向次数超过上限 (${maxRedirects})`,
    status: 502,
  });
}

async function readResponseUpToLimit(
  response: Response,
  maxBytes: number,
): Promise<Result<{ text: string; byteLength: number }, CoreError>> {
  if (!response.body) {
    const text = await response.text();
    const byteLength = Buffer.byteLength(text, 'utf8');
    if (byteLength > maxBytes) {
      return err({
        code: 'RESPONSE_TOO_LARGE',
        message: `目标响应体超过 ${maxBytes} bytes 限制`,
        status: 413,
      });
    }
    return ok({ text, byteLength });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return err({
          code: 'RESPONSE_TOO_LARGE',
          message: `目标响应体超过 ${maxBytes} bytes 限制`,
          status: 413,
        });
      }
      chunks.push(value);
    }
  }

  const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return ok({ text: merged.toString('utf8'), byteLength: total });
}
