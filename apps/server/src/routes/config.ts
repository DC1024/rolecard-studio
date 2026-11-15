import { randomUUID } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import {
  createScopedProxyFetch,
  DEFAULT_RUNTIME_PROXY_CONFIG,
  decryptSecret,
  defaultHttpFetch,
  encryptSecret,
  maskProxyConfig,
  maskSecret,
  resolveProviderBaseUrl,
  testLlmConnectivity,
  testProxyConnectivity,
  testSearchConnectivity,
  validateModelSlotCapability,
  validateProxyUrl,
  type HttpFetchPort,
  type RuntimeProxyConfig,
  type RuntimeProxyOverride,
} from '@rolecard/core';
import {
  ALL_PROXY_SCOPES,
  LlmSlotInputSchema,
  LlmTestRequestSchema,
  ProxyTestRequestSchema,
  SearchTestRequestSchema,
  ServiceConfigInputSchema,
  type LlmSlotInput,
  type LlmSlotPurpose,
  type MaskedLlmSlot,
  type MaskedServiceConfig,
  type ProxyConfigInput,
  type ProxyScope,
  type SearchProvider,
} from '@rolecard/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getNow, type ServerContext } from '../context.js';
import { userServiceConfigs } from '../db/schema.js';
import { guardAdmin, type AppEnv } from '../middleware/auth.js';

export const configRoutes = new Hono<AppEnv>();

const GLOBAL_CONFIG_USER_ID = 'global';

interface StoredEncryptedSlot {
  provider: LlmSlotInput['provider'];
  apiKeyEncrypted: string;
  baseUrl: string;
  model: string;
  jsonModeStrategy: LlmSlotInput['jsonModeStrategy'];
}

export interface DecryptedRuntimeConfig {
  primaryLlm: {
    provider: LlmSlotInput['provider'];
    apiKey: string;
    baseUrl: string;
    model: string;
    jsonModeStrategy: LlmSlotInput['jsonModeStrategy'];
  };
  chatLlm?: {
    provider: LlmSlotInput['provider'];
    apiKey: string;
    baseUrl: string;
    model: string;
    jsonModeStrategy: LlmSlotInput['jsonModeStrategy'];
  };
  visionLlm?: {
    provider: LlmSlotInput['provider'];
    apiKey: string;
    baseUrl: string;
    model: string;
    jsonModeStrategy: LlmSlotInput['jsonModeStrategy'];
  };
  imageLlm?: {
    provider: LlmSlotInput['provider'];
    apiKey: string;
    baseUrl: string;
    model: string;
    jsonModeStrategy: LlmSlotInput['jsonModeStrategy'];
  };
  searchProvider: SearchProvider;
  searchApiKey: string;
  enableLayer1Wiki: boolean;
  dailyAutoRefreshLimit: number;
  customSystemPrompt: string;
  proxyConfig: RuntimeProxyConfig;
}

function parseEncryptedProxyConfig(
  raw: string | null | undefined,
  masterKey: Buffer,
): RuntimeProxyConfig {
  if (!raw) return { ...DEFAULT_RUNTIME_PROXY_CONFIG, overrides: {} };
  try {
    const plain = decryptSecret(raw, masterKey);
    const parsed = JSON.parse(plain) as Partial<RuntimeProxyConfig>;
    const overrides: Partial<Record<ProxyScope, RuntimeProxyOverride>> = {};
    if (parsed.overrides && typeof parsed.overrides === 'object') {
      for (const scope of ALL_PROXY_SCOPES) {
        const entry = parsed.overrides[scope];
        if (entry && (entry.mode === 'inherit' || entry.mode === 'direct' || entry.mode === 'custom')) {
          overrides[scope] = {
            mode: entry.mode,
            url: typeof entry.url === 'string' ? entry.url : '',
          };
        }
      }
    }
    return {
      globalEnabled: Boolean(parsed.globalEnabled),
      globalUrl: typeof parsed.globalUrl === 'string' ? parsed.globalUrl : '',
      bypassLocal: parsed.bypassLocal !== false,
      overrides,
    };
  } catch {
    return { ...DEFAULT_RUNTIME_PROXY_CONFIG, overrides: {} };
  }
}

