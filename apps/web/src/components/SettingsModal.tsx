import { useEffect, useState } from 'react';
import {
  ALL_PERMISSIONS,
  LLM_PROVIDER_DEFAULTS,
  PERMISSION_LABELS,
  type AccessPolicy,
  type AuthContextResponse,
  type JsonModeStrategy,
  type LlmProvider,
  type LlmSlotInput,
  type MaskedServiceConfig,
  type Permission,
  type SearchProvider,
  type UserSummary,
} from '@rolecard/shared';
import {
  CheckCircle2,
  Copy,
  Key,
  Loader2,
  Plus,
  Settings,
  Shield,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api, type ExternalApiKeySummary } from '../api/client';

interface SettingsModalProps {
  open: boolean;
  config: MaskedServiceConfig | null;
  auth: AuthContextResponse | null;
  onClose: () => void;
  onSavedConfig: (cfg: MaskedServiceConfig) => void;
  onPolicyUpdated: () => void;
}

type SettingsTab = 'models' | 'search' | 'access' | 'users' | 'apikeys';

interface SlotFormState {
  enabled: boolean;
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  jsonModeStrategy: JsonModeStrategy;
  maskedHint: string | null;
}

function makeSlotForm(
  slot: MaskedServiceConfig['primaryLlm'],
  enabled: boolean,
): SlotFormState {
  const provider = slot?.provider ?? 'deepseek';
  const defaults = LLM_PROVIDER_DEFAULTS[provider];
  return {
    enabled,
    provider,
    apiKey: '',
    baseUrl: slot?.baseUrl ?? defaults.baseUrl,
    model: slot?.model ?? defaults.defaultModel,
    jsonModeStrategy: slot?.jsonModeStrategy ?? 'auto',
    maskedHint: slot?.apiKeyMasked ?? null,
  };
}

