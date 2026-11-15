import { useState } from 'react';
import type { AuthContextResponse, MaskedServiceConfig } from '@rolecard/shared';
import {
  Bell,
  BookOpen,
  FileUp,
  LayoutGrid,
  LogIn,
  LogOut,
  Menu,
  MessageSquare,
  Palette,
  Puzzle,
  Settings,
  Shield,
  Sparkles,
  Type as TypeIcon,
} from 'lucide-react';
import {
  FONT_PRESET_MAP,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  THEME_OPTIONS,
  useTheme,
} from '../hooks/useTheme';
import { useToast } from '../hooks/useToast';

export type WorkspaceView =
  | 'gallery'
  | 'generate'
  | 'detail'
  | 'playtest'
  | 'lorebooks'
  | 'plugins'
  | 'reviews';

interface TopBarProps {
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  canCreate: boolean;
  onOpenImport: () => void;
  config: MaskedServiceConfig | null;
  auth: AuthContextResponse | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  onOpenLogin: () => void;
  onLogout: () => void;
}

const NAV_ITEMS: readonly {
  id: Exclude<WorkspaceView, 'detail'>;
  label: string;
  icon: typeof LayoutGrid;
}[] = [
  { id: 'gallery', label: '角色卡库', icon: LayoutGrid },
  { id: 'generate', label: '生成新卡', icon: Sparkles },
  { id: 'playtest', label: '快速试聊', icon: MessageSquare },
  { id: 'lorebooks', label: '世界书', icon: BookOpen },
  { id: 'plugins', label: '插件与 MCP', icon: Puzzle },
  { id: 'reviews', label: '审核与同步', icon: Bell },
];

