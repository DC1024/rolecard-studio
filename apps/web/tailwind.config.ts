import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    fontSize: {
      xs: ['calc(0.75rem * var(--app-font-scale, 1))', { lineHeight: '1.45' }],
      sm: ['calc(0.875rem * var(--app-font-scale, 1))', { lineHeight: '1.5' }],
      base: ['calc(1rem * var(--app-font-scale, 1))', { lineHeight: '1.55' }],
      lg: ['calc(1.125rem * var(--app-font-scale, 1))', { lineHeight: '1.5' }],
      xl: ['calc(1.25rem * var(--app-font-scale, 1))', { lineHeight: '1.45' }],
      '2xl': ['calc(1.5rem * var(--app-font-scale, 1))', { lineHeight: '1.35' }],
      '3xl': ['calc(1.875rem * var(--app-font-scale, 1))', { lineHeight: '1.25' }],
      '4xl': ['calc(2.25rem * var(--app-font-scale, 1))', { lineHeight: '1.2' }],
    },
    extend: {
      colors: {
        canvas: 'rgb(var(--bg-canvas) / <alpha-value>)',
        surface: 'rgb(var(--bg-surface) / <alpha-value>)',
        elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
        subtle: 'rgb(var(--bg-subtle) / <alpha-value>)',
        hover: 'rgb(var(--bg-hover) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--accent-primary) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          secondary: 'rgb(var(--accent-secondary) / <alpha-value>)',
        },
        content: {
          primary: 'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
          inverse: 'rgb(var(--text-inverse) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--border-default) / <alpha-value>)',
          subtle: 'rgb(var(--border-subtle) / <alpha-value>)',
        },
        status: {
          success: 'rgb(var(--status-success) / <alpha-value>)',
          warning: 'rgb(var(--status-warning) / <alpha-value>)',
          danger: 'rgb(var(--status-danger) / <alpha-value>)',
          info: 'rgb(var(--status-info) / <alpha-value>)',
        },
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '14px',
      },
    },
  },
  plugins: [],
};

export default config;
