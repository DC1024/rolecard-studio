import { useState } from 'react';
import type { AuthContextResponse, CardType, MaskedServiceConfig } from '@rolecard/shared';
import {
  LogIn,
  LogOut,
  Menu,
  Palette,
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

interface TopBarProps {
  preset: CardType;
  onPresetChange: (preset: CardType) => void;
  config: MaskedServiceConfig | null;
  auth: AuthContextResponse | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  onOpenLogin: () => void;
  onLogout: () => void;
}

const PRESET_TABS: readonly { id: CardType; label: string; hint: string }[] = [
  {
    id: 'sillytavern_v3',
    label: 'AI 角色扮演',
    hint: '强化沉浸式开场白、对话示例与 SillyTavern CCV3 防出戏设定',
  },
  {
    id: 'trpg_coc7',
    label: 'TRPG 车卡',
    hint: '生成 CoC 7e / D&D 5e 真实面板数值与技能，支持 Foundry VTT 与跑团车卡表导出',
  },
  {
    id: 'general',
    label: '通用设定',
    hint: '精炼客观的人物档案结构，适用于小说、游戏策划与设定集归档',
  },
];

export function TopBar({
  preset,
  onPresetChange,
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

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line-subtle bg-surface/90 px-4 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          title={sidebarOpen ? '收起历史栏' : '展开历史栏'}
          className="flex h-8 w-8 items-center justify-center rounded-sm text-content-secondary transition-colors hover:bg-subtle hover:text-content-primary"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent to-accent-secondary text-content-inverse shadow-sm">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight text-content-primary">
            RoleCard Studio
          </span>
        </div>

        <div className="hidden items-center rounded-md border border-line bg-subtle p-0.5 sm:flex">
          {PRESET_TABS.map((tab) => {
            const active =
              tab.id === 'trpg_coc7'
                ? preset === 'trpg_coc7' || preset === 'trpg_dnd5e'
                : preset === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                title={tab.hint}
                onClick={() => onPresetChange(tab.id)}
                className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-all ${
                  active
                    ? 'bg-surface text-content-primary shadow-sm'
                    : 'text-content-secondary hover:text-content-primary'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="hidden items-center gap-1.5 rounded-full border border-line bg-subtle px-2.5 py-1 text-xs font-medium text-content-secondary transition-colors hover:border-accent/50 hover:text-content-primary md:inline-flex"
          title="查看大模型与系统配置"
        >
          <span
            className={`h-2 w-2 rounded-full ${
              isConfigured ? 'bg-status-success' : 'bg-status-warning'
            }`}
          />
          <span>
            {isConfigured
              ? `${config?.primaryLlm?.model ?? '已就绪'}`
              : '待配置大模型'}
          </span>
        </button>

        {auth && (
          <div className="hidden items-center gap-1.5 rounded-full border border-line bg-subtle px-2.5 py-1 text-xs text-content-secondary lg:inline-flex">
            <Shield className="h-3.5 w-3.5 text-accent" />
            <span>
              {auth.policy.siteAccessMode === 'login_required' ? '登录访问' : '公开工作台'}
              {' · '}
              API {auth.policy.apiAccessMode === 'public' ? '公开' : '鉴权'}
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
            className="inline-flex h-8 items-center gap-1 rounded-sm border border-line bg-surface px-2 text-xs font-medium text-content-secondary transition-colors hover:bg-subtle hover:text-content-primary"
            title="调整界面字体大小"
          >
            <TypeIcon className="h-3.5 w-3.5" />
            <span className="hidden md:inline">
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
                <div className="mb-2 flex items-center justify-between text-xs font-medium text-content-primary">
                  <span>字体大小</span>
                  <span className="font-mono text-[0.6875rem] text-accent">
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
                        className={`rounded-sm py-1 text-xs font-medium transition ${
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
                  <div className="flex items-center justify-between text-[0.6875rem] text-content-muted">
                    <span>自定义 ({FONT_SIZE_MIN}～{FONT_SIZE_MAX}px)</span>
                    <button
                      type="button"
                      onClick={() => {
                        setFontPreset('medium');
                        notifySuccess('已恢复默认字号 (16px)');
                      }}
                      className="text-accent hover:underline"
                    >
                      重置
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
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
                      className="h-7 w-12 rounded-sm border border-line bg-surface px-1.5 text-center font-mono text-xs text-content-primary"
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
            className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-content-secondary transition-colors hover:bg-subtle hover:text-content-primary"
            title="切换颜色主题"
          >
            <Palette className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{currentThemeMeta.label}</span>
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
                    className={`flex w-full items-center justify-between rounded-sm px-2.5 py-1.5 text-left text-xs transition-colors ${
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
          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-content-primary transition-colors hover:bg-subtle"
        >
          <Settings className="h-3.5 w-3.5 text-content-secondary" />
          <span className="hidden sm:inline">设置</span>
        </button>

        {auth?.authenticated && auth.user ? (
          <div className="flex items-center gap-1.5">
            <span className="inline-flex h-8 items-center rounded-sm bg-accent/10 px-2.5 text-xs font-medium text-accent">
              {auth.user.username}
              {auth.user.role === 'admin' ? ' (管理)' : ''}
            </span>
            <button
              type="button"
              onClick={onLogout}
              title="退出登录"
              className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-line text-content-secondary hover:bg-subtle hover:text-status-danger"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenLogin}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-accent px-3 text-xs font-medium text-content-inverse transition-colors hover:bg-accent-hover"
          >
            <LogIn className="h-3.5 w-3.5" />
            <span>登录</span>
          </button>
        )}
      </div>
    </header>
  );
}
