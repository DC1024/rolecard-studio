import { randomUUID } from 'node:crypto';
import { zValidator } from '@hono/zod-validator';
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
  resolveProviderBaseUrl,
  testLlmConnectivity,
  validateModelSlotCapability,
} from '@rolecard/core';
import {
  LlmSlotInputSchema,
  LlmTestRequestSchema,
  ServiceConfigInputSchema,
  type LlmSlotInput,
  type LlmSlotPurpose,
  type MaskedLlmSlot,
  type MaskedServiceConfig,
  type SearchProvider,
} from '@rolecard/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
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

configRoutes.post('/config/test', zValidator('json', LlmTestRequestSchema), async (c) => {
  const denied = guardAdmin(c);
  if (denied) return denied;

  const input = c.req.valid('json');
  const ctx = c.get('ctx');
  let apiKey = input.apiKey?.trim() ?? '';

  if (!apiKey && input.useSavedKeySlot) {
    const saved = await loadRuntimeServiceConfig(ctx);
    if (input.useSavedKeySlot === 'primary') apiKey = saved?.primaryLlm.apiKey ?? '';
    if (input.useSavedKeySlot === 'chat') apiKey = saved?.chatLlm?.apiKey ?? '';
    if (input.useSavedKeySlot === 'vision') apiKey = saved?.visionLlm?.apiKey ?? '';
    if (input.useSavedKeySlot === 'image') apiKey = saved?.imageLlm?.apiKey ?? '';
  }

  const result = await testLlmConnectivity(
    {
      provider: input.provider,
      apiKey,
      baseUrl: input.baseUrl,
      model: input.model,
      slotType: input.slotType,
    },
    ctx.fetchImpl,
  );

  return c.json(
    {
      ...result,
      message: result.ok ? result.replyPreview || '连接测试通过' : result.error || '连接测试失败',
    },
    result.ok ? 200 : 502,
  );
});