export async function loadRuntimeProxyConfig(ctx: ServerContext): Promise<RuntimeProxyConfig> {
  const rows = await ctx.db
    .select({ proxyConfigEncrypted: userServiceConfigs.proxyConfigEncrypted })
    .from(userServiceConfigs)
    .where(eq(userServiceConfigs.userId, GLOBAL_CONFIG_USER_ID))
    .limit(1);
  return parseEncryptedProxyConfig(rows[0]?.proxyConfigEncrypted, ctx.masterKey);
}

export function resolveScopedFetch(
  ctx: ServerContext,
  proxyConfig: RuntimeProxyConfig | undefined | null,
  scope: ProxyScope,
): HttpFetchPort {
  const baseFetch = ctx.fetchImpl ?? defaultHttpFetch;
  return createScopedProxyFetch(proxyConfig, scope, baseFetch);
}

export async function loadScopedFetch(
  ctx: ServerContext,
  scope: ProxyScope,
): Promise<HttpFetchPort> {
  if (ctx.fetchImpl) {
    return ctx.fetchImpl;
  }
  const proxyConfig = await loadRuntimeProxyConfig(ctx);
  return resolveScopedFetch(ctx, proxyConfig, scope);
}

export function scopeFromLlmSlot(slotType: LlmSlotPurpose): ProxyScope {
  switch (slotType) {
    case 'chat':
      return 'llm_chat';
    case 'vision':
      return 'llm_vision';
    case 'image':
      return 'llm_image';
    case 'primary':
    default:
      return 'llm_primary';
  }
}

function mergeProxyConfigInput(
  input: ProxyConfigInput | undefined,
  existing: RuntimeProxyConfig | undefined,
):
  | { ok: true; value: RuntimeProxyConfig }
  | { ok: false; message: string } {
  const base = existing ?? { ...DEFAULT_RUNTIME_PROXY_CONFIG, overrides: {} };
  if (!input) {
    return { ok: true, value: base };
  }

  let globalUrl = (input.globalUrl ?? '').trim();
  if (!globalUrl && input.preserveStoredGlobalUrl) {
    globalUrl = base.globalUrl;
  }
  if (globalUrl) {
    const check = validateProxyUrl(globalUrl);
    if (!check.ok) {
      return { ok: false, message: `全局代理配置无效：${check.error}` };
    }
    globalUrl = check.normalized;
  } else if (input.globalEnabled) {
    return { ok: false, message: '启用全局代理时必须填写有效的代理地址' };
  }

  const overrides: Partial<Record<ProxyScope, RuntimeProxyOverride>> = {};
  for (const scope of ALL_PROXY_SCOPES) {
    const rawOv = input.overrides?.[scope];
    if (!rawOv) {
      if (base.overrides?.[scope]) {
        overrides[scope] = base.overrides[scope];
      }
      continue;
    }

    let ovUrl = (rawOv.url ?? '').trim();
    if (!ovUrl && rawOv.preserveStoredUrl) {
      ovUrl = base.overrides?.[scope]?.url ?? '';
    }
    if (ovUrl) {
      const check = validateProxyUrl(ovUrl);
      if (!check.ok) {
        return { ok: false, message: `指定代理 [${scope}] 无效：${check.error}` };
      }
      ovUrl = check.normalized;
    } else if (rawOv.mode === 'custom') {
      return { ok: false, message: `指定代理 [${scope}] 设为独立代理时必须填写代理地址` };
    }

    overrides[scope] = {
      mode: rawOv.mode,
      url: ovUrl,
    };
  }

  return {
    ok: true,
    value: {
      globalEnabled: input.globalEnabled,
      globalUrl,
      bypassLocal: input.bypassLocal,
      overrides,
    },
  };
}