export function SettingsModal({
  open,
  config,
  auth,
  onClose,
  onSavedConfig,
  onPolicyUpdated,
}: SettingsModalProps) {
  const isAdmin = auth?.user?.role === 'admin';
  const [tab, setTab] = useState<SettingsTab>('models');

  const [primary, setPrimary] = useState<SlotFormState>(() => makeSlotForm(null, true));
  const [chatSlot, setChatSlot] = useState<SlotFormState>(() => makeSlotForm(null, false));
  const [visionSlot, setVisionSlot] = useState<SlotFormState>(() => makeSlotForm(null, false));
  const [searchProvider, setSearchProvider] = useState<SearchProvider>('none');
  const [searchApiKey, setSearchApiKey] = useState('');
  const [searchMasked, setSearchMasked] = useState<string | null>(null);
  const [enableLayer1Wiki, setEnableLayer1Wiki] = useState(true);
  const [dailyAutoRefreshLimit, setDailyAutoRefreshLimit] = useState(20);
  const [customSystemPrompt, setCustomSystemPrompt] = useState('');

  const [policy, setPolicy] = useState<AccessPolicy>({
    siteAccessMode: 'public',
    apiAccessMode: 'authenticated',
    guestPermissions: ['card:read'],
  });
  const [usersList, setUsersList] = useState<UserSummary[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newUserPerms, setNewUserPerms] = useState<Permission[]>(['card:read', 'card:create']);

  const [apiKeys, setApiKeys] = useState<ExternalApiKeySummary[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdPlainKey, setCreatedPlainKey] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [testStatus, setTestStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBanner(null);
    setError(null);
    setTestStatus(null);
    setCreatedPlainKey(null);

    if (config) {
      setPrimary(makeSlotForm(config.primaryLlm, true));
      setChatSlot(makeSlotForm(config.chatLlm, Boolean(config.chatLlm)));
      setVisionSlot(makeSlotForm(config.visionLlm, Boolean(config.visionLlm)));
      setSearchProvider(config.searchProvider);
      setSearchApiKey('');
      setSearchMasked(config.searchApiKeyMasked);
      setEnableLayer1Wiki(config.enableLayer1Wiki);
      setDailyAutoRefreshLimit(config.dailyAutoRefreshLimit);
      setCustomSystemPrompt(config.customSystemPrompt);
    }

    if (isAdmin) {
      void (async () => {
        try {
          const [p, u, k] = await Promise.all([
            api.getAccessPolicy(),
            api.listUsers(),
            api.listApiKeys(),
          ]);
          setPolicy(p);
          setUsersList(u.users);
          setApiKeys(k.keys);
        } catch {
          // ignore if unauthorized
        }
      })();
    }
  }, [open, config, isAdmin]);

  if (!open) return null;

  const toSlotInput = (s: SlotFormState): LlmSlotInput => ({
    provider: s.provider,
    apiKey: s.apiKey.trim() || undefined,
    baseUrl: s.baseUrl.trim() || undefined,
    model: s.model.trim(),
    jsonModeStrategy: s.jsonModeStrategy,
  });

  const handleSaveConfig = async () => {
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      const saved = await api.saveConfig({
        primaryLlm: toSlotInput(primary),
        chatLlm: chatSlot.enabled ? toSlotInput(chatSlot) : undefined,
        visionLlm: visionSlot.enabled ? toSlotInput(visionSlot) : undefined,
        searchProvider,
        searchApiKey: searchApiKey.trim() || undefined,
        enableLayer1Wiki,
        dailyAutoRefreshLimit,
        customSystemPrompt,
      });
      onSavedConfig(saved);
      setBanner('大模型与检索配置已加密保存');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存配置失败');
    } finally {
      setBusy(false);
    }
  };

  const handleTestLlm = async () => {
    setBusy(true);
    setTestStatus(null);
    try {
      const res = await api.testLlmConfig({
        provider: primary.provider,
        apiKey: primary.apiKey.trim() || undefined,
        baseUrl: primary.baseUrl.trim() || undefined,
        model: primary.model.trim(),
        useSavedKeySlot: primary.apiKey.trim() ? undefined : 'primary',
      });
      setTestStatus({
        ok: res.ok,
        message: `${res.message} (${res.latencyMs}ms)`,
      });
    } catch (err) {
      setTestStatus({
        ok: false,
        message: err instanceof Error ? err.message : '连通性测试失败',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSavePolicy = async () => {
    setBusy(true);
    setError(null);
    setBanner(null);
    try {
      const updated = await api.updateAccessPolicy(policy);
      setPolicy(updated);
      onPolicyUpdated();
      setBanner('站点与对外 API 访问策略已更新');
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新策略失败');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateUser = async () => {
    if (!newUsername.trim() || newPassword.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createUser({
        username: newUsername.trim(),
        password: newPassword,
        role: 'user',
        permissions: newUserPerms,
      });
      setUsersList((prev) => [created, ...prev]);
      setNewUsername('');
      setNewPassword('');
      setBanner(`已创建用户 ${created.username}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建用户失败');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleUserPerm = async (user: UserSummary, perm: Permission) => {
    const next = user.permissions.includes(perm)
      ? user.permissions.filter((p) => p !== perm)
      : [...user.permissions, perm];
    try {
      const updated = await api.updateUserPermissions(user.id, { permissions: next });
      setUsersList((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新权限失败');
    }
  };

  const handleDeleteUser = async (user: UserSummary) => {
    try {
      await api.deleteUser(user.id);
      setUsersList((prev) => prev.filter((u) => u.id !== user.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除用户失败');
    }
  };

  const handleCreateApiKey = async () => {
    if (!newKeyName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createApiKey(newKeyName.trim(), ['*']);
      setCreatedPlainKey(res.apiKey);
      setNewKeyName('');
      const refreshed = await api.listApiKeys();
      setApiKeys(refreshed.keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成 Key 失败');
    } finally {
      setBusy(false);
    }
  };

  const renderSlotEditor = (
    title: string,
    slot: SlotFormState,
    setSlot: (next: SlotFormState) => void,
    optional: boolean,
  ) => (
    <div className="rounded-md border border-line bg-canvas p-3.5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-content-primary">{title}</span>
        {optional && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-content-secondary">
            <input
              type="checkbox"
              checked={slot.enabled}
              onChange={(e) => setSlot({ ...slot, enabled: e.target.checked })}
              className="accent-accent"
            />
            启用独立配置
          </label>
        )}
      </div>

      {(!optional || slot.enabled) && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] text-content-secondary">服务商</label>
            <select
              value={slot.provider}
              onChange={(e) => {
                const p = e.target.value as LlmProvider;
                const d = LLM_PROVIDER_DEFAULTS[p];
                setSlot({
                  ...slot,
                  provider: p,
                  baseUrl: d.baseUrl,
                  model: d.defaultModel,
                });
              }}
              className="h-8 w-full rounded-sm border border-line bg-surface px-2 text-xs text-content-primary"
            >
              {(Object.keys(LLM_PROVIDER_DEFAULTS) as LlmProvider[]).map((key) => (
                <option key={key} value={key}>
                  {LLM_PROVIDER_DEFAULTS[key].label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-content-secondary">模型 ID</label>
            <input
              type="text"
              value={slot.model}
              onChange={(e) => setSlot({ ...slot, model: e.target.value })}
              className="h-8 w-full rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-content-secondary">
              API Key {slot.maskedHint ? `(已存: ${slot.maskedHint})` : ''}
            </label>
            <input
              type="password"
              value={slot.apiKey}
              onChange={(e) => setSlot({ ...slot, apiKey: e.target.value })}
              placeholder={slot.maskedHint ? '留空沿用已加密 Key' : '输入 API Key'}
              className="h-8 w-full rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-content-secondary">Base URL</label>
            <input
              type="text"
              value={slot.baseUrl}
              onChange={(e) => setSlot({ ...slot, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className="h-8 w-full rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
            />
          </div>
        </div>
      )}
    </div>
  );

  const tabs: { id: SettingsTab; label: string; adminOnly?: boolean }[] = [
    { id: 'models', label: '大模型配置' },
    { id: 'search', label: '检索与提示词' },
    { id: 'access', label: '访问策略', adminOnly: true },
    { id: 'users', label: '用户权限', adminOnly: true },
    { id: 'apikeys', label: '外部 API Key', adminOnly: true },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border border-line bg-elevated shadow-2xl">
        <div className="flex items-center justify-between border-b border-line-subtle px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-content-primary">模型与系统设置中心</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm p-1 text-content-muted hover:bg-subtle hover:text-content-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 5 Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-line-subtle px-5">
          {tabs
            .filter((t) => !t.adminOnly || isAdmin)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-medium transition ${
                  tab === t.id
                    ? 'border-accent text-accent'
                    : 'border-transparent text-content-secondary hover:text-content-primary'
                }`}
              >
                {t.label}
              </button>
            ))}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {banner && (
            <div className="flex items-center gap-2 rounded-sm border border-status-success/40 bg-status-success/10 px-3 py-2 text-xs text-status-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {banner}
            </div>
          )}
          {error && (
            <div className="rounded-sm border border-status-danger/40 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">
              {error}
            </div>
          )}

          {tab === 'models' && (
            <div className="space-y-3.5">
              {renderSlotEditor('1. 主生成模型 (Primary LLM)', primary, setPrimary, false)}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleTestLlm}
                  className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-xs font-medium text-content-primary hover:bg-subtle disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  测试主模型连通性
                </button>
                {testStatus && (
                  <span
                    className={`text-xs ${
                      testStatus.ok ? 'text-status-success' : 'text-status-danger'
                    }`}
                  >
                    {testStatus.message}
                  </span>
                )}
              </div>
              {renderSlotEditor('2. 试聊沙盒模型 (Chat LLM · 可选)', chatSlot, setChatSlot, true)}
              {renderSlotEditor('3. 视觉识别模型 (Vision LLM · 可选)', visionSlot, setVisionSlot, true)}
            </div>
          )}

          {tab === 'search' && (
            <div className="space-y-3.5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-content-secondary">
                    Layer 2 商业搜索服务（可选）
                  </label>
                  <select
                    value={searchProvider}
                    onChange={(e) => setSearchProvider(e.target.value as SearchProvider)}
                    className="h-9 w-full rounded-sm border border-line bg-surface px-2.5 text-xs text-content-primary"
                  >
                    <option value="none">仅用免 Key Layer 1 公开百科</option>
                    <option value="bocha">博查 AI 搜索 (Bocha)</option>
                    <option value="tavily">Tavily Search</option>
                    <option value="serpapi">SerpAPI</option>
                    <option value="bing">Bing Web Search</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-content-secondary">
                    Search API Key {searchMasked ? `(已存: ${searchMasked})` : ''}
                  </label>
                  <input
                    type="password"
                    value={searchApiKey}
                    onChange={(e) => setSearchApiKey(e.target.value)}
                    placeholder="留空沿用已有 Key"
                    className="h-9 w-full rounded-sm border border-line bg-surface px-2.5 font-mono text-xs text-content-primary"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-canvas p-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-content-primary">
                  <input
                    type="checkbox"
                    checked={enableLayer1Wiki}
                    onChange={(e) => setEnableLayer1Wiki(e.target.checked)}
                    className="accent-accent"
                  />
                  启用 Layer 1 免 Key 百科检索（萌娘百科 / PRTS / Wikipedia）
                </label>

                <div className="flex items-center gap-2 text-xs">
                  <span className="text-content-secondary">每日定时演化配额上限</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={dailyAutoRefreshLimit}
                    onChange={(e) => setDailyAutoRefreshLimit(Number(e.target.value))}
                    className="h-7 w-16 rounded-sm border border-line bg-surface px-2 text-center font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-content-secondary">
                  全局附加系统提示词 (Custom System Prompt)
                </label>
                <textarea
                  rows={4}
                  value={customSystemPrompt}
                  onChange={(e) => setCustomSystemPrompt(e.target.value)}
                  placeholder="例如：输出中文风格偏向细腻文学化，人物对话避免过度使用感叹号。"
                  className="w-full rounded-sm border border-line bg-surface p-2.5 text-xs text-content-primary"
                />
              </div>
            </div>
          )}

          {tab === 'access' && isAdmin && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-line bg-canvas p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-content-primary">
                    <Shield className="h-3.5 w-3.5 text-accent" />
                    站点访问模式
                  </div>
                  <select
                    value={policy.siteAccessMode}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        siteAccessMode: e.target.value as AccessPolicy['siteAccessMode'],
                      })
                    }
                    className="h-8 w-full rounded-sm border border-line bg-surface px-2 text-xs"
                  >
                    <option value="public">公开模式 (Public)</option>
                    <option value="login_required">必须登录访问 (Login Required)</option>
                  </select>
                </div>

                <div className="rounded-md border border-line bg-canvas p-3">
                  <div className="mb-2 text-xs font-semibold text-content-primary">
                    对外 API 访问状态
                  </div>
                  <select
                    value={policy.apiAccessMode}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        apiAccessMode: e.target.value as AccessPolicy['apiAccessMode'],
                      })
                    }
                    className="h-8 w-full rounded-sm border border-line bg-surface px-2 text-xs"
                  >
                    <option value="authenticated">鉴权模式 (Bearer API Key)</option>
                    <option value="public">公开只读模式 (Public)</option>
                  </select>
                </div>
              </div>

              <div className="rounded-md border border-line bg-canvas p-3">
                <div className="mb-2 text-xs font-semibold text-content-primary">
                  未登录访客权限（仅在站点公开模式生效）
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {ALL_PERMISSIONS.map((perm) => (
                    <label
                      key={perm}
                      className="flex cursor-pointer items-center gap-2 text-xs text-content-secondary"
                    >
                      <input
                        type="checkbox"
                        checked={policy.guestPermissions.includes(perm)}
                        onChange={() => {
                          const exists = policy.guestPermissions.includes(perm);
                          setPolicy({
                            ...policy,
                            guestPermissions: exists
                              ? policy.guestPermissions.filter((p) => p !== perm)
                              : [...policy.guestPermissions, perm],
                          });
                        }}
                        className="accent-accent"
                      />
                      <span>{PERMISSION_LABELS[perm].label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'users' && isAdmin && (
            <div className="space-y-4">
              <div className="rounded-md border border-line bg-canvas p-3.5">
                <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold text-content-primary">
                  <Users className="h-3.5 w-3.5 text-accent" />
                  新增普通用户并分配权限
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="用户名"
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 text-xs"
                  />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="初始密码（至少6位）"
                    className="h-8 rounded-sm border border-line bg-surface px-2.5 text-xs"
                  />
                  <button
                    type="button"
                    disabled={busy || !newUsername.trim() || newPassword.length < 6}
                    onClick={handleCreateUser}
                    className="inline-flex h-8 items-center justify-center gap-1 rounded-sm bg-accent text-xs font-medium text-content-inverse disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    创建用户
                  </button>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {ALL_PERMISSIONS.map((perm) => (
                    <label key={perm} className="flex cursor-pointer items-center gap-1 text-[11px]">
                      <input
                        type="checkbox"
                        checked={newUserPerms.includes(perm)}
                        onChange={() =>
                          setNewUserPerms((prev) =>
                            prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm],
                          )
                        }
                        className="accent-accent"
                      />
                      {PERMISSION_LABELS[perm].label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                {usersList.map((u) => (
                  <div key={u.id} className="rounded-md border border-line bg-canvas p-3 text-xs">
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-content-primary">{u.username}</span>
                        <span className="ml-2 rounded bg-subtle px-1.5 py-0.5 text-[10.5px] text-content-secondary">
                          {u.role === 'admin' ? '管理员（全量权限）' : '普通用户'}
                        </span>
                      </div>
                      {u.role !== 'admin' && (
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(u)}
                          className="text-content-muted hover:text-status-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {u.role !== 'admin' && (
                      <div className="flex flex-wrap gap-2">
                        {ALL_PERMISSIONS.map((perm) => (
                          <label
                            key={perm}
                            className="flex cursor-pointer items-center gap-1 text-[11px] text-content-secondary"
                          >
                            <input
                              type="checkbox"
                              checked={u.permissions.includes(perm)}
                              onChange={() => handleToggleUserPerm(u, perm)}
                              className="accent-accent"
                            />
                            {PERMISSION_LABELS[perm].label}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'apikeys' && isAdmin && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="API Key 备注名称（如：SillyTavern 扩展）"
                  className="h-8 flex-1 rounded-sm border border-line bg-surface px-2.5 text-xs"
                />
                <button
                  type="button"
                  disabled={busy || !newKeyName.trim()}
                  onClick={handleCreateApiKey}
                  className="inline-flex h-8 items-center gap-1 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse disabled:opacity-50"
                >
                  <Key className="h-3.5 w-3.5" />
                  生成 Key
                </button>
              </div>

              {createdPlainKey && (
                <div className="flex items-center justify-between gap-2 rounded-md border border-status-warning/50 bg-status-warning/10 p-3 text-xs">
                  <div>
                    <div className="font-semibold text-status-warning">
                      请立即复制保存（明文仅展示这一次）：
                    </div>
                    <code className="mt-1 block font-mono text-content-primary">
                      {createdPlainKey}
                    </code>
                  </div>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(createdPlainKey)}
                    className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface px-2 py-1 text-[11px]"
                  >
                    <Copy className="h-3 w-3" />
                    复制
                  </button>
                </div>
              )}

              <div className="space-y-2">
                {apiKeys.map((k) => (
                  <div
                    key={k.id}
                    className="flex items-center justify-between rounded-md border border-line bg-canvas px-3 py-2 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-content-primary">{k.name}</span>
                      <span className="ml-2 font-mono text-[11px] text-content-muted">
                        限流 {k.rateLimitPerMin}/min · {k.rateLimitPerDay}/day
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.deleteApiKey(k.id);
                        setApiKeys((prev) => prev.filter((x) => x.id !== k.id));
                      }}
                      className="text-content-muted hover:text-status-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line-subtle px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-sm border border-line bg-surface px-3 text-xs font-medium text-content-secondary hover:bg-subtle"
          >
            关闭
          </button>
          {(tab === 'models' || tab === 'search') && (
            <button
              type="button"
              disabled={busy}
              onClick={handleSaveConfig}
              className="h-8 rounded-sm bg-accent px-4 text-xs font-semibold text-content-inverse hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? '保存中...' : '保存模型与检索配置'}
            </button>
          )}
          {tab === 'access' && isAdmin && (
            <button
              type="button"
              disabled={busy}
              onClick={handleSavePolicy}
              className="h-8 rounded-sm bg-accent px-4 text-xs font-semibold text-content-inverse hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? '保存中...' : '保存访问策略'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
