import type {
  AccessPolicy,
  AddCardSourcesRequest,
  AuthContextResponse,
  CardGeneratableField,
  CardImageUploadRequest,
  CardRevisionSummary,
  CardType,
  CreatePortraitStylePresetInput,
  CreateUserRequest,
  DeclarativePluginManifest,
  ExportFormat,
  GenerateCardFieldRequest,
  GenerateCardRequest,
  GenerationMode,
  ImageGenerateRequest,
  ImageSearchItem,
  ImageSearchRequest,
  ImportCardRequest,
  ImpressionEventDto,
  LinkCharacterToLorebookRequest,
  LlmTestRequest,
  LorebookDto,
  LorebookEntry,
  MaskedServiceConfig,
  NotificationChannelDto,
  PlaytestRequest,
  PlaytestResponse,
  PortraitPromptRequest,
  PortraitPromptResponse,
  PortraitStylePresetDto,
  ProxyTestRequest,
  PublishStatus,
  RegenerateCardRequest,
  ResolveProposalRequest,
  RippleProposalDto,
  RoleCardContent,
  SearchCardSourcesRequest,
  SearchCardSourcesResponse,
  SearchTestRequest,
  SearchTestResult,
  ServiceConfigInput,
  SourceEntry,
  SyncEventDto,
  SyncScheduleDto,
  SyncSubscriptionDto,
  TokenCrop,
  CreateSyncSubscriptionRequest,
  UpdateCardContentRequest,
  UpdateLorebookRequest,
  CreateLorebookRequest,
  UpdateMetaSettingsRequest,
  UpdateMyAccountRequest,
  UpdatePortraitStylePresetInput,
  UpdateScheduleRequest,
  UpdateUserPermissionsRequest,
  UpsertNotificationChannelRequest,
  UserSummary,
  VisionAnalyzeRequest,
  VisionAnalyzeResponse,
} from '@rolecard/shared';

export interface RoleCardDto {
  id: string;
  userId: string;
  parentCardId: string | null;
  version: number;
  publishStatus: PublishStatus;
  entityType: 'fictional' | 'real_person';
  characterName: string;
  workName: string;
  tags: string[];
  cardType: CardType;
  mode: GenerationMode;
  content: RoleCardContent;
  sources: SourceEntry[];
  tokenCount: number;
  imageUrl: string | null;
  tokenImageUrl: string | null;
  tokenCrop: TokenCrop | null;
  imageSource: string | null;
  imagePrompt: string | null;
  lockedFields: string[];
  diffSummary: string | null;
  enableMetaInChat: boolean;
  metaSummary: string | null;
  metaUpdatedAt: string | null;
  scheduleEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommonTagCount {
  tag: string;
  count: number;
}

export interface CardListResponse {
  items: RoleCardDto[];
  total: number;
  page: number;
  pageSize: number;
  commonTags: CommonTagCount[];
}

export interface ExternalApiKeySummary {
  id: string;
  name: string;
  scopes: string[];
  rateLimitPerMin: number;
  rateLimitPerDay: number;
  isActive: boolean;
  createdAt: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `请求失败 (HTTP ${res.status})`;
    try {
      const payload = (await res.json()) as {
        error?: { code?: string; message?: string };
        message?: string;
      };
      if (payload.error?.code) code = payload.error.code;
      if (payload.error?.message) message = payload.error.message;
      else if (payload.message) message = payload.message;
    } catch {
      // ignore non-json error bodies
    }
    throw new ApiError(code, message, res.status);
  }

  return (await res.json()) as T;
}