export async function loadRuntimeServiceConfig(
  ctx: ServerContext,
): Promise<DecryptedRuntimeConfig | null> {
  const rows = await ctx.db
    .select()
    .from(userServiceConfigs)
    .where(eq(userServiceConfigs.userId, GLOBAL_CONFIG_USER_ID))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  const primaryProvider = LlmSlotInputSchema.shape.provider.parse(row.llmProvider);
  const primaryApiKey = row.llmApiKeyEncrypted
    ? decryptSecret(row.llmApiKeyEncrypted, ctx.masterKey)
    : '';

  const chatSlot = parseEncryptedSlot(row.chatLlmConfigEncrypted, ctx.masterKey);
  const visionSlot = parseEncryptedSlot(row.visionConfigEncrypted, ctx.masterKey);
  const imageSlot = parseEncryptedSlot(row.imageConfigEncrypted, ctx.masterKey);

  return {
    primaryLlm: {
      provider: primaryProvider,
      apiKey: primaryApiKey,
      baseUrl: resolveProviderBaseUrl(primaryProvider, row.llmBaseUrl),
      model: row.llmModel,
      jsonModeStrategy: row.jsonModeStrategy,
    },
    ...(chatSlot ? { chatLlm: chatSlot } : {}),
    ...(visionSlot ? { visionLlm: visionSlot } : {}),
    ...(imageSlot ? { imageLlm: imageSlot } : {}),
    searchProvider: row.searchProvider as SearchProvider,
    searchApiKey: row.searchApiKeyEncrypted
      ? decryptSecret(row.searchApiKeyEncrypted, ctx.masterKey)
      : '',
    enableLayer1Wiki: row.enableLayer1Wiki,
    dailyAutoRefreshLimit: row.dailyAutoRefreshLimit,
    customSystemPrompt: row.customSystemPrompt,
    proxyConfig: parseEncryptedProxyConfig(row.proxyConfigEncrypted, ctx.masterKey),
  };
}

function parseEncryptedSlot(
  raw: string | null,
  masterKey: Buffer,
): DecryptedRuntimeConfig['chatLlm'] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as StoredEncryptedSlot;
    const provider = LlmSlotInputSchema.shape.provider.parse(parsed.provider);
    return {
      provider,
      apiKey: parsed.apiKeyEncrypted ? decryptSecret(parsed.apiKeyEncrypted, masterKey) : '',
      baseUrl: resolveProviderBaseUrl(provider, parsed.baseUrl),
      model: parsed.model,
      jsonModeStrategy: parsed.jsonModeStrategy ?? 'auto',
    };
  } catch {
    return undefined;
  }
}

function toMaskedSlot(
  slot: DecryptedRuntimeConfig['primaryLlm'] | undefined,
): MaskedLlmSlot | null {
  if (!slot) return null;
  return {
    provider: slot.provider,
    apiKeyMasked: maskSecret(slot.apiKey),
    hasApiKey: slot.apiKey.trim().length > 0,
    baseUrl: slot.baseUrl,
    model: slot.model,
    jsonModeStrategy: slot.jsonModeStrategy,
  };
}

function buildMaskedResponse(
  rowUpdatedAt: string | null,
  runtime: DecryptedRuntimeConfig | null,
): MaskedServiceConfig {
  if (!runtime) {
    return {
      configured: false,
      primaryLlm: null,
      chatLlm: null,
      visionLlm: null,
      imageLlm: null,
      searchProvider: 'none',
      searchApiKeyMasked: null,
      hasSearchApiKey: false,
      enableLayer1Wiki: true,
      dailyAutoRefreshLimit: 20,
      customSystemPrompt: '',
      proxyConfig: maskProxyConfig(null),
      updatedAt: null,
    };
  }

  return {
    configured: true,
    primaryLlm: toMaskedSlot(runtime.primaryLlm),
    chatLlm: toMaskedSlot(runtime.chatLlm),
    visionLlm: toMaskedSlot(runtime.visionLlm),
    imageLlm: toMaskedSlot(runtime.imageLlm),
    searchProvider: runtime.searchProvider,
    searchApiKeyMasked: maskSecret(runtime.searchApiKey),
    hasSearchApiKey: runtime.searchApiKey.trim().length > 0,
    enableLayer1Wiki: runtime.enableLayer1Wiki,
    dailyAutoRefreshLimit: runtime.dailyAutoRefreshLimit,
    customSystemPrompt: runtime.customSystemPrompt,
    proxyConfig: maskProxyConfig(runtime.proxyConfig),
    updatedAt: rowUpdatedAt,
  };
}