export function TopBar({
  view,
  onViewChange,
  canCreate,
  onOpenImport,
  config,
  auth,
  sidebarOpen,
  onToggleSidebar,
  onOpenSettings,
  onOpenLogin,
  onLogout,
}: TopBarProps) {
  const {
    theme,
    setTheme,
    fontSizePx,
    fontPreset,
    setFontPreset,
    setCustomFontSize,
  } = useTheme();
  const { notifySuccess } = useToast();
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [fontMenuOpen, setFontMenuOpen] = useState(false);

  const isConfigured = Boolean(config?.configured && config.primaryLlm);
  const currentThemeMeta = THEME_OPTIONS.find((t) => t.id === theme) ?? THEME_OPTIONS[0]!;

  const renderNavStrip = () => (
    <div className="flex items-center gap-1.5">
      <nav
        aria-label="主工作区导航"
        className="inline-flex items-center rounded-md border border-line bg-subtle p-0.5 shadow-sm"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onViewChange(item.id)}
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-2.5 py-1 text-[12px] font-medium leading-4 transition-all ${
                active
                  ? 'bg-accent text-content-inverse shadow-sm'
                  : 'text-content-secondary hover:bg-surface/60 hover:text-content-primary'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {canCreate && (
        <button
          type="button"
          onClick={onOpenImport}
          className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 text-[12px] font-medium leading-4 text-content-primary shadow-sm transition-colors hover:border-accent/50 hover:bg-subtle"
        >
          <FileUp className="h-3.5 w-3.5 text-accent" />
          <span>导入旧卡升级</span>
        </button>
      )}
    </div>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-line-subtle bg-surface/90 backdrop-blur-md">
      <div className="flex h-14 items-center justify-between gap-2 px-4 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onToggleSidebar}
            title={sidebarOpen ? '收起侧栏' : '展开侧栏'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-content-secondary transition-colors hover:bg-subtle hover:text-content-primary"
          >
            <Menu className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => onViewChange('gallery')}
            title="返回角色卡库"
            className="flex min-w-0 items-center gap-2 text-left transition-opacity hover:opacity-85"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent to-accent-secondary text-content-inverse shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="truncate whitespace-nowrap text-[14px] font-semibold tracking-tight text-content-primary xl:text-[15px]">
              RoleCard Studio
            </span>
          </button>
        </div>

        <div className="hidden justify-center lg:flex">{renderNavStrip()}</div>

        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onOpenSettings}
            className="hidden items-center gap-1.5 rounded-full border border-line bg-subtle px-2 py-1 text-[11.5px] font-medium leading-4 text-content-secondary transition-colors hover:border-accent/50 hover:text-content-primary xl:inline-flex"
            title={
              isConfigured
                ? `当前主模型：${config?.primaryLlm?.model ?? '已就绪'}`
                : '尚未配置主大模型，点击设置'
            }
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                isConfigured ? 'bg-status-success' : 'bg-status-warning'
              }`}
            />
            <span className="max-w-[110px] truncate 2xl:max-w-[160px]">
              {isConfigured ? `${config?.primaryLlm?.model ?? '已就绪'}` : '待配置模型'}
            </span>
          </button>

          {auth && (
            <div
              className="hidden items-center gap-1 rounded-full border border-line bg-subtle px-2 py-1 text-[11.5px] leading-4 text-content-secondary 2xl:inline-flex"
              title="站点与 API 安全策略"
            >
              <Shield className="h-3.5 w-3.5 text-accent" />
              <span className="whitespace-nowrap">
                {auth.policy.siteAccessMode === 'login_required' ? '登录访问' : '公开'}
                {' · '}
                {auth.policy.apiAccessMode === 'public' ? 'API公开' : '鉴权'}
              </span>
            </div>
          )}

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setFontMenuOpen((prev) => !prev);
              setThemeMenuOpen(false);
            }}
            className="inline-flex h-8 items-center gap-1 rounded-sm border border-line bg-surface px-2 text-[12px] font-medium leading-4 text-content-secondary transition-colors hover:bg-subtle hover:text-content-primary"
            title="调整界面字体大小"
          >
            <TypeIcon className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">
              {fontPreset === 'custom'
                ? `${fontSizePx}px`
                : FONT_PRESET_MAP[fontPreset].label}
            </span>
          </button>

          {fontMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setFontMenuOpen(false)}
              />
              <div className="absolute right-0 z-50 mt-1.5 w-56 rounded-md border border-line bg-elevated p-3 shadow-lg">
                <div className="mb-2 flex h-4 items-center justify-between text-[12px] font-medium leading-4 text-content-primary">
                  <span>字体大小</span>
                  <span className="tabular-nums font-mono text-[11px] leading-4 text-accent">
                    {fontSizePx}px
                  </span>
                </div>
                <div className="mb-3 grid grid-cols-3 gap-1 rounded-sm border border-line bg-subtle p-0.5">
                  {(['small', 'medium', 'large'] as const).map((key) => {
                    const item = FONT_PRESET_MAP[key];
                    const active = fontPreset === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setFontPreset(key);
                          notifySuccess(`字体已调整为「${item.label} (${item.px}px)」`);
                        }}
                        className={`h-7 rounded-sm text-[12px] font-medium leading-4 transition ${
                          active
                            ? 'bg-surface text-accent shadow-sm'
                            : 'text-content-secondary hover:text-content-primary'
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
                <div className="space-y-1.5">
                  <div className="flex h-4 items-center justify-between text-[11px] leading-4 text-content-muted">
                    <span>自定义 ({FONT_SIZE_MIN}～{FONT_SIZE_MAX}px)</span>
                    <button
                      type="button"
                      onClick={() => {
                        setFontPreset('medium');
                        notifySuccess('已恢复默认字号 (16px)');
                      }}
                      className="text-[11px] leading-4 text-accent hover:underline"
                    >
                      重置
                    </button>
                  </div>
                  <div className="flex h-7 items-center gap-2">
                    <input
                      type="range"
                      min={FONT_SIZE_MIN}
                      max={FONT_SIZE_MAX}
                      step={1}
                      value={fontSizePx}
                      onChange={(e) => setCustomFontSize(Number(e.target.value))}
                      className="h-1.5 flex-1 cursor-pointer accent-accent"
                    />
                    <input
                      type="number"
                      min={FONT_SIZE_MIN}
                      max={FONT_SIZE_MAX}
                      value={fontSizePx}
                      onChange={(e) => setCustomFontSize(Number(e.target.value))}
                      className="h-7 w-12 rounded-sm border border-line bg-surface px-1.5 text-center font-mono text-[12px] text-content-primary"
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setThemeMenuOpen((prev) => !prev);
              setFontMenuOpen(false);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-[12px] font-medium leading-4 text-content-secondary transition-colors hover:bg-subtle hover:text-content-primary"
            title="切换颜色主题"
          >
            <Palette className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">{currentThemeMeta.label}</span>
          </button>

          {themeMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setThemeMenuOpen(false)}
              />
              <div className="absolute right-0 z-50 mt-1.5 w-44 rounded-md border border-line bg-elevated p-1.5 shadow-lg">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setTheme(opt.id);
                      setThemeMenuOpen(false);
                      notifySuccess(`已切换至「${opt.label}」主题`);
                    }}
                    className={`flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-left text-[12px] leading-4 transition-colors ${
                      theme === opt.id
                        ? 'bg-accent/10 font-semibold text-accent'
                        : 'text-content-secondary hover:bg-hover hover:text-content-primary'
                    }`}
                  >
                    <span>{opt.label}</span>
                    <span className="inline-flex items-center">
                      <span
                        className="h-2.5 w-2.5 rounded-full border border-line"
                        style={{ backgroundColor: opt.bgHex }}
                      />
                      <span
                        className="-ml-1 h-2.5 w-2.5 rounded-full border border-line"
                        style={{ backgroundColor: opt.accentHex }}
                      />
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-[12px] font-medium leading-4 text-content-primary transition-colors hover:bg-subtle"
        >
          <Settings className="h-3.5 w-3.5 text-content-secondary" />
          <span className="hidden xl:inline">设置</span>
        </button>

        {auth?.authenticated && auth.user ? (
          <div className="flex items-center gap-1">
            <span className="inline-flex h-8 max-w-[100px] items-center truncate rounded-sm bg-accent/10 px-2 text-[12px] font-medium leading-4 text-accent">
              {auth.user.username}
              {auth.user.role === 'admin' ? '(管)' : ''}
            </span>
            <button
              type="button"
              onClick={onLogout}
              title="退出登录"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-line text-content-secondary hover:bg-subtle hover:text-status-danger"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenLogin}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm bg-accent px-2.5 text-[12px] font-medium leading-4 text-content-inverse transition-colors hover:bg-accent-hover"
          >
            <LogIn className="h-3.5 w-3.5" />
            <span>登录</span>
          </button>
        )}
      </div>
      </div>

      <div className="flex justify-center overflow-x-auto border-t border-line-subtle bg-canvas/60 px-3 py-1.5 lg:hidden">
        {renderNavStrip()}
      </div>
    </header>
  );
}