async function consumeSsePost<TResult>(
  path: string,
  payload: unknown,
  callbacks: {
    onProgress?: (message: string, step?: string) => void;
    onThinking?: (delta: string) => void;
    onContent?: (delta: string) => void;
  },
  fallbackErrorMsg: string,
): Promise<TResult> {
  const res = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let msg = `${fallbackErrorMsg} (HTTP ${res.status})`;
    let code = 'HTTP_ERROR';
    try {
      const errBody = (await res.json()) as { error?: { code?: string; message?: string } };
      if (errBody.error?.code) code = errBody.error.code;
      if (errBody.error?.message) msg = errBody.error.message;
    } catch {
      // ignore non-json error body
    }
    throw new ApiError(code, msg, res.status);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    return (await res.json()) as TResult;
  }

  let finalResult: TResult | null = null;
  const handleSseBlock = (block: string) => {
    if (!block.trim()) return;
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (eventName === 'ping') return;
    const rawData = dataLines.join('\n');
    if (!rawData) return;
    const parsed = JSON.parse(rawData) as Record<string, unknown>;
    if (eventName === 'progress' && typeof parsed.message === 'string') {
      callbacks.onProgress?.(
        parsed.message,
        typeof parsed.step === 'string' ? parsed.step : undefined,
      );
    } else if (eventName === 'thinking' && typeof parsed.delta === 'string') {
      callbacks.onThinking?.(parsed.delta);
    } else if (eventName === 'content' && typeof parsed.delta === 'string') {
      callbacks.onContent?.(parsed.delta);
    } else if (eventName === 'error') {
      throw new ApiError(
        String(parsed.code ?? 'SSE_ERROR'),
        String(parsed.message ?? fallbackErrorMsg),
        Number(parsed.status ?? 400),
      );
    } else if (eventName === 'result') {
      finalResult = parsed as unknown as TResult;
    }
  };

  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        handleSseBlock(block);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      for (const block of buffer.split(/\r?\n\r?\n/)) {
        handleSseBlock(block);
      }
    }
  } else {
    const text = await res.text();
    for (const block of text.split(/\r?\n\r?\n/)) {
      handleSseBlock(block);
    }
  }

  if (!finalResult) {
    throw new ApiError('EMPTY_STREAM', '未收到流式返回结果，请检查后端日志', 500);
  }
  return finalResult;
}