configRoutes.get('/config', async (c) => {
  const ctx = c.get('ctx');
  const policy = c.get('policy');
  const actor = c.get('actor');

  // If site requires login, unauthenticated requests cannot inspect config state
  if (policy.siteAccessMode === 'login_required' && !actor) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: '请先登录后查看系统配置状态' } },
      401,
    );
  }

  const rows = await ctx.db
    .select({ updatedAt: userServiceConfigs.updatedAt })
    .from(userServiceConfigs)
    .where(eq(userServiceConfigs.userId, GLOBAL_CONFIG_USER_ID))
    .limit(1);

  const runtime = await loadRuntimeServiceConfig(ctx);
  return c.json(buildMaskedResponse(rows[0]?.updatedAt ?? null, runtime));
});

configRoutes.post('/config', zValidator('json', ServiceConfigInputSchema), async (c) => {
  const denied = guardAdmin(c);
  if (denied) return denied;

  const input = c.req.valid('json');
  const slotsToCheck: Array<{ slotType: LlmSlotPurpose; slot?: LlmSlotInput }> = [
    { slotType: 'primary', slot: input.primaryLlm },
    { slotType: 'chat', slot: input.chatLlm },
    { slotType: 'vision', slot: input.visionLlm },
    { slotType: 'image', slot: input.imageLlm },
  ];
  for (const item of slotsToCheck) {
    if (!item.slot) continue;
    const cap = validateModelSlotCapability({
      slotType: item.slotType,
      provider: item.slot.provider,
      model: item.slot.model,
    });
    if (!cap.ok) {
      return c.json(
        {
          error: {
            code: 'MODEL_CAPABILITY_MISMATCH',
            message: cap.message ?? '模型能力与所选槽位不匹配',
          },
        },
        400,
      );
    }
  }

  const ctx = c.get('ctx');
  const existing = await loadRuntimeServiceConfig(ctx);
  const nowIso = getNow(ctx).toISOString();

  const resolveKey = (incoming: string | undefined, fallbackPlain: string | undefined): string => {
    if (incoming !== undefined && incoming.trim().length > 0) {
      return encryptSecret(incoming.trim(), ctx.masterKey);
    }
    if (incoming === '' || !fallbackPlain) {
      return '';
    }
    return encryptSecret(fallbackPlain, ctx.masterKey);
  };

  const primaryEncrypted = resolveKey(input.primaryLlm.apiKey, existing?.primaryLlm.apiKey);

  const encodeOptionalSlot = (
    slot: LlmSlotInput | undefined,
    existingSlot: DecryptedRuntimeConfig['chatLlm'] | undefined,
  ): string | null => {
    if (!slot) return null;
    const stored: StoredEncryptedSlot = {
      provider: slot.provider,
      apiKeyEncrypted: resolveKey(slot.apiKey, existingSlot?.apiKey),
      baseUrl: resolveProviderBaseUrl(slot.provider, slot.baseUrl),
      model: slot.model,
      jsonModeStrategy: slot.jsonModeStrategy,
    };
    return JSON.stringify(stored);
  };

  const searchEncrypted =
    input.searchProvider === 'none'
      ? null
      : resolveKey(input.searchApiKey, existing?.searchApiKey) || null;

  const mergedProxy = mergeProxyConfigInput(input.proxyConfig, existing?.proxyConfig);
  if (!mergedProxy.ok) {
    return c.json(
      {
        error: {
          code: 'INVALID_PROXY_CONFIG',
          message: mergedProxy.message,
        },
      },
      400,
    );
  }
  const proxyConfigEncrypted = encryptSecret(JSON.stringify(mergedProxy.value), ctx.masterKey);

  const existingRow = await ctx.db
    .select({ id: userServiceConfigs.id })
    .from(userServiceConfigs)
    .where(eq(userServiceConfigs.userId, GLOBAL_CONFIG_USER_ID))
    .limit(1);

  const payload = {
    llmProvider: input.primaryLlm.provider,
    llmApiKeyEncrypted: primaryEncrypted,
    llmBaseUrl: resolveProviderBaseUrl(input.primaryLlm.provider, input.primaryLlm.baseUrl),
    llmModel: input.primaryLlm.model,
    jsonModeStrategy: input.primaryLlm.jsonModeStrategy,
    chatLlmConfigEncrypted: encodeOptionalSlot(input.chatLlm, existing?.chatLlm),
    visionConfigEncrypted: encodeOptionalSlot(input.visionLlm, existing?.visionLlm),
    imageConfigEncrypted: encodeOptionalSlot(input.imageLlm, existing?.imageLlm),
    searchProvider: input.searchProvider,
    searchApiKeyEncrypted: searchEncrypted,
    enableLayer1Wiki: input.enableLayer1Wiki,
    dailyAutoRefreshLimit: input.dailyAutoRefreshLimit,
    customSystemPrompt: input.customSystemPrompt,
    proxyConfigEncrypted,
    updatedAt: nowIso,
  };

  if (existingRow.length > 0) {
    await ctx.db
      .update(userServiceConfigs)
      .set(payload)
      .where(eq(userServiceConfigs.userId, GLOBAL_CONFIG_USER_ID));
  } else {
    await ctx.db.insert(userServiceConfigs).values({
      id: randomUUID(),
      userId: GLOBAL_CONFIG_USER_ID,
      ...payload,
    });
  }

  const updated = await loadRuntimeServiceConfig(ctx);
  return c.json(buildMaskedResponse(nowIso, updated));
});

