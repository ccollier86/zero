'use client';

/**
 * theme-toggler.tsx
 *
 * Public Zero wrapper for Animate UI's theme transition primitive. This file
 * owns the button affordance only; ThemeProvider owns theme persistence and app
 * shells decide where the control is rendered.
 */

import * as React from 'react';
import { useTheme } from 'next-themes';
import { VariantProps } from 'class-variance-authority';

import {
  ThemeToggler as ThemeTogglerPrimitive,
  type ThemeTogglerProps as ThemeTogglerPrimitiveProps,
  type ThemeSelection,
  type Resolved,
} from '#zero/components/animate-ui/primitives/effects/theme-toggler';
import { buttonVariants } from '#zero/components/animate-ui/components/buttons/icon';
import { ThemeMorphIcon, ThemeMorphIconStyles } from './theme-morph-icon';
import { cn } from '#zero/lib/utils';
import { useMounted } from '#zero/hooks/use-mounted';

const DEFAULT_MODES: ThemeSelection[] = ['light', 'dark', 'system'];

const getNextTheme = (
  effective: ThemeSelection,
  modes: ThemeSelection[],
): ThemeSelection => {
  const i = modes.indexOf(effective);
  if (i === -1) return modes[0];
  return modes[(i + 1) % modes.length];
};

type ThemeTogglerButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    modes?: ThemeSelection[];
    onImmediateChange?: ThemeTogglerPrimitiveProps['onImmediateChange'];
    direction?: ThemeTogglerPrimitiveProps['direction'];
  };

function ThemeTogglerButton({
  variant = 'default',
  size = 'default',
  modes = ['light', 'dark', 'system'],
  direction = 'ltr',
  onImmediateChange,
  onClick,
  className,
  type = 'button',
  disabled,
  title,
  'aria-label': ariaLabel,
  'aria-busy': ariaBusy,
  ...props
}: ThemeTogglerButtonProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const availableModes = modes.length > 0 ? modes : DEFAULT_MODES;
  // Persisted browser preferences are unknown on the server. Keep the first
  // hydration render identical, then reflect the real preference after mount.
  const resolved = resolveTheme(mounted ? resolvedTheme : undefined);
  const currentTheme = resolveCurrentTheme(mounted ? theme : undefined, resolved, availableModes);
  const previousResolved = React.useRef(resolved);
  const [animateIcon, setAnimateIcon] = React.useState(false);

  React.useEffect(() => {
    if (previousResolved.current !== resolved) setAnimateIcon(true);
    previousResolved.current = resolved;
  }, [resolved]);

  return (
    <ThemeTogglerPrimitive
      theme={currentTheme}
      resolvedTheme={resolved}
      setTheme={setTheme}
      direction={direction}
      onImmediateChange={onImmediateChange}
    >
      {({ effective, resolved, transitioning, toggleTheme }) => {
        const nextTheme = getNextTheme(effective, availableModes);

        const actionLabel = `Switch to ${nextTheme} theme`;

        return (
          <>
            <button
              data-slot="theme-toggler-button"
              data-theme={resolved}
              data-state={transitioning ? 'transitioning' : 'idle'}
              className={cn(buttonVariants({ variant, size, className }))}
              type={type}
              disabled={disabled || !mounted || transitioning}
              title={title ?? actionLabel}
              aria-label={ariaLabel ?? actionLabel}
              aria-busy={ariaBusy ?? (transitioning || undefined)}
              onClick={(event) => {
                onClick?.(event);
                if (event.defaultPrevented) return;
                void toggleTheme(nextTheme, getTransitionOrigin(event));
              }}
              {...props}
            >
              <ThemeMorphIcon resolved={resolved} animate={animateIcon} />
            </button>
            <ThemeMorphIconStyles />
          </>
        );
      }}
    </ThemeTogglerPrimitive>
  );
}

function getTransitionOrigin(
  event: React.MouseEvent<HTMLButtonElement>,
): { x: number; y: number; source: HTMLButtonElement } {
  const source = event.currentTarget;
  const bounds = source.getBoundingClientRect();
  const fromKeyboard = event.detail === 0;

  return {
    x: fromKeyboard ? bounds.left + bounds.width / 2 : event.clientX,
    y: fromKeyboard ? bounds.top + bounds.height / 2 : event.clientY,
    source,
  };
}

function resolveCurrentTheme(
  theme: string | undefined,
  resolvedTheme: string | undefined,
  modes: ThemeSelection[],
): ThemeSelection {
  if (modes.includes('system') && theme === 'system') return 'system';
  if (theme === 'light' || theme === 'dark') return theme;
  if (resolvedTheme === 'dark') return 'dark';
  return 'light';
}

function resolveTheme(resolvedTheme: string | undefined): Resolved {
  return resolvedTheme === 'dark' ? 'dark' : 'light';
}

export { ThemeTogglerButton, type ThemeTogglerButtonProps };
