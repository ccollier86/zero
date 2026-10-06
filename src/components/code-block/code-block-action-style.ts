/** Native Button composition keeps code-action tokens authoritative over base utility sizes. */
import type { CSSProperties } from 'react';

/** Caller-native styles still win; semantic tokens are the shared default contract. */
export function codeBlockActionStyle(style?: CSSProperties, square = false, iconSize?: number): CSSProperties {
  return {
    height: 'var(--zero-code-action-size)',
    minWidth: 'var(--zero-code-action-size)',
    ...(square ? { width: 'var(--zero-code-action-size)' } : {}),
    paddingInline: 'var(--zero-code-action-padding)',
    paddingBlock: 0,
    gap: 'var(--zero-code-gap)',
    borderRadius: 'var(--zero-code-action-radius)',
    fontSize: 'var(--zero-code-header-font-size)',
    color: 'var(--zero-code-action-color, var(--public-muted-foreground))',
    backgroundColor: 'var(--zero-code-action-background, transparent)',
    outline: 'var(--zero-code-action-outline, none)',
    outlineOffset: 'var(--zero-code-focus-ring-offset)',
    boxShadow: 'none',
    transitionProperty: 'color, background-color',
    transitionDuration: 'var(--zero-code-transition-duration)',
    transitionTimingFunction: 'var(--zero-code-transition-ease)',
    ...(Number.isFinite(iconSize) ? { '--zero-code-icon-size': `${iconSize}px` } : {}),
    ...style,
  };
}
