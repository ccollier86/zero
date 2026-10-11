/** Legacy Tailwind theme bindings used by raw CSS consumers; no compiler dependency or utility generation. */
import type { ThemeTokenMap } from './theme-types';

const colors = [
  'border', 'border-strong', 'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
  'accent', 'accent-hover', 'accent-foreground', 'success', 'success-foreground', 'warning', 'warning-foreground',
  'destructive', 'destructive-foreground', 'input', 'ring',
  'public-background', 'public-foreground', 'public-surface', 'public-surface-foreground', 'public-surface-raised',
  'public-glass', 'public-glass-foreground', 'public-muted', 'public-muted-foreground', 'public-accent',
  'public-accent-foreground', 'public-accent-soft', 'public-border', 'public-ring',
  'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground', 'sidebar-accent',
  'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
];

/** Rebind the exact legacy @theme inline names at each next boundary so direct --color-* consumers do not freeze root paint. */
export const THEME_UTILITY_ALIASES: ThemeTokenMap = Object.freeze({
  '--font-sans': 'var(--font-platform-sans)', '--font-mono': 'var(--font-platform-mono)',
  '--radius-sm': 'calc(var(--radius) - 2px)', '--radius-md': 'var(--radius)',
  '--radius-lg': 'calc(var(--radius) + 2px)', '--radius-xl': 'calc(var(--radius) + 6px)',
  '--color-bg-base': 'var(--background)', '--color-bg-surface': 'var(--surface)',
  '--color-bg-raised': 'var(--surface-raised)', '--color-bg-inset': 'var(--surface-inset)',
  '--color-text-primary': 'var(--foreground)', '--color-text-secondary': 'var(--muted-foreground)',
  '--color-text-muted': 'var(--subtle-foreground)', '--color-sidebar-background': 'var(--sidebar)',
  ...Object.fromEntries(colors.map(name => [`--color-${name}`, `var(--${name})`])),
});
