import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ThemeMode } from '@rolecard/shared';

export type ResolvedTheme = Exclude<ThemeMode, 'system'>;

export interface ThemeOptionMeta {
  id: ThemeMode;
  label: string;
  bgHex: string;
  accentHex: string;
}

export const THEME_OPTIONS: readonly ThemeOptionMeta[] = [
  { id: 'light', label: '极简晨白', bgHex: '#F8FAFC', accentHex: '#2563EB' },
  { id: 'dark', label: '深邃夜幕', bgHex: '#0B0F19', accentHex: '#3B82F6' },
  { id: 'ocean', label: '极客青蓝', bgHex: '#06111A', accentHex: '#06B6D4' },
  { id: 'parchment', label: '羊皮暖卷', bgHex: '#F6F1E7', accentHex: '#B45309' },
  { id: 'system', label: '跟随系统', bgHex: '#E2E8F0', accentHex: '#64748B' },
];

const STORAGE_KEY = 'rc_theme';
const FONT_SIZE_KEY = 'rc_font_size_px';

export type FontSizePreset = 'small' | 'medium' | 'large' | 'custom';

export const FONT_PRESET_MAP: Record<'small' | 'medium' | 'large', { label: string; px: number }> = {
  small: { label: '小', px: 14 },
  medium: { label: '中', px: 16 },
  large: { label: '大', px: 18 },
};

export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 22;

function clampFontSize(px: number): number {
  if (!Number.isFinite(px)) return 16;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(px)));
}

function readStoredFontSize(): number {
  if (typeof window === 'undefined') return 16;
  const raw = window.localStorage.getItem(FONT_SIZE_KEY);
  if (!raw) return 16;
  const parsed = Number(raw);
  return clampFontSize(parsed);
}

function resolveFontPreset(px: number): FontSizePreset {
  if (px === FONT_PRESET_MAP.small.px) return 'small';
  if (px === FONT_PRESET_MAP.medium.px) return 'medium';
  if (px === FONT_PRESET_MAP.large.px) return 'large';
  return 'custom';
}

function resolveSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (
    raw === 'light' ||
    raw === 'dark' ||
    raw === 'ocean' ||
    raw === 'parchment' ||
    raw === 'system'
  ) {
    return raw;
  }
  return 'system';
}

interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (next: ThemeMode) => void;
  fontSizePx: number;
  fontPreset: FontSizePreset;
  setFontPreset: (preset: 'small' | 'medium' | 'large') => void;
  setCustomFontSize: (px: number) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(readStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    theme === 'system' ? resolveSystemTheme() : theme,
  );
  const [fontSizePx, setFontSizePx] = useState<number>(readStoredFontSize);

  const applyFontSize = useCallback((px: number) => {
    const safe = clampFontSize(px);
    const scale = safe / 16;
    document.documentElement.style.setProperty('--app-font-size', `${safe}px`);
    document.documentElement.style.setProperty('--app-font-scale', scale.toFixed(4));
  }, []);

  const setCustomFontSize = useCallback(
    (px: number) => {
      const safe = clampFontSize(px);
      setFontSizePx(safe);
      window.localStorage.setItem(FONT_SIZE_KEY, String(safe));
      applyFontSize(safe);
    },
    [applyFontSize],
  );

  const setFontPreset = useCallback(
    (preset: 'small' | 'medium' | 'large') => {
      setCustomFontSize(FONT_PRESET_MAP[preset].px);
    },
    [setCustomFontSize],
  );

  const applyTheme = useCallback((next: ThemeMode, animate: boolean) => {
    const resolved: ResolvedTheme = next === 'system' ? resolveSystemTheme() : next;
    setResolvedTheme(resolved);
    const root = document.documentElement;
    if (animate) {
      root.classList.add('theme-switching');
      window.setTimeout(() => {
        root.classList.remove('theme-switching');
      }, 210);
    }
    root.setAttribute('data-theme', resolved);
  }, []);

  const setTheme = useCallback(
    (next: ThemeMode) => {
      setThemeState(next);
      window.localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next, true);
    },
    [applyTheme],
  );

  useEffect(() => {
    applyTheme(theme, false);
    applyFontSize(fontSizePx);

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMediaChange = () => {
      if (theme === 'system') {
        applyTheme('system', true);
      }
    };
    media.addEventListener('change', onMediaChange);

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        const next = readStoredTheme();
        setThemeState(next);
        applyTheme(next, true);
      }
      if (e.key === FONT_SIZE_KEY) {
        const nextPx = readStoredFontSize();
        setFontSizePx(nextPx);
        applyFontSize(nextPx);
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      media.removeEventListener('change', onMediaChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [theme, fontSizePx, applyTheme, applyFontSize]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        setTheme,
        fontSizePx,
        fontPreset: resolveFontPreset(fontSizePx),
        setFontPreset,
        setCustomFontSize,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