export const api = {
  getAuthMe(): Promise<AuthContextResponse> {
    return requestJson<AuthContextResponse>('/auth/me');
  },

  login(username: string, password: string): Promise<{ token: string; user: UserSummary }> {
    return requestJson('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  logout(): Promise<{ ok: boolean }> {
    return requestJson('/auth/logout', { method: 'POST' });
  },

  updateMyAccount(input: UpdateMyAccountRequest): Promise<{ user: UserSummary }> {
    return requestJson('/auth/account', {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  getConfig(): Promise<MaskedServiceConfig> {
    return requestJson<MaskedServiceConfig>('/config');
  },

  saveConfig(input: ServiceConfigInput): Promise<MaskedServiceConfig> {
    return requestJson<MaskedServiceConfig>('/config', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  testLlmConfig(
    input: LlmTestRequest,
  ): Promise<{ ok: boolean; latencyMs: number; message: string; reasoning?: string }> {
    return requestJson('/config/test', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async testLlmConfigSse(
    input: LlmTestRequest,
    callbacks: {
      onProgress?: (message: string, step?: string) => void;
      onThinking?: (delta: string) => void;
      onContent?: (delta: string) => void;
    },
  ): Promise<{
    ok: boolean;
    latencyMs: number;
    message: string;
    reasoning?: string;
    replyPreview?: string;
  }> {
    const res = await fetch('/api/v1/config/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      credentials: 'include',
      body: JSON.stringify(input),
    });

    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok && !contentType.includes('text/event-stream')) {
      let msg = `校验失败 (HTTP ${res.status})`;
      let code = 'TEST_FAILED';
      try {
        const payload = (await res.json()) as {
          error?: { code?: string; message?: string };
          message?: string;
        };
        if (payload.error?.code) code = payload.error.code;
        if (payload.error?.message) msg = payload.error.message;
        else if (payload.message) msg = payload.message;
      } catch {
        // ignore
      }
      throw new ApiError(code, msg, res.status);
    }

    if (!contentType.includes('text/event-stream')) {
      return (await res.json()) as {
        ok: boolean;
        latencyMs: number;
        message: string;
        reasoning?: string;
        replyPreview?: string;
      };
    }

    let finalResult: {
      ok: boolean;
      latencyMs: number;
      message: string;
      reasoning?: string;
      replyPreview?: string;
    } | null = null;

    const handleBlock = (block: string) => {
      if (!block.trim()) return;
      let eventName = 'message';
      const dataLines: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }
      const rawData = dataLines.join('\n');
      if (!rawData) return;
      const parsed = JSON.parse(rawData) as Record<string, unknown>;
      if (eventName === 'progress' && typeof parsed.message === 'string') {
        callbacks.onProgress?.(
          parsed.message,
          typeof parsed.step === 'string' ? parsed.step : undefined,
        );
      } else if (eventName === 'thinking' && typeof parsed.delta === 'string') {
        callbacks.onThinking?.(parsed.delta);
      } else if (eventName === 'content' && typeof parsed.delta === 'string') {
        callbacks.onContent?.(parsed.delta);
      } else if (eventName === 'result') {
        finalResult = {
          ok: Boolean(parsed.ok),
          latencyMs: Number(parsed.latencyMs ?? 0),
          message: String(parsed.message ?? ''),
          reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
          replyPreview:
            typeof parsed.replyPreview === 'string' ? parsed.replyPreview : undefined,
        };
      }
    };

    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          handleBlock(block);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        for (const block of buffer.split(/\r?\n\r?\n/)) {
          handleBlock(block);
        }
      }
    } else {
      const text = await res.text();
      for (const block of text.split(/\r?\n\r?\n/)) {
        handleBlock(block);
      }
    }

    if (!finalResult) {
      throw new ApiError('EMPTY_STREAM', '未收到模型校验结果', 500);
    }
    return finalResult;
  },

  async testProxyConfig(
    input: ProxyTestRequest,
  ): Promise<{ ok: boolean; latencyMs: number; status?: number; message: string }> {
    const res = await fetch('/api/v1/config/proxy/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      latencyMs?: number;
      status?: number;
      message?: string;
      error?: { message?: string };
    };
    return {
      ok: Boolean(payload.ok),
      latencyMs: typeof payload.latencyMs === 'number' ? payload.latencyMs : 0,
      status: typeof payload.status === 'number' ? payload.status : res.status,
      message:
        payload.message ??
        payload.error?.message ??
        `代理测试返回 HTTP ${res.status}`,
    };
  },

  async testSearchConfig(input: SearchTestRequest): Promise<SearchTestResult> {
    const res = await fetch('/api/v1/config/search/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(input),
    });
    const payload = (await res.json().catch(() => ({}))) as Omit<
      Partial<SearchTestResult>,
      'error'
    > & {
      error?: string | { message?: string };
    };
    const errorMsg =
      typeof payload.error === 'string'
        ? payload.error
        : payload.error?.message;
    return {
      ok: Boolean(payload.ok),
      provider: payload.provider ?? input.provider,
      latencyMs: typeof payload.latencyMs === 'number' ? payload.latencyMs : 0,
      hitCount: typeof payload.hitCount === 'number' ? payload.hitCount : 0,
      sampleTitles: Array.isArray(payload.sampleTitles) ? payload.sampleTitles : [],
      layer1Reachable: payload.layer1Reachable,
      layer1Summary: payload.layer1Summary,
      message: payload.message ?? errorMsg ?? `搜索连通性测试返回 HTTP ${res.status}`,
      error: errorMsg,
    };
  },

  getAccessPolicy(): Promise<AccessPolicy> {
    return requestJson<AccessPolicy>('/admin/access-policy');
  },

  updateAccessPolicy(policy: AccessPolicy): Promise<AccessPolicy> {
    return requestJson<AccessPolicy>('/admin/access-policy', {
      method: 'PUT',
      body: JSON.stringify(policy),
    });
  },

  listUsers(): Promise<{ users: UserSummary[] }> {
    return requestJson('/admin/users');
  },

  createUser(input: CreateUserRequest): Promise<UserSummary> {
    return requestJson('/admin/users', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateUserPermissions(
    userId: string,
    input: UpdateUserPermissionsRequest,
  ): Promise<UserSummary> {
    return requestJson(`/admin/users/${encodeURIComponent(userId)}/permissions`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  deleteUser(userId: string): Promise<{ ok: boolean }> {
    return requestJson(`/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
  },

  listApiKeys(): Promise<{ keys: ExternalApiKeySummary[] }> {
    return requestJson('/admin/api-keys');
  },

  createApiKey(
    name: string,
    scopes: string[],
  ): Promise<{ id: string; name: string; apiKey: string; scopes: string[] }> {
    return requestJson('/admin/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name, scopes }),
    });
  },

  deleteApiKey(id: string): Promise<{ ok: boolean }> {
    return requestJson(`/admin/api-keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  listCards(params: {
    q?: string;
    tags?: string[];
    cardType?: CardType | '';
    mode?: GenerationMode | '';
    page?: number;
    pageSize?: number;
  }): Promise<CardListResponse> {
    const qs = new URLSearchParams();
    if (params.q?.trim()) qs.set('q', params.q.trim());
    if (params.tags && params.tags.length > 0) qs.set('tags', params.tags.join(','));
    if (params.cardType) qs.set('cardType', params.cardType);
    if (params.mode) qs.set('mode', params.mode);
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    const queryStr = qs.toString();
    return requestJson<CardListResponse>(`/cards${queryStr ? `?${queryStr}` : ''}`);
  },

  getCard(id: string): Promise<{ card: RoleCardDto }> {
    return requestJson(`/cards/${encodeURIComponent(id)}`);
  },

  async generateCardSse(
    input: GenerateCardRequest,
    callbacks: {
      onProgress?: (message: string, step?: string) => void;
      onThinking?: (delta: string) => void;
    },
  ): Promise<RoleCardDto> {
    const res = await consumeSsePost<{ card: RoleCardDto }>(
      '/generate',
      input,
      callbacks,
      '生成失败',
    );
    return res.card;
  },

  updateCardContent(id: string, input: UpdateCardContentRequest): Promise<{ card: RoleCardDto }> {
    return requestJson(`/cards/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  updateCardTags(id: string, tags: string[]): Promise<{ id: string; tags: string[] }> {
    return requestJson(`/cards/${encodeURIComponent(id)}/tags`, {
      method: 'PATCH',
      body: JSON.stringify({ tags }),
    });
  },

  refineCard(
    id: string,
    instruction: string,
    sourceIndices?: number[],
  ): Promise<{ card: RoleCardDto; diffSummary: string }> {
    return requestJson(`/cards/${encodeURIComponent(id)}/refine`, {
      method: 'POST',
      body: JSON.stringify({
        instruction,
        ...(sourceIndices && sourceIndices.length > 0 ? { sourceIndices } : {}),
      }),
    });
  },

  refineCardSse(
    id: string,
    instruction: string,
    sourceIndices: number[] | undefined,
    callbacks: {
      onProgress?: (message: string, step?: string) => void;
      onThinking?: (delta: string) => void;
    },
  ): Promise<{ card: RoleCardDto; diffSummary: string }> {
    return consumeSsePost<{ card: RoleCardDto; diffSummary: string }>(
      `/cards/${encodeURIComponent(id)}/refine`,
      {
        instruction,
        ...(sourceIndices && sourceIndices.length > 0 ? { sourceIndices } : {}),
      },
      callbacks,
      'AI 微调失败',
    );
  },

  compressCard(
    id: string,
    targetMaxTokens = 1200,
  ): Promise<{ card: RoleCardDto; beforeTokens: number; afterTokens: number }> {
    return requestJson(`/cards/${encodeURIComponent(id)}/compress`, {
      method: 'POST',
      body: JSON.stringify({ targetMaxTokens }),
    });
  },

  playtestCard(id: string, input: PlaytestRequest): Promise<PlaytestResponse> {
    return requestJson(`/cards/${encodeURIComponent(id)}/playtest`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  adoptMesExample(
    id: string,
    userMessage: string,
    assistantMessage: string,
  ): Promise<{ card: RoleCardDto }> {
    return requestJson(`/cards/${encodeURIComponent(id)}/mes-example`, {
      method: 'POST',
      body: JSON.stringify({ userMessage, assistantMessage }),
    });
  },

  uploadCardImage(id: string, input: CardImageUploadRequest): Promise<{ card: RoleCardDto }> {
    return requestJson(`/cards/${encodeURIComponent(id)}/image`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  deleteCard(id: string): Promise<{ ok: boolean }> {
    return requestJson(`/cards/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  getExportUrl(id: string, format: ExportFormat): string {
    return `/api/v1/cards/${encodeURIComponent(id)}/export?format=${encodeURIComponent(format)}`;
  },

  getPortraitSourceUrl(id: string): string {
    return `/api/v1/cards/${encodeURIComponent(id)}/portrait-source`;
  },

  getImageProxyUrl(url: string): string {
    return `/api/v1/images/proxy?url=${encodeURIComponent(url)}`;
  },

  resolveImageDisplayUrl(url: string | null | undefined): string | null {
    const trimmed = url?.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) {
      return `/api/v1/images/proxy?url=${encodeURIComponent(trimmed)}`;
    }
    return trimmed;
  },

  generateCardTrpgStats(
    id: string,
    system: 'coc7e' | 'dnd5e',
  ): Promise<{ card: RoleCardDto }> {
    return requestJson(`/cards/${encodeURIComponent(id)}/trpg`, {
      method: 'POST',
      body: JSON.stringify({ system }),
    });
  },

  generateCardTrpgStatsSse(
    id: string,
    system: 'coc7e' | 'dnd5e',
    callbacks: {
      onProgress?: (message: string, step?: string) => void;
      onThinking?: (delta: string) => void;
    },
  ): Promise<{ card: RoleCardDto }> {
    return consumeSsePost<{ card: RoleCardDto }>(
      `/cards/${encodeURIComponent(id)}/trpg`,
      { system },
      callbacks,
      'TRPG 规则属性推演失败',
    );
  },

  regenerateCardSse(
    id: string,
    input: Partial<RegenerateCardRequest>,
    callbacks: {
      onProgress?: (message: string, step?: string) => void;
      onThinking?: (delta: string) => void;
    },
  ): Promise<{
    card: RoleCardDto;
    regeneratedFields: string[];
    skippedLockedFields: string[];
    diffSummary: string;
  }> {
    return consumeSsePost<{
      card: RoleCardDto;
      regeneratedFields: string[];
      skippedLockedFields: string[];
      diffSummary: string;
    }>(
      `/cards/${encodeURIComponent(id)}/regenerate`,
      {
        instruction: input.instruction ?? '',
        ...(input.sourceIndices && input.sourceIndices.length > 0
          ? { sourceIndices: input.sourceIndices }
          : {}),
      },
      callbacks,
      '一键 AI 生成失败',
    );
  },

  listCardRevisions(id: string): Promise<{ revisions: CardRevisionSummary[] }> {
    return requestJson(`/cards/${encodeURIComponent(id)}/revisions`);
  },

  rollbackCardRevision(
    id: string,
    revisionId?: string,
  ): Promise<{ card: RoleCardDto; restoredRevisionId: string }> {
    return requestJson(`/cards/${encodeURIComponent(id)}/rollback`, {
      method: 'POST',
      body: JSON.stringify(revisionId ? { revisionId } : {}),
    });
  },

  generateCardField(
    id: string,
    input: Omit<GenerateCardFieldRequest, 'instruction'> & { instruction?: string },
  ): Promise<{
    card: RoleCardDto;
    field: CardGeneratableField;
    fieldLabel: string;
    diffSummary: string;
  }> {
    return requestJson(`/cards/${encodeURIComponent(id)}/generate-field`, {
      method: 'POST',
      body: JSON.stringify({
        field: input.field,
        instruction: input.instruction ?? '',
        ...(input.sourceIndices && input.sourceIndices.length > 0
          ? { sourceIndices: input.sourceIndices }
          : {}),
      }),
    });
  },

  generateCardFieldSse(
    id: string,
    input: Omit<GenerateCardFieldRequest, 'instruction'> & { instruction?: string },
    callbacks: {
      onProgress?: (message: string, step?: string) => void;
      onThinking?: (delta: string) => void;
    },
  ): Promise<{
    card: RoleCardDto;
    field: CardGeneratableField;
    fieldLabel: string;
    diffSummary: string;
  }> {
    return consumeSsePost<{
      card: RoleCardDto;
      field: CardGeneratableField;
      fieldLabel: string;
      diffSummary: string;
    }>(
      `/cards/${encodeURIComponent(id)}/generate-field`,
      {
        field: input.field,
        instruction: input.instruction ?? '',
        ...(input.sourceIndices && input.sourceIndices.length > 0
          ? { sourceIndices: input.sourceIndices }
          : {}),
      },
      callbacks,
      '单区块 AI 生成失败',
    );
  },

  addCardSources(
    id: string,
    input: Partial<AddCardSourcesRequest>,
  ): Promise<{
    card: RoleCardDto;
    addedCount: number;
    failedUrls: Array<{ url: string; message: string }>;
  }> {
    return requestJson(`/cards/${encodeURIComponent(id)}/sources`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  deleteCardSource(
    id: string,
    index: number,
  ): Promise<{ card: RoleCardDto; removed: SourceEntry }> {
    return requestJson(`/cards/${encodeURIComponent(id)}/sources/${index}`, {
      method: 'DELETE',
    });
  },

  searchCardSources(
    id: string,
    input: SearchCardSourcesRequest,
  ): Promise<SearchCardSourcesResponse & { card: RoleCardDto }> {
    return requestJson(`/cards/${encodeURIComponent(id)}/sources/search`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  importCard(input: ImportCardRequest): Promise<{
    card: RoleCardDto;
    upgradedFrom: string;
    importedLorebookId: string | null;
  }> {
    return requestJson('/cards/import', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  listLorebooks(): Promise<{ items: LorebookDto[] }> {
    return requestJson('/lorebooks');
  },

  createLorebook(input: CreateLorebookRequest): Promise<{ lorebook: LorebookDto }> {
    return requestJson('/lorebooks', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateLorebook(id: string, input: UpdateLorebookRequest): Promise<{ lorebook: LorebookDto }> {
    return requestJson(`/lorebooks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  deleteLorebook(id: string): Promise<{ ok: boolean }> {
    return requestJson(`/lorebooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  linkCardToLorebook(
    lorebookId: string,
    input: LinkCharacterToLorebookRequest,
  ): Promise<{ lorebook: LorebookDto; generatedEntry: LorebookEntry }> {
    return requestJson(`/lorebooks/${encodeURIComponent(lorebookId)}/link-card`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  unlinkCardFromLorebook(lorebookId: string, cardId: string): Promise<{ lorebook: LorebookDto }> {
    return requestJson(
      `/lorebooks/${encodeURIComponent(lorebookId)}/links/${encodeURIComponent(cardId)}`,
      { method: 'DELETE' },
    );
  },

  getLorebookExportUrl(id: string): string {
    return `/api/v1/lorebooks/${encodeURIComponent(id)}/export`;
  },

  listPlugins(): Promise<{ plugins: DeclarativePluginManifest[] }> {
    return requestJson('/plugins');
  },

  validatePlugin(manifest: unknown): Promise<{ valid: boolean; manifest: DeclarativePluginManifest }> {
    return requestJson('/plugins/validate', {
      method: 'POST',
      body: JSON.stringify(manifest),
    });
  },

  getPluginExportUrl(pluginId: string, cardId: string): string {
    return `/api/v1/plugins/${encodeURIComponent(pluginId)}/export/${encodeURIComponent(cardId)}`;
  },

  getCardSchedule(cardId: string): Promise<{ schedule: SyncScheduleDto }> {
    return requestJson(`/cards/${encodeURIComponent(cardId)}/schedule`);
  },

  updateCardSchedule(
    cardId: string,
    input: UpdateScheduleRequest,
  ): Promise<{ schedule: SyncScheduleDto }> {
    return requestJson(`/cards/${encodeURIComponent(cardId)}/schedule`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  updateMetaSettings(
    cardId: string,
    input: UpdateMetaSettingsRequest,
  ): Promise<{ card: RoleCardDto }> {
    return requestJson(`/cards/${encodeURIComponent(cardId)}/meta-settings`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  evolveCard(cardId: string): Promise<{
    skipped: boolean;
    reason?: string;
    impressionId?: string;
    autoApplied?: boolean;
    ripplesCreated?: number;
  }> {
    return requestJson(`/cards/${encodeURIComponent(cardId)}/evolve`, {
      method: 'POST',
    });
  },

  triggerEvolutionTick(): Promise<{ checked: number; evolved: number; skipped: number }> {
    return requestJson('/evolution/tick', { method: 'POST' });
  },

  listReviews(): Promise<{
    impressions: ImpressionEventDto[];
    ripples: RippleProposalDto[];
  }> {
    return requestJson('/reviews');
  },

  resolveImpression(
    id: string,
    input: ResolveProposalRequest,
  ): Promise<{ ok: boolean; status: string; ripplesCreated?: number }> {
    return requestJson(`/reviews/impressions/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  resolveRipple(
    id: string,
    input: ResolveProposalRequest,
  ): Promise<{ ok: boolean; status: string }> {
    return requestJson(`/reviews/ripples/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  listSyncEvents(sinceCursor = 0, limit = 50): Promise<{
    items: SyncEventDto[];
    nextCursor: number;
  }> {
    return requestJson(`/sync/events?since_cursor=${sinceCursor}&limit=${limit}`);
  },

  listSyncSubscriptions(): Promise<{ items: SyncSubscriptionDto[] }> {
    return requestJson('/sync/subscriptions');
  },

  createSyncSubscription(
    input: CreateSyncSubscriptionRequest,
  ): Promise<{ subscription: SyncSubscriptionDto; secret: string }> {
    return requestJson('/sync/subscriptions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  deleteSyncSubscription(id: string): Promise<{ ok: boolean }> {
    return requestJson(`/sync/subscriptions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  listNotificationChannels(): Promise<{ items: NotificationChannelDto[] }> {
    return requestJson('/notifications/channels');
  },

  createNotificationChannel(
    input: UpsertNotificationChannelRequest,
  ): Promise<{ channel: NotificationChannelDto }> {
    return requestJson('/notifications/channels', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updateNotificationChannel(
    id: string,
    input: UpsertNotificationChannelRequest,
  ): Promise<{ channel: NotificationChannelDto }> {
    return requestJson(`/notifications/channels/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  testNotificationChannel(id: string): Promise<{ ok: boolean; message: string }> {
    return requestJson(`/notifications/channels/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    });
  },

  deleteNotificationChannel(id: string): Promise<{ ok: boolean }> {
    return requestJson(`/notifications/channels/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  analyzeVision(input: VisionAnalyzeRequest): Promise<VisionAnalyzeResponse> {
    return requestJson('/vision/analyze', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  searchImages(input: ImageSearchRequest): Promise<{ items: ImageSearchItem[] }> {
    return requestJson('/images/search', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  listPortraitStyles(): Promise<{ styles: PortraitStylePresetDto[] }> {
    return requestJson('/images/styles');
  },

  createPortraitStyle(
    input: CreatePortraitStylePresetInput,
  ): Promise<{ style: PortraitStylePresetDto }> {
    return requestJson('/images/styles', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  updatePortraitStyle(
    id: string,
    input: UpdatePortraitStylePresetInput,
  ): Promise<{ style: PortraitStylePresetDto }> {
    return requestJson(`/images/styles/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  resetPortraitStyle(id: string): Promise<{ style: PortraitStylePresetDto }> {
    return requestJson(`/images/styles/${encodeURIComponent(id)}/reset`, {
      method: 'POST',
    });
  },

  deletePortraitStyle(id: string): Promise<{ ok: boolean; id: string }> {
    return requestJson(`/images/styles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  generatePortraitPrompt(input: PortraitPromptRequest): Promise<PortraitPromptResponse> {
    return requestJson('/images/prompt', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  generateImage(
    input: ImageGenerateRequest,
  ): Promise<{ dataUrl?: string; imageUrl?: string }> {
    return requestJson('/images/generate', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
};
