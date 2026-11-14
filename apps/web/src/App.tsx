import { useCallback, useEffect, useState } from 'react';
import type {
  AuthContextResponse,
  CardType,
  GenerateCardRequest,
  GenerationMode,
  MaskedServiceConfig,
  Permission,
} from '@rolecard/shared';
import { BookOpen, CheckCircle2, FileText, FileUp, MessageSquare, Puzzle, Sparkles } from 'lucide-react';
import { api, type CommonTagCount, type RoleCardDto } from './api/client';
import { CardDetailPanel } from './components/CardDetailPanel';
import { GenerateForm } from './components/GenerateForm';
import { ImportCardModal } from './components/ImportCardModal';
import { LoginModal } from './components/LoginModal';
import { LorebookPanel } from './components/LorebookPanel';
import { PlaytestPanel } from './components/PlaytestPanel';
import { PluginPanel } from './components/PluginPanel';
import { PortraitCropModal } from './components/PortraitCropModal';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ThemeProvider } from './hooks/useTheme';

type WorkspaceView = 'generate' | 'detail' | 'playtest' | 'lorebooks' | 'plugins';

function StudioApp() {
  const [auth, setAuth] = useState<AuthContextResponse | null>(null);
  const [config, setConfig] = useState<MaskedServiceConfig | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [preset, setPreset] = useState<CardType>('sillytavern_v3');
  const [view, setView] = useState<WorkspaceView>('generate');

  const [cards, setCards] = useState<RoleCardDto[]>([]);
  const [total, setTotal] = useState(0);
  const [commonTags, setCommonTags] = useState<CommonTagCount[]>([]);
  const [selectedCard, setSelectedCard] = useState<RoleCardDto | null>(null);
  const [loadingCards, setLoadingCards] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [filterCardType, setFilterCardType] = useState<CardType | ''>('');
  const [filterMode, setFilterMode] = useState<GenerationMode | ''>('');

  const [generating, setGenerating] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [portraitOpen, setPortraitOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const hasPerm = useCallback(
    (perm: Permission): boolean => {
      if (!auth) return false;
      if (auth.user?.role === 'admin') return true;
      return auth.effectivePermissions.includes(perm);
    },
    [auth],
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  const refreshAuthAndConfig = useCallback(async () => {
    try {
      const me = await api.getAuthMe();
      setAuth(me);
      if (me.authenticated || me.policy.siteAccessMode === 'public') {
        try {
          const cfg = await api.getConfig();
          setConfig(cfg);
        } catch {
          setConfig(null);
        }
      }
    } catch {
      // ignore initial boot network failure
    }
  }, []);

  const refreshCards = useCallback(async () => {
    setLoadingCards(true);
    try {
      const res = await api.listCards({
        q: searchQuery,
        tags: selectedTags,
        cardType: filterCardType,
        mode: filterMode,
        page: 1,
        pageSize: 50,
      });
      setCards(res.items);
      setTotal(res.total);
      setCommonTags(res.commonTags);
      setSelectedCard((prev) => {
        if (!prev) return res.items[0] ?? null;
        return res.items.find((c) => c.id === prev.id) ?? prev;
      });
    } catch {
      setCards([]);
      setTotal(0);
    } finally {
      setLoadingCards(false);
    }
  }, [searchQuery, selectedTags, filterCardType, filterMode]);

  useEffect(() => {
    void refreshAuthAndConfig();
  }, [refreshAuthAndConfig]);

  useEffect(() => {
    if (!auth) return;
    if (auth.policy.siteAccessMode === 'login_required' && !auth.authenticated) {
      return;
    }
    void refreshCards();
  }, [auth, refreshCards]);

  const blockingLogin = Boolean(
    auth && auth.policy.siteAccessMode === 'login_required' && !auth.authenticated,
  );

  const handleLogin = async (username: string, password: string) => {
    await api.login(username, password);
    setLoginOpen(false);
    await refreshAuthAndConfig();
    await refreshCards();
    showToast(`欢迎回来，${username}`);
  };

  const handleLogout = async () => {
    await api.logout();
    setSelectedCard(null);
    await refreshAuthAndConfig();
    showToast('已安全退出登录');
  };

  const handleGenerate = async (req: GenerateCardRequest) => {
    setGenerating(true);
    setProgressText('准备输入上下文与检索数据源...');
    setGenerateError(null);
    try {
      const created = await api.generateCardSse(req, (msg) => setProgressText(msg));
      setSelectedCard(created);
      setView('detail');
      await refreshCards();
      showToast(`已生成角色卡「${created.characterName}」`);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setGenerating(false);
      setProgressText('');
    }
  };

  const handleCardUpdated = (updated: RoleCardDto, banner?: string) => {
    setSelectedCard(updated);
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    if (banner) showToast(banner);
    void refreshCards();
  };

  const handleCardDeleted = (id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
    setSelectedCard((prev) => (prev?.id === id ? null : prev));
    setView('generate');
    showToast('角色卡已删除');
    void refreshCards();
  };

  return (
    <div className="min-h-screen bg-canvas text-content-primary">
      <TopBar
        preset={preset}
        onPresetChange={(p) => {
          setPreset(p);
          setView('generate');
        }}
        config={config}
        auth={auth}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenLogin={() => setLoginOpen(true)}
        onLogout={handleLogout}
      />

      <div className="flex">
        <Sidebar
          open={sidebarOpen}
          cards={cards}
          total={total}
          commonTags={commonTags}
          selectedCardId={selectedCard?.id ?? null}
          searchQuery={searchQuery}
          selectedTags={selectedTags}
          filterCardType={filterCardType}
          filterMode={filterMode}
          loading={loadingCards}
          onSearchChange={setSearchQuery}
          onToggleTag={(tag) =>
            setSelectedTags((prev) =>
              prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
            )
          }
          onClearTags={() => setSelectedTags([])}
          onFilterCardTypeChange={setFilterCardType}
          onFilterModeChange={setFilterMode}
          onSelectCard={(card) => {
            setSelectedCard(card);
            setView('detail');
          }}
          onQuickPlaytest={(card) => {
            setSelectedCard(card);
            setView('playtest');
          }}
        />

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <div className="mx-auto max-w-5xl space-y-4">
            {/* Workspace Mode Switcher */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-md border border-line bg-surface p-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setView('generate')}
                    className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition ${
                      view === 'generate'
                        ? 'bg-accent text-content-inverse'
                        : 'text-content-secondary hover:text-content-primary'
                    }`}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    生成新卡
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('detail')}
                    className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition ${
                      view === 'detail'
                        ? 'bg-accent text-content-inverse'
                        : 'text-content-secondary hover:text-content-primary'
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    卡片详情{selectedCard ? ` · ${selectedCard.characterName}` : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('playtest')}
                    className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition ${
                      view === 'playtest'
                        ? 'bg-accent text-content-inverse'
                        : 'text-content-secondary hover:text-content-primary'
                    }`}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    快速试聊
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('lorebooks')}
                    className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition ${
                      view === 'lorebooks'
                        ? 'bg-accent text-content-inverse'
                        : 'text-content-secondary hover:text-content-primary'
                    }`}
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    世界书
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('plugins')}
                    className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition ${
                      view === 'plugins'
                        ? 'bg-accent text-content-inverse'
                        : 'text-content-secondary hover:text-content-primary'
                    }`}
                  >
                    <Puzzle className="h-3.5 w-3.5" />
                    插件与 MCP
                  </button>
                </div>

                {hasPerm('card:create') && (
                  <button
                    type="button"
                    onClick={() => setImportOpen(true)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-xs font-medium text-content-primary shadow-sm hover:bg-subtle"
                  >
                    <FileUp className="h-3.5 w-3.5 text-accent" />
                    导入旧卡升级
                  </button>
                )}
              </div>

              {toast && (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-status-success/40 bg-status-success/10 px-3 py-1 text-xs font-medium text-status-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {toast}
                </div>
              )}
            </div>

            {view === 'generate' && (
              <GenerateForm
                cardType={preset}
                canCreate={hasPerm('card:create')}
                isConfigured={Boolean(config?.configured && config.primaryLlm)}
                generating={generating}
                progressText={progressText}
                errorText={generateError}
                onCardTypeChange={setPreset}
                onSubmit={handleGenerate}
                onOpenSettings={() => setSettingsOpen(true)}
              />
            )}

            {view === 'detail' && (
              <CardDetailPanel
                card={selectedCard}
                canUpdate={hasPerm('card:update')}
                canDelete={hasPerm('card:delete')}
                canExport={hasPerm('card:export')}
                canPlaytest={hasPerm('playtest:use')}
                onCardUpdated={handleCardUpdated}
                onCardDeleted={handleCardDeleted}
                onOpenPlaytest={(card) => {
                  setSelectedCard(card);
                  setView('playtest');
                }}
                onOpenPortraitModal={() => setPortraitOpen(true)}
              />
            )}

            {view === 'playtest' && (
              <PlaytestPanel
                cards={cards}
                selectedCard={selectedCard}
                canPlaytest={hasPerm('playtest:use')}
                canUpdate={hasPerm('card:update')}
                onSelectCard={setSelectedCard}
                onCardUpdated={handleCardUpdated}
              />
            )}

            {view === 'lorebooks' && (
              <LorebookPanel
                cards={cards}
                canCreate={hasPerm('card:create')}
                canUpdate={hasPerm('card:update')}
                canDelete={hasPerm('card:delete')}
                canExport={hasPerm('card:export')}
                onNotify={showToast}
              />
            )}

            {view === 'plugins' && (
              <PluginPanel
                selectedCard={selectedCard}
                canExport={hasPerm('card:export')}
              />
            )}
          </div>
        </main>
      </div>

      <ImportCardModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(card, msg) => {
          setSelectedCard(card);
          setView('detail');
          showToast(msg);
          void refreshCards();
        }}
      />

      <SettingsModal
        open={settingsOpen}
        config={config}
        auth={auth}
        onClose={() => setSettingsOpen(false)}
        onSavedConfig={(saved) => {
          setConfig(saved);
          showToast('配置已更新');
        }}
        onPolicyUpdated={() => {
          void refreshAuthAndConfig();
        }}
      />

      <LoginModal
        open={loginOpen || blockingLogin}
        blocking={blockingLogin}
        onClose={() => setLoginOpen(false)}
        onSubmit={handleLogin}
      />

      {selectedCard && (
        <PortraitCropModal
          open={portraitOpen}
          cardName={selectedCard.characterName}
          onClose={() => setPortraitOpen(false)}
          onSaveUpload={async (dataUrl) => {
            const res = await api.uploadCardImage(selectedCard.id, {
              mode: 'upload',
              dataUrl,
            });
            handleCardUpdated(res.card, '立绘已裁剪上传');
            setPortraitOpen(false);
          }}
          onSaveUrl={async (imageUrl) => {
            const res = await api.uploadCardImage(selectedCard.id, {
              mode: 'search_url',
              imageUrl,
            });
            handleCardUpdated(res.card, '立绘外链已更新');
            setPortraitOpen(false);
          }}
        />
      )}
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <StudioApp />
    </ThemeProvider>
  );
}
export default App;
