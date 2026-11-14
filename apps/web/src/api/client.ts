import type {
  AccessPolicy,
  AuthContextResponse,
  CardImageUploadRequest,
  CardType,
  CreateUserRequest,
  DeclarativePluginManifest,
  ExportFormat,
  GenerateCardRequest,
  GenerationMode,
  ImportCardRequest,
  LinkCharacterToLorebookRequest,
  LlmTestRequest,
  LorebookDto,
  LorebookEntry,
  MaskedServiceConfig,
  PlaytestRequest,
  PlaytestResponse,
  PublishStatus,
  RoleCardContent,
  ServiceConfigInput,
  SourceEntry,
  UpdateCardContentRequest,
  UpdateLorebookRequest,
  CreateLorebookRequest,
  UpdateUserPermissionsRequest,
  UserSummary,
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
  imageSource: string | null;
  lockedFields: string[];
  diffSummary: string | null;
  enableMetaInChat: boolean;
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
  ): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    return requestJson('/config/test', {
      method: 'POST',
      body: JSON.stringify(input),
    });
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
    onProgress: (message: string) => void,
  ): Promise<RoleCardDto> {
    const res = await fetch('/api/v1/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      credentials: 'include',
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      let msg = `生成失败 (HTTP ${res.status})`;
      let code = 'GENERATE_FAILED';
      try {
        const payload = (await res.json()) as { error?: { code?: string; message?: string } };
        if (payload.error?.code) code = payload.error.code;
        if (payload.error?.message) msg = payload.error.message;
      } catch {
        // ignore
      }
      throw new ApiError(code, msg, res.status);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      const json = (await res.json()) as { card: RoleCardDto };
      return json.card;
    }

    const text = await res.text();
    const blocks = text.split(/\r?\n\r?\n/);
    let finalCard: RoleCardDto | null = null;

    for (const block of blocks) {
      if (!block.trim()) continue;
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
      if (!rawData) continue;
      const parsed = JSON.parse(rawData) as Record<string, unknown>;
      if (eventName === 'progress' && typeof parsed.message === 'string') {
        onProgress(parsed.message);
      } else if (eventName === 'error') {
        throw new ApiError(
          String(parsed.code ?? 'GENERATE_FAILED'),
          String(parsed.message ?? '生成失败'),
          Number(parsed.status ?? 400),
        );
      } else if (eventName === 'result' && parsed.card) {
        finalCard = parsed.card as RoleCardDto;
      }
    }

    if (!finalCard) {
      throw new ApiError('EMPTY_STREAM', '未收到生成结果，请检查后端日志', 500);
    }
    return finalCard;
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
  ): Promise<{ card: RoleCardDto; diffSummary: string }> {
    return requestJson(`/cards/${encodeURIComponent(id)}/refine`, {
      method: 'POST',
      body: JSON.stringify({ instruction }),
    });
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
};
