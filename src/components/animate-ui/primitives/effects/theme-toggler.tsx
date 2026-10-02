'use client';

/**
 * Coordinates persisted theme changes with the browser View Transitions API.
 * The primitive owns transition state; callers own the button affordance and
 * ThemeProvider owns persistence.
 */

import * as React from 'react';
import { flushSync } from 'react-dom';

import {
  THEME_TRANSITION_STYLES,
  canAnimateThemeTransition,
  hasActiveThemeTransition,
  startCircularThemeTransition,
  type Direction,
  type ThemeTransitionOrigin,
} from './theme-transition';

type ThemeSelection = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

type ChildrenRender =
  | React.ReactNode
  | ((state: {
      resolved: Resolved;
      effective: ThemeSelection;
      transitioning: boolean;
      toggleTheme: (
        theme: ThemeSelection,
        origin?: ThemeTransitionOrigin,
      ) => Promise<boolean>;
    }) => React.ReactNode);

type ThemeTogglerProps = {
  theme: ThemeSelection;
  resolvedTheme: Resolved;
  setTheme: (theme: ThemeSelection) => void;
  direction?: Direction;
  onImmediateChange?: (theme: ThemeSelection) => void;
  children?: ChildrenRender;
};

function getSystemEffective(): Resolved {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function ThemeToggler({
  theme,
  resolvedTheme,
  setTheme,
  onImmediateChange,
  direction = 'ltr',
  children,
}: ThemeTogglerProps) {
  const [preview, setPreview] = React.useState<null | {
    effective: ThemeSelection;
    resolved: Resolved;
  }>(null);
  const [transitioning, setTransitioning] = React.useState(false);

  React.useEffect(() => {
    if (
      preview &&
      theme === preview.effective &&
      resolvedTheme === preview.resolved
    ) {
      setPreview(null);
    }
  }, [theme, resolvedTheme, preview]);

  const toggleTheme = React.useCallback(
    async (
      nextTheme: ThemeSelection,
      origin?: ThemeTransitionOrigin,
    ): Promise<boolean> => {
      if (hasActiveThemeTransition()) return false;

      const resolved =
        nextTheme === 'system' ? getSystemEffective() : nextTheme;
      const next = { effective: nextTheme, resolved };
      const commitPreview = () => setPreview(next);

      onImmediateChange?.(nextTheme);

      if (resolved === resolvedTheme || !canAnimateThemeTransition()) {
        flushSync(commitPreview);
        setTheme(nextTheme);
        return true;
      }

      const commitTransition = () => {
        flushSync(() => {
          commitPreview();
          document.documentElement.classList.toggle(
            'dark',
            resolved === 'dark',
          );
          setTheme(nextTheme);
        });
      };

      setTransitioning(true);
      try {
        return await startCircularThemeTransition({
          direction,
          origin,
          commit: commitTransition,
        });
      } finally {
        setTransitioning(false);
      }
    },
    [direction, onImmediateChange, resolvedTheme, setTheme],
  );

  const renderedTheme = preview ?? {
    effective: theme,
    resolved: resolvedTheme,
  };

  return (
    <>
      {typeof children === 'function'
        ? children({
            effective: renderedTheme.effective,
            resolved: renderedTheme.resolved,
            transitioning,
            toggleTheme,
          })
        : children}
      <style>{THEME_TRANSITION_STYLES}</style>
    </>
  );
}

export {
  ThemeToggler,
  type ThemeTogglerProps,
  type ThemeSelection,
  type ThemeTransitionOrigin,
  type Resolved,
  type Direction,
};