configRoutes.delete('/config', async (c) => {
  const denied = guardAdmin(c);
  if (denied) return denied;

  await c
    .get('ctx')
    .db.delete(userServiceConfigs)
    .where(eq(userServiceConfigs.userId, GLOBAL_CONFIG_USER_ID));

  return c.json(buildMaskedResponse(null, null));
});

configRoutes.post('/config/proxy/test', zValidator('json', ProxyTestRequestSchema), async (c) => {
  const denied = guardAdmin(c);
  if (denied) return denied;

  const input = c.req.valid('json');
  const ctx = c.get('ctx');
  let proxyUrl = input.proxyUrl?.trim() ?? '';

  if (!proxyUrl && input.useSavedScope) {
    const savedProxy = await loadRuntimeProxyConfig(ctx);
    if (input.useSavedScope === 'global') {
      proxyUrl = savedProxy.globalUrl;
    } else {
      const ov = savedProxy.overrides?.[input.useSavedScope];
      if (ov?.mode === 'direct') {
        return c.json(
          {
            ok: false,
            latencyMs: 0,
            message: `作用域 [${input.useSavedScope}] 当前设为“直连（不使用代理）”`,
          },
          400,
        );
      }
      if (ov?.mode === 'custom') {
        proxyUrl = ov.url;
      } else {
        proxyUrl = savedProxy.globalEnabled ? savedProxy.globalUrl : '';
      }
    }
  }

  if (!proxyUrl) {
    return c.json(
      {
        ok: false,
        latencyMs: 0,
        message: '请先填写代理地址，或先保存有效的全局/指定代理配置',
      },
      400,
    );
  }

  const result = await testProxyConnectivity(
    {
      proxyUrl,
      targetUrl: input.targetUrl,
    },
    ctx.fetchImpl,
  );

  return c.json(result, result.ok ? 200 : 502);
});

