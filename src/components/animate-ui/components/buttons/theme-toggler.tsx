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
} from '@/components/animate-ui/primitives/effects/theme-toggler';
import { buttonVariants } from '@/components/animate-ui/components/buttons/icon';
import {
  ThemeMorphIcon,
  ThemeMorphIconStyles,
} from '@/components/animate-ui/components/buttons/theme-morph-icon';
import { cn } from '@/lib/utils';

const DEFAULT_MODES: ThemeSelection[] = ['light', 'dark', 'system'];

const getNextTheme = (
  effective: ThemeSelection,
  modes: ThemeSelection[],
): ThemeSelection => {
  const i = modes.indexOf(effective);
  if (i === -1) return modes[0];
  return modes[(i + 1) % modes.length];
};

function getTransitionOrigin(
  event: React.MouseEvent<HTMLButtonElement>,
): { x: number; y: number; source: HTMLButtonElement } {
  const source = event.currentTarget;
  if (event.detail !== 0) {
    return { x: event.clientX, y: event.clientY, source };
  }

  const bounds = source.getBoundingClientRect();
  return {
    x: bounds.left + bounds.width / 2,
    y: bounds.top + bounds.height / 2,
    source,
  };
}

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
  const availableModes = modes.length > 0 ? modes : DEFAULT_MODES;
  const currentTheme = resolveCurrentTheme(
    theme,
    resolvedTheme,
    availableModes,
  );
  const currentResolved: Resolved =
    resolvedTheme === 'dark' ? 'dark' : 'light';
  const previousResolved = React.useRef(currentResolved);
  const [animateIcon, setAnimateIcon] = React.useState(false);

  React.useEffect(() => {
    if (previousResolved.current !== currentResolved) setAnimateIcon(true);
    previousResolved.current = currentResolved;
  }, [currentResolved]);

  return (
    <ThemeTogglerPrimitive
      theme={currentTheme}
      resolvedTheme={currentResolved}
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
              disabled={disabled || transitioning}
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

export { ThemeTogglerButton, type ThemeTogglerButtonProps };