configRoutes.post('/config/test', zValidator('json', LlmTestRequestSchema), async (c) => {
  const denied = guardAdmin(c);
  if (denied) return denied;

  const input = c.req.valid('json');
  const ctx = c.get('ctx');
  let apiKey = input.apiKey?.trim() ?? '';

  const saved = await loadRuntimeServiceConfig(ctx);
  if (!apiKey && input.useSavedKeySlot) {
    if (input.useSavedKeySlot === 'primary') apiKey = saved?.primaryLlm.apiKey ?? '';
    if (input.useSavedKeySlot === 'chat') apiKey = saved?.chatLlm?.apiKey ?? '';
    if (input.useSavedKeySlot === 'vision') apiKey = saved?.visionLlm?.apiKey ?? '';
    if (input.useSavedKeySlot === 'image') apiKey = saved?.imageLlm?.apiKey ?? '';
  }

  let effectiveProxyConfig: RuntimeProxyConfig | undefined = saved?.proxyConfig;
  if (input.proxyConfig) {
    const merged = mergeProxyConfigInput(input.proxyConfig, saved?.proxyConfig);
    if (!merged.ok) {
      return c.json(
        {
          ok: false,
          latencyMs: 0,
          message: merged.message,
          error: merged.message,
        },
        400,
      );
    }
    effectiveProxyConfig = merged.value;
  }

  const scopedFetch = resolveScopedFetch(ctx, effectiveProxyConfig, scopeFromLlmSlot(input.slotType));

  const wantsSse = (c.req.header('accept') ?? '').includes('text/event-stream');
  if (wantsSse) {
    return streamSSE(c, async (stream) => {
      let sentThinkingHeader = false;
      const result = await testLlmConnectivity(
        {
          provider: input.provider,
          apiKey,
          baseUrl: input.baseUrl,
          model: input.model,
          slotType: input.slotType,
          onProgress: async (evt) => {
            await stream.writeSSE({
              event: 'progress',
              data: JSON.stringify({ step: evt.step, message: evt.message }),
            });
          },
          onReasoningDelta: async (delta) => {
            if (!sentThinkingHeader) {
              sentThinkingHeader = true;
              await stream.writeSSE({
                event: 'progress',
                data: JSON.stringify({ step: 'thinking', message: '模型正在思考推理...' }),
              });
            }
            await stream.writeSSE({
              event: 'thinking',
              data: JSON.stringify({ delta }),
            });
          },
          onContentDelta: async (delta) => {
            await stream.writeSSE({
              event: 'content',
              data: JSON.stringify({ delta }),
            });
          },
        },
        scopedFetch,
      );

      await stream.writeSSE({
        event: 'result',
        data: JSON.stringify({
          ...result,
          message: result.ok
            ? result.replyPreview || '连接测试通过'
            : result.error || '连接测试失败',
        }),
      });
    });
  }

  const result = await testLlmConnectivity(
    {
      provider: input.provider,
      apiKey,
      baseUrl: input.baseUrl,
      model: input.model,
      slotType: input.slotType,
    },
    scopedFetch,
  );

  return c.json(
    {
      ...result,
      message: result.ok ? result.replyPreview || '连接测试通过' : result.error || '连接测试失败',
    },
    result.ok ? 200 : 502,
  );
});

configRoutes.post('/config/search/test', zValidator('json', SearchTestRequestSchema), async (c) => {
  const denied = guardAdmin(c);
  if (denied) return denied;

  const input = c.req.valid('json');
  const ctx = c.get('ctx');
  const saved = await loadRuntimeServiceConfig(ctx);

  let apiKey = input.apiKey?.trim() ?? '';
  if (!apiKey && input.useSavedKey) {
    apiKey = saved?.searchApiKey ?? '';
  }

  let effectiveProxyConfig: RuntimeProxyConfig | undefined = saved?.proxyConfig;
  if (input.proxyConfig) {
    const merged = mergeProxyConfigInput(input.proxyConfig, saved?.proxyConfig);
    if (!merged.ok) {
      return c.json(
        {
          ok: false,
          provider: input.provider,
          latencyMs: 0,
          hitCount: 0,
          sampleTitles: [],
          message: merged.message,
          error: merged.message,
        },
        400,
      );
    }
    effectiveProxyConfig = merged.value;
  }

  const scopedFetch = resolveScopedFetch(ctx, effectiveProxyConfig, 'search');

  const result = await testSearchConnectivity(
    {
      provider: input.provider,
      apiKey,
      query: input.query,
      testLayer1Wiki: input.testLayer1Wiki,
    },
    {
      fetchImpl: scopedFetch,
      dnsLookup: ctx.dnsLookup,
    },
  );

  return c.json(result, result.ok ? 200 : 502);
});
